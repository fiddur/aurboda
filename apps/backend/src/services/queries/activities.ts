/**
 * Activity query functions.
 */

import type { ActivityType } from '../../schema.ts'
import type { ActivityResult, CommentSummary, SyncProvider } from './types.ts'

import {
  expandActivityTypes,
  getActivities,
  getTimeSeries,
  getTimeSeriesMultiMetric,
} from '../../db/index.ts'
import { computeHrZoneSecs, getEffectiveHrZones, type HrZoneThresholds } from '../settings.ts'
import { computeSleepMinutes } from '../sleep-duration.ts'
import {
  computeActivitySummaryMetrics,
  SUMMARY_METRICS,
  type SummaryMetricSeries,
} from './activity-summary-metrics.ts'
import { buildCategoryMap, getCommentsMap } from './types.ts'

type TimeSeriesPoint = [Date, number]

/** Filter pre-fetched time series points to those inside [start, end] (inclusive). */
const pointsInRange = (points: TimeSeriesPoint[], start: Date, end: Date): TimeSeriesPoint[] =>
  points.filter(([time]) => time >= start && time <= end)

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

interface EnrichmentContext {
  hrZones: HrZoneThresholds | null
  hrvSeries: TimeSeriesPoint[]
  summarySeries: SummaryMetricSeries
  commentsMap: Map<string, CommentSummary[]>
}

/** Compute HR zone seconds from the HR samples within an activity window. */
function hrZonesForActivity(
  a: Awaited<ReturnType<typeof getActivities>>[number],
  ctx: EnrichmentContext,
): ActivityResult['hr_zone_secs'] {
  if (!ctx.hrZones || a.activity_type !== 'exercise' || !a.end_time) return undefined
  const hrSeries = ctx.summarySeries.heart_rate ?? []
  const hrWindow = pointsInRange(hrSeries, a.start_time, a.end_time)
  return hrWindow.length > 0 ? computeHrZoneSecs(hrWindow, ctx.hrZones) : undefined
}

/** Enrich a raw activity record into an ActivityResult with computed fields. */
function enrichActivity(
  a: Awaited<ReturnType<typeof getActivities>>[number],
  ctx: EnrichmentContext,
): ActivityResult {
  const isMerged = 'source_ids' in a && Boolean(a.source_ids)
  const result: ActivityResult = {
    activity_type: a.activity_type,
    comments: a.id ? (ctx.commentsMap.get(a.id) ?? []) : [],
    data: a.data,
    duration: a.end_time
      ? Math.round((a.end_time.getTime() - a.start_time.getTime()) / 1000 / 60)
      : undefined,
    end_time: a.end_time?.toISOString(),
    hr_zone_secs: hrZonesForActivity(a, ctx),
    id: isMerged ? `merged:${a.id}` : a.id,
    notes: a.notes,
    overrides_id: a.overrides_id,
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
 * Query activities for a time range.
 * @param sync Optional sync provider to auto-refresh stale data before querying
 */
export async function queryActivities(
  user: string,
  types: ActivityType[],
  start: Date,
  end: Date,
  sync?: SyncProvider,
  dataFilters?: Array<{ field: string; value: string | null }>,
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

  const emptySeries: SummaryMetricSeries = {}
  const [hrZonesResult, summarySeries, hrvSeries, commentsMap] = await Promise.all([
    expandedTypes.includes('exercise') ? getEffectiveHrZones(user) : Promise.resolve(null),
    hasExerciseLike
      ? getTimeSeriesMultiMetric(user, [...SUMMARY_METRICS], span.from, span.to)
      : Promise.resolve(emptySeries),
    needsHrv ? getTimeSeries(user, 'hrv_rmssd', span.from, span.to) : Promise.resolve([]),
    getCommentsMap(user, 'activity', activityIds),
  ])

  const ctx: EnrichmentContext = {
    commentsMap,
    hrvSeries,
    hrZones: hrZonesResult?.zones ?? null,
    summarySeries,
  }

  return activities.map((a) => enrichActivity(a, ctx))
}
