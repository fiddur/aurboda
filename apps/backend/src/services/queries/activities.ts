import { isExerciseActivityType } from '@aurboda/api-spec'

import type { ActivityType } from '../../schema.ts'
import type { ActivityResult, CommentSummary, SyncProvider } from './types.ts'

import {
  type DataFilter,
  expandActivityTypes,
  getActivities,
  getHrZoneSecsForWindows,
  getTimeSeries,
  getTimeSeriesMultiMetric,
} from '../../db/index.ts'
import { getEffectiveHrZones, type HrZoneSecs } from '../settings.ts'
import { computeSleepMinutes } from '../sleep-duration.ts'
import {
  computeActivitySummaryMetrics,
  SUMMARY_METRICS,
  type SummaryMetricSeries,
  windowBounds,
} from './activity-summary-metrics.ts'
import { buildCategoryMap, dedupeCommentsForIds, getCommentsMap } from './types.ts'

type TimeSeriesPoint = [Date, number]

/** Time-ordered points inside [start, end] (inclusive). */
const pointsInRange = (points: TimeSeriesPoint[], start: Date, end: Date): TimeSeriesPoint[] =>
  points.slice(...windowBounds(points, start, end))

/**
 * Compute average HRV for an activity using either embedded Oura data or
 * pre-fetched time-series points. Caller is responsible for batching the
 * `hrvSeries` fetch — passing it in avoids one round-trip per activity.
 */
function avgHrvForActivity(
  activity: { data?: Record<string, unknown>; start_time: Date; end_time?: Date },
  hrvSeries: TimeSeriesPoint[],
): number | undefined {
  // Try embedded Oura HRV data first (meditation sessions have hrv.items)
  const hrv = activity.data?.hrv as { items?: (number | null)[] } | undefined
  const items = hrv?.items?.filter((v): v is number => v !== null && v > 0)
  if (items && items.length > 0) {
    return Math.round(items.reduce((sum, v) => sum + v, 0) / items.length)
  }

  if (!activity.end_time) return undefined
  const window = pointsInRange(hrvSeries, activity.start_time, activity.end_time)
  if (window.length === 0) return undefined
  return Math.round(window.reduce((sum, [, v]) => sum + v, 0) / window.length)
}

/** Add sleep-specific fields (time_in_bed, total_sleep) to an activity result. */
export function enrichSleepFields(result: ActivityResult, data: Record<string, unknown> | undefined): void {
  result.time_in_bed = result.duration
  const sleepMinutes = computeSleepMinutes(data)
  if (sleepMinutes !== undefined) {
    result.total_sleep = sleepMinutes
    result.duration = sleepMinutes
  }
}

/**
 * Parse a `"field:value,field2:value2"` data filter; `(none)` matches a missing or empty value.
 * Segments without a colon are ignored.
 */
export const parseDataFilter = (raw: string | undefined): DataFilter[] | undefined =>
  raw
    ?.split(',')
    .map((segment) => {
      const colonIdx = segment.indexOf(':')
      if (colonIdx === -1) return null
      const field = segment.slice(0, colonIdx).trim()
      const rawValue = segment.slice(colonIdx + 1).trim()
      return { field, value: rawValue === '(none)' ? null : rawValue }
    })
    .filter((f): f is DataFilter => f !== null)

/** A workout: the generic bucket, a Health Connect exercise subtype, or a custom type in the exercise category. */
export const isExerciseLike = (activityType: string, categoryMap: Map<string, string>): boolean =>
  isExerciseActivityType(activityType) || categoryMap.get(activityType) === 'exercise'

interface EnrichmentContext {
  hrvSeries: TimeSeriesPoint[]
  summarySeries: SummaryMetricSeries
  commentsMap: Map<string, CommentSummary[]>
}

function enrichActivity(
  a: Awaited<ReturnType<typeof getActivities>>[number],
  ctx: EnrichmentContext,
  hrZoneSecs: HrZoneSecs | undefined,
): ActivityResult {
  const isMerged = 'source_ids' in a && Boolean(a.source_ids)
  // For merged rows, collect comments anchored to the winner and to any
  // sibling source row that was folded in, deduping by note id.
  const commentLookupIds = a.id ? [a.id, ...(a.source_ids ?? [])] : []
  const result: ActivityResult = {
    activity_type: a.activity_type,
    comments: dedupeCommentsForIds(ctx.commentsMap, commentLookupIds),
    data: a.data,
    duration: a.end_time
      ? Math.round((a.end_time.getTime() - a.start_time.getTime()) / 1000 / 60)
      : undefined,
    end_time: a.end_time?.toISOString(),
    hr_zone_secs: hrZoneSecs,
    id: isMerged ? `merged:${a.id}` : a.id,
    override_target_ids: a.override_target_ids,
    source: a.source,
    start_time: a.start_time.toISOString(),
    title: a.title,
    ...computeActivitySummaryMetrics(a, ctx.summarySeries),
  }

  if (a.activity_type === 'sleep') {
    enrichSleepFields(result, a.data)
  }

  // Compute average HRV for sleep and meditation
  if ((a.activity_type === 'sleep' || a.activity_type === 'meditation') && a.end_time) {
    result.avg_hrv = avgHrvForActivity(a, ctx.hrvSeries)
  }

  return result
}

/**
 * @param sync Optional sync provider to auto-refresh stale data before querying
 */
export async function queryActivities(
  user: string,
  types: ActivityType[],
  start: Date,
  end: Date,
  sync?: SyncProvider,
  dataFilters?: DataFilter[],
  deductionRuleId?: string,
): Promise<ActivityResult[]> {
  // Fire-and-forget: trigger background sync so activity data is fresh for the next request
  if (sync) {
    const promises: Promise<void>[] = []
    if (types.includes('meditation')) promises.push(sync.syncOuraIfNeeded(user, 'sessions'))
    if (types.includes('sleep')) promises.push(sync.syncGarminIfNeeded(user, 'sleep'))
    if (types.includes('exercise')) promises.push(sync.syncGarminIfNeeded(user, 'activities'))
    if (promises.length > 0) void Promise.all(promises)
  }

  const categoryMap = await buildCategoryMap(user)
  const expandedTypes = (await expandActivityTypes(user, types)) as ActivityType[]
  const activities = await getActivities(
    user,
    expandedTypes,
    start,
    end,
    dataFilters,
    deductionRuleId,
    categoryMap,
  )

  // Determine which time-series we'll need based on the activity types present.
  // Batching fetches across the full activity span avoids one DB round-trip per
  // activity (was N+1 before).
  const hasExerciseLike = activities.some((a) => a.activity_type === 'exercise' && a.end_time)
  const needsHrv = activities.some(
    (a) => (a.activity_type === 'sleep' || a.activity_type === 'meditation') && a.end_time,
  )

  // Compute the actual span across activities (may extend past `end` for
  // long-running sessions). Falls back to [start, end] when nothing matches.
  const activitySpan = (): { from: Date; to: Date } => {
    let minStart = start.getTime()
    let maxEnd = end.getTime()
    for (const a of activities) {
      if (!a.end_time) continue
      if (a.start_time.getTime() < minStart) minStart = a.start_time.getTime()
      if (a.end_time.getTime() > maxEnd) maxEnd = a.end_time.getTime()
    }
    return { from: new Date(minStart), to: new Date(maxEnd) }
  }
  const span = hasExerciseLike || needsHrv ? activitySpan() : { from: start, to: end }

  const activityIds = activities.map((a) => a.id).filter((id): id is string => id !== undefined)
  // Include sibling source ids so cross-source merged rows surface HC/Garmin
  // auto-notes anchored to the original sources, not just the winner.
  const siblingIds = activities.flatMap((a) => a.source_ids ?? [])
  const commentLookupIds = [...new Set([...activityIds, ...siblingIds])]

  // Zones come from SQL per activity window, so exercise subtypes (yoga, running, …) get them
  // without pulling their whole span's time-series into memory.
  const zoneActivities = activities.filter((a) => a.end_time && isExerciseLike(a.activity_type, categoryMap))
  const hrZoneSecsForZoneActivities = async (): Promise<(HrZoneSecs | undefined)[]> => {
    if (zoneActivities.length === 0) return []
    const { zones } = await getEffectiveHrZones(user)
    return getHrZoneSecsForWindows(
      user,
      zoneActivities.map((a) => ({ end: a.end_time!, start: a.start_time })),
      zones,
    )
  }

  const emptySeries: SummaryMetricSeries = {}
  const [zoneSecs, summarySeries, hrvSeries, commentsMap] = await Promise.all([
    hrZoneSecsForZoneActivities(),
    hasExerciseLike
      ? getTimeSeriesMultiMetric(user, [...SUMMARY_METRICS], span.from, span.to)
      : Promise.resolve(emptySeries),
    needsHrv ? getTimeSeries(user, 'hrv_rmssd', span.from, span.to) : Promise.resolve([]),
    getCommentsMap(user, 'activity', commentLookupIds),
  ])

  const ctx: EnrichmentContext = { commentsMap, hrvSeries, summarySeries }
  const zoneSecsByActivity = new Map(zoneActivities.map((a, i) => [a, zoneSecs[i]]))

  return activities.map((a) => enrichActivity(a, ctx, zoneSecsByActivity.get(a)))
}
