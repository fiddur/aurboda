import {
  type ActivityMeasure,
  activityMeasures,
  type ActivitySession,
  recordMeasures,
} from '@aurboda/api-spec'
import { endOfDay, startOfDay, subDays } from 'date-fns'

import { buildChartUrl } from '../../utils/chart-url'
import { defaultAggregation, measureSet } from '../../utils/measures'

export interface ItemRecord {
  measure: ActivityMeasure
  value: number
  session_id: string
  start_time: string
  /** The set the value came from. */
  set?: Record<string, unknown>
}

const oldestFirst = (sessions: ActivitySession[]): ActivitySession[] =>
  sessions.toSorted((a, b) => a.start_time.localeCompare(b.start_time))

/** The best value of each record measure, with the first session that reached it. */
export const recordsFrom = (sessions: ActivitySession[]): ItemRecord[] => {
  const ordered = oldestFirst(sessions)
  return recordMeasures.flatMap((measure) => {
    let best: ActivitySession | undefined
    for (const s of ordered) {
      const v = s.measures?.[measure]
      if (v !== undefined && (best === undefined || v > (best.measures?.[measure] ?? -Infinity))) best = s
    }
    const value = best?.measures?.[measure]
    if (best === undefined || value === undefined) return []
    const set = measureSet(best.items ?? [], measure)
    return [{ measure, session_id: best.id, start_time: best.start_time, value, ...(set && { set }) }]
  })
}

export const doneSummary = (
  sessions: ActivitySession[],
): { count: number; first: string; last: string } | undefined => {
  const ordered = oldestFirst(sessions)
  const first = ordered[0]
  const last = ordered.at(-1)
  return first && last ? { count: ordered.length, first: first.start_time, last: last.start_time } : undefined
}

const DAY_MS = 86_400_000

const has = (sessions: ActivitySession[], measure: ActivityMeasure): boolean =>
  sessions.some((s) => s.measures?.[measure] !== undefined)

const TREND_MEASURES: ActivityMeasure[] = ['e1rm', 'max_reps', 'max_time']

/** The exercise's primary record measure: e1RM, else most reps in a set, else longest hold. */
export const trendMeasure = (sessions: ActivitySession[]): ActivityMeasure | undefined =>
  TREND_MEASURES.find((m) => has(sessions, m))

/** The measures at least one session has, in api-spec order. */
export const availableMeasures = (sessions: ActivitySession[]): ActivityMeasure[] =>
  activityMeasures.filter((m) => has(sessions, m))

export const BEST_HALF_LIFE_DAYS = 120

export const lookbackStart = (days: number, now: number = Date.now()): number => now - days * DAY_MS

/** The sessions of the last `days` days; 0 keeps them all. */
export const sliceByLookback = (
  sessions: ActivitySession[],
  days: number,
  now: number = Date.now(),
): ActivitySession[] => {
  if (days <= 0) return sessions
  const from = lookbackStart(days, now)
  return sessions.filter((s) => new Date(s.start_time).getTime() >= from)
}

/**
 * Whole days, so the range (and the query key) stays the same through the day. A lookback of 0 (all time) starts
 * at the first session.
 */
export const perWeekRange = (
  lookback: number,
  sessions: ActivitySession[],
  now: Date = new Date(),
): { end: string; start: string } => {
  const first = oldestFirst(sessions)[0]
  const from = lookback > 0 || first === undefined ? subDays(now, lookback) : new Date(first.start_time)
  return { end: endOfDay(now).toISOString(), start: startOfDay(from).toISOString() }
}

/** The Chart Explorer's lookback for the same span: the period, or the days since `start` rounded up. */
export const explorerLookbackDays = (lookback: number, start: string, now: Date = new Date()): number =>
  lookback > 0 ? lookback : Math.max(1, Math.ceil((now.getTime() - new Date(start).getTime()) / DAY_MS))

export const chartExplorerHref = ({
  field,
  lookbackDays,
  measure,
  name,
  value,
}: {
  field: string
  lookbackDays: number
  measure: ActivityMeasure
  name: string
  value: string
}): string =>
  buildChartUrl({
    aggregation: defaultAggregation(measure),
    bucket_size: '1w',
    chart_type: 'bar',
    filter_field: field,
    filter_value: value,
    lookback_days: lookbackDays,
    measure,
    pattern: name,
    source_type: 'activity_type',
  })
