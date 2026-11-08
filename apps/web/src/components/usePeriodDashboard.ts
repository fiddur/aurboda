import type { DashboardConfig, DashboardDataResponse, WidgetDataMap } from '@aurboda/api-spec'

import { periodGranularityOf, periodLabel } from '@aurboda/api-spec'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'preact/hooks'

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

/**
 * The server-resolved data of a period dashboard, with the selected period (null = the latest finished
 * one). Inactive (null) for a rolling dashboard, whose widgets fetch their own data.
 */
export const usePeriodDashboard = (
  boardId: string,
  config: DashboardConfig,
  fetchData: (period?: string) => Promise<DashboardDataResponse>,
): PeriodDashboardState | null => {
  const granularity = config.period?.granularity ?? null
  const [selected, setSelected] = useState<string | null>(null)
  const [latest, setLatest] = useState<string | null>(null)

  useEffect(() => {
    setSelected(null)
    setLatest(null)
  }, [granularity])

  const current = selected !== null && periodGranularityOf(selected) === granularity ? selected : null

  const query = useQuery({
    enabled: granularity !== null,
    placeholderData: keepPreviousData,
    queryFn: () => fetchData(current ?? undefined),
    queryKey: ['dashboardData', boardId, granularity, current],
    staleTime: 5 * 60 * 1000,
  })

  const answered = query.data?.period ?? null
  const period = answered !== null && periodGranularityOf(answered) === granularity ? answered : null

  useEffect(() => {
    if (current === null && period !== null) setLatest(period)
  }, [current, period])

  if (granularity === null) return null
  return {
    isError: query.isError,
    isFetching: query.isFetching,
    latest,
    period,
    periodLabel: period === null ? undefined : periodLabel(period),
    select: setSelected,
    widgetData: period === null ? {} : (query.data?.widget_data ?? {}),
  }
}
