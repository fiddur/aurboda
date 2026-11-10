import type { DashboardConfig, DashboardDataResponse, WidgetDataMap } from '@aurboda/api-spec'

import { periodGranularityOf, periodLabel } from '@aurboda/api-spec'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import { auth } from '../state/auth'
import {
  type CachedPeriodData,
  configVersion,
  type PeriodDataSlot,
  readPeriodData,
  writePeriodData,
} from '../state/periodDataCache'
import { isGranularitySwitch, readPeriodParam, writePeriodParam } from './periodParam'

export interface PeriodDashboardState {
  /** The shown period key, once the data says which. */
  period: string | null
  /** The latest finished period, learnt from the first answer without an explicit period. */
  latest: string | null
  periodLabel: string | undefined
  /** Resolved data per widget id; empty while the first answer loads. */
  widgetData: WidgetDataMap
  isError: boolean
  isFetching: boolean
  select: (key: string) => void
}

const sessionStore = () => window.sessionStorage

const periodSlot = (
  boardId: string,
  granularity: string,
  period: string | null,
  version: string,
): PeriodDataSlot => ({ boardId, granularity, period, version, viewer: auth.value.user ?? '' })

/** Seeds a slot's query from sessionStorage, read at most once per query, and stores what it fetches. */
const sessionCached = (slot: PeriodDataSlot | null, fetch: () => Promise<DashboardDataResponse>) => {
  let read: { value: CachedPeriodData | undefined } | undefined
  const stored = () => {
    read ??= { value: slot ? readPeriodData(sessionStore, slot, Date.now()) : undefined }
    return read.value
  }
  return {
    initialData: () => stored()?.data,
    initialDataUpdatedAt: () => stored()?.savedAt,
    queryFn: async () => {
      const data = await fetch()
      if (slot) writePeriodData(sessionStore, slot, data, Date.now())
      return data
    },
  }
}

/**
 * The latest finished period, which only the server knows (it depends on its clock and the user's tz):
 * the shown one when nothing is selected, otherwise asked for separately, as when the URL names a period.
 */
const useLatestPeriod = (
  boardId: string,
  granularity: string | null,
  selected: string | null,
  version: string,
  fetchData: (period?: string) => Promise<DashboardDataResponse>,
) => {
  const slot = granularity === null ? null : periodSlot(boardId, granularity, null, version)
  const query = useQuery({
    enabled: slot !== null && selected !== null,
    ...sessionCached(slot, () => fetchData()),
    queryKey: ['dashboardData', boardId, granularity, null],
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  })
  const answered = query.data?.period ?? null
  return answered !== null && granularity !== null && periodGranularityOf(answered) === granularity
    ? answered
    : null
}

/**
 * The server-resolved data of a period dashboard, with the selected period (null = the latest finished
 * one). Inactive (null) for a rolling dashboard, whose widgets fetch their own data.
 *
 * A finished period's figures only change with the config, whose saves invalidate this query, so it
 * never goes stale by itself and does not refetch on focus or reconnect: the resolve takes seconds and
 * would blank the board. The last answers are kept in sessionStorage so a discarded, reloaded tab
 * renders at once.
 */
export const usePeriodDashboard = (
  boardId: string,
  config: DashboardConfig,
  fetchData: (period?: string) => Promise<DashboardDataResponse>,
): PeriodDashboardState | null => {
  const granularity = config.period?.granularity ?? null
  const [selected, setSelected] = useState<string | null>(readPeriodParam)
  const [latest, setLatest] = useState<string | null>(null)
  const shownGranularity = useRef(granularity)

  useEffect(() => {
    const previous = shownGranularity.current
    shownGranularity.current = granularity
    if (!isGranularitySwitch(previous, granularity)) return
    setSelected(null)
    setLatest(null)
    writePeriodParam(null)
  }, [granularity])

  const current = selected !== null && periodGranularityOf(selected) === granularity ? selected : null

  const version = useMemo(() => configVersion(config), [config])
  const slot = granularity === null ? null : periodSlot(boardId, granularity, current, version)

  const query = useQuery({
    enabled: slot !== null,
    ...sessionCached(slot, () => fetchData(current ?? undefined)),
    placeholderData: keepPreviousData,
    queryKey: ['dashboardData', boardId, granularity, current],
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  })

  const answered = query.data?.period ?? null
  const period = answered !== null && periodGranularityOf(answered) === granularity ? answered : null

  const knownLatest = useLatestPeriod(boardId, granularity, current, version, fetchData)
  useEffect(() => {
    if (current === null && period !== null) setLatest(period)
    else if (knownLatest !== null) setLatest(knownLatest)
  }, [current, period, knownLatest])

  if (granularity === null) return null
  return {
    isError: query.isError,
    isFetching: query.isFetching,
    latest,
    period,
    periodLabel: period === null ? undefined : periodLabel(period),
    select: (key) => {
      const next = key === latest ? null : key
      setSelected(next)
      writePeriodParam(next)
    },
    widgetData: period === null ? {} : (query.data?.widget_data ?? {}),
  }
}
