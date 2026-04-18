/**
 * Activity query functions.
 */

import type { ActivityType } from '../../schema.ts'
import type { ActivityResult, CommentSummary, SyncProvider } from './types.ts'

import { expandActivityTypes, getActivities, getTimeSeries } from '../../db/index.ts'
import { computeHrZoneSecs, getEffectiveHrZones, type HrZoneThresholds } from '../settings.ts'
import { computeSleepMinutes } from '../sleep-duration.ts'
import { buildCategoryMap, getCommentsMap } from './types.ts'

/**
 * Get average HRV for an activity, using embedded Oura data or time series.
 */
async function getAvgHrvForActivity(
  user: string,
  activity: { data?: Record<string, unknown>; start_time: Date; end_time?: Date },
): Promise<number | undefined> {
  // Try embedded Oura HRV data first (meditation sessions have hrv.items)
  const hrv = activity.data?.hrv as { items?: (number | null)[] } | undefined
  const items = hrv?.items?.filter((v): v is number => v !== null && v > 0)
  if (items && items.length > 0) {
    return Math.round(items.reduce((sum, v) => sum + v, 0) / items.length)
  }

  // Fall back to time series HRV data
  if (!activity.end_time) return undefined
  const hrvData = await getTimeSeries(user, 'hrv_rmssd', activity.start_time, activity.end_time)
  if (hrvData.length === 0) return undefined
  return Math.round(hrvData.reduce((sum, [, v]) => sum + v, 0) / hrvData.length)
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

/** Enrich a raw activity record into an ActivityResult with computed fields. */
async function enrichActivity(
  user: string,
  a: Awaited<ReturnType<typeof getActivities>>[number],
  hrZones: HrZoneThresholds | null,
  commentsMap: Map<string, CommentSummary[]>,
): Promise<ActivityResult> {
  const result: ActivityResult = {
    activity_type: a.activity_type,
    comments: a.id ? (commentsMap.get(a.id) ?? []) : [],
    data: a.data,
    duration: a.end_time
      ? Math.round((a.end_time.getTime() - a.start_time.getTime()) / 1000 / 60)
      : undefined,
    end_time: a.end_time?.toISOString(),
    id: 'source_ids' in a && a.source_ids ? `merged:${a.id}` : a.id,
    notes: a.notes,
    source: a.source,
    start_time: a.start_time.toISOString(),
    title: a.title,
  }

  if (a.activity_type === 'sleep') {
    enrichSleepFields(result, a.data as Record<string, unknown> | undefined)
  }

  // Compute HR zones for exercise activities with end time
  if (hrZones && a.activity_type === 'exercise' && a.end_time) {
    const hrData = await getTimeSeries(user, 'heart_rate', a.start_time, a.end_time)
    if (hrData.length > 0) {
      result.hr_zone_secs = computeHrZoneSecs(hrData, hrZones)
    }
  }

  // Compute average HRV for sleep and meditation
  if ((a.activity_type === 'sleep' || a.activity_type === 'meditation') && a.end_time) {
    result.avg_hrv = await getAvgHrvForActivity(user, a)
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

  // Get HR zones if any exercise subtype is included (parent 'exercise' or any descendant)
  const includesExercise = expandedTypes.includes('exercise') || types.includes('exercise')
  const hrZones = includesExercise ? (await getEffectiveHrZones(user)).zones : null

  // Fetch comments for all activities
  const activityIds = activities.map((a) => a.id).filter((id): id is string => id !== undefined)
  const commentsMap = await getCommentsMap(user, 'activity', activityIds)

  return Promise.all(activities.map((a) => enrichActivity(user, a, hrZones, commentsMap)))
}
