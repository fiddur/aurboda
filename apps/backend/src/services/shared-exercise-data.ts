/**
 * Shared exercise data resolver — the security boundary for a public exercise page. Every query
 * takes its parameters from the stored share alone, and the result is a projection: dates, sets
 * (reps, weight, time, set type), measures and records. Session ids, titles, notes, locations,
 * heart rate and raw fields never leave this function.
 */
import type { ActivityMeasure, ActivitySession, ChartDataBucket, SharedExerciseData } from '@aurboda/api-spec'

import { activityMeasures, measureDefaultAggregation, measureTrendHalfLifeDays } from '@aurboda/api-spec'

import type { SharedExerciseRecord } from '../db/index.ts'

import { publicRecord, recordsOf } from './activity-records.ts'
import { getChartData } from './chart-data.ts'
import { dayEndInTz, dayKey, dayStartInTz } from './day-keys.ts'
import { toSharedSet } from './feed-exercises.ts'
import { queryActivitySessions } from './queries/activity-sessions.ts'
import { getUserTimezone } from './settings.ts'
import { getTrend } from './trends.ts'

export interface SharedExerciseDataDeps {
  queryActivitySessions: typeof queryActivitySessions
  getTrend: typeof getTrend
  getChartData: typeof getChartData
  getUserTimezone: typeof getUserTimezone
  now: () => Date
}

const defaultDeps: SharedExerciseDataDeps = {
  getChartData,
  getTrend,
  getUserTimezone,
  now: () => new Date(),
  queryActivitySessions,
}

type Share = Pick<SharedExerciseRecord, 'activity_type' | 'field' | 'value'>

const DAY_MS = 86_400_000

const TREND_MEASURES: ActivityMeasure[] = ['e1rm', 'max_reps', 'max_time']

const oldestFirst = (sessions: ActivitySession[]): ActivitySession[] =>
  sessions.toSorted((a, b) => a.start_time.localeCompare(b.start_time))

const has = (sessions: ActivitySession[], measure: ActivityMeasure): boolean =>
  sessions.some((s) => s.measures?.[measure] !== undefined)

export const resolveSharedExerciseData = async (
  user: string,
  share: Share,
  deps: SharedExerciseDataDeps = defaultDeps,
): Promise<SharedExerciseData> => {
  const filter = { filter_field: share.field, filter_value: share.value }
  const [tz, { sessions }] = await Promise.all([
    deps.getUserTimezone(user),
    deps.queryActivitySessions(user, share.activity_type, {
      filter: { field: share.field, value: share.value },
    }),
  ])
  const ordered = oldestFirst(sessions)
  const first = ordered[0]
  const last = ordered.at(-1)
  const now = deps.now()

  const trendMeasure = TREND_MEASURES.find((m) => has(sessions, m))
  const trend =
    trendMeasure && first
      ? {
          half_life_days: measureTrendHalfLifeDays,
          history: (
            await deps.getTrend(user, {
              ...filter,
              half_life_days: measureTrendHalfLifeDays,
              lookback_days: Math.max(
                1,
                Math.ceil((now.getTime() - new Date(first.start_time).getTime()) / DAY_MS),
              ),
              measure: trendMeasure,
              pattern: share.activity_type,
              source_type: 'activity_type',
              tz,
            })
          ).history,
          measure: trendMeasure,
        }
      : null

  const available = activityMeasures.filter((m) => has(sessions, m))
  const perWeekMeasure = trendMeasure ?? available[0]
  let perWeek: SharedExerciseData['per_week'] = null
  if (perWeekMeasure && first) {
    const start = dayStartInTz(dayKey(new Date(first.start_time), tz), tz).toISOString()
    const end = dayEndInTz(dayKey(now, tz), tz).toISOString()
    const aggregation = measureDefaultAggregation(perWeekMeasure)
    const chart = await deps.getChartData(user, {
      ...filter,
      aggregation,
      bucket_size: '1w',
      end,
      measure: perWeekMeasure,
      pattern: share.activity_type,
      source_type: 'activity_type',
      start,
      tz,
    })
    const buckets = chart.buckets.flatMap((b): ChartDataBucket[] =>
      'value' in b ? [{ bucket_start: b.bucket_start, value: b.value }] : [],
    )
    perWeek = { aggregation, buckets, end, measure: perWeekMeasure, start }
  }

  return {
    done: first && last ? { count: ordered.length, first: first.start_time, last: last.start_time } : null,
    history: ordered.toReversed().map((s) => ({
      items: (s.items ?? []).map(toSharedSet),
      measures: s.measures ?? {},
      records: s.records ?? [],
      start_time: s.start_time,
    })),
    per_week: perWeek,
    records: recordsOf(ordered).map(publicRecord),
    trend,
  }
}
