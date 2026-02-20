/**
 * Contextual HRV filtering service.
 *
 * HRV (RMSSD) is fundamentally different depending on when it's measured:
 * - Sleep HRV (Oura): ~35-50 avg - the standard recovery/readiness indicator
 * - Daytime HRV: ~15-30 avg - reflects sympathetic activity, movement, stress
 *
 * This service filters HRV samples by context:
 * - hrv_sleep: HRV during detected sleep windows
 * - hrv_activity: HRV during exercise/activity sessions
 * - hrv_awake: Everything else (resting but awake)
 */

import { Activity, getActivities, getSleepSessions, getTimeSeries, TimeSeriesPoint } from '../db'
import { MetricType } from '../schema'

export type HrvContext = 'sleep' | 'activity' | 'awake'

interface TimeWindow {
  start: Date
  end: Date
}

/**
 * Check if a timestamp falls within any of the given time windows.
 */
const isInWindow = (time: Date, windows: TimeWindow[]): boolean => {
  const t = time.getTime()
  return windows.some((w) => t >= w.start.getTime() && t <= w.end.getTime())
}

/**
 * Convert activities to time windows, handling optional end times.
 */
const activitiesToWindows = (activities: Activity[]): TimeWindow[] =>
  activities
    .filter((a) => a.end_time !== undefined)
    .map((a) => ({
      end: a.end_time!,
      start: a.start_time,
    }))

/**
 * Classify HRV samples by context.
 * Returns samples categorized as sleep, activity, or awake.
 */
export const classifyHrvByContext = (
  hrvData: [Date, number][],
  sleepWindows: TimeWindow[],
  activityWindows: TimeWindow[],
): Record<HrvContext, [Date, number][]> => {
  const result: Record<HrvContext, [Date, number][]> = {
    activity: [],
    awake: [],
    sleep: [],
  }

  for (const [time, value] of hrvData) {
    if (isInWindow(time, sleepWindows)) {
      result.sleep.push([time, value])
    } else if (isInWindow(time, activityWindows)) {
      result.activity.push([time, value])
    } else {
      result.awake.push([time, value])
    }
  }

  return result
}

/**
 * Get contextual HRV time windows for a date range.
 * Returns sleep and activity windows that can be used for filtering.
 */
export const getHrvContextWindows = async (
  user: string,
  start: Date,
  end: Date,
): Promise<{ sleepWindows: TimeWindow[]; activityWindows: TimeWindow[] }> => {
  // Fetch sleep sessions and exercise activities in parallel
  const [sleepSessions, exerciseActivities] = await Promise.all([
    getSleepSessions(user, start, end),
    getActivities(user, 'exercise', start, end),
  ])

  return {
    activityWindows: activitiesToWindows(exerciseActivities),
    sleepWindows: activitiesToWindows(sleepSessions),
  }
}

/**
 * Get HRV data filtered by context.
 *
 * @param user - The username
 * @param context - The HRV context ('sleep', 'activity', or 'awake')
 * @param start - Start of time range
 * @param end - End of time range
 * @returns Array of [Date, number] tuples with HRV values
 */
export const getContextualHrv = async (
  user: string,
  context: HrvContext,
  start: Date,
  end: Date,
): Promise<[Date, number][]> => {
  // Fetch HRV data and context windows in parallel
  const [hrvData, { sleepWindows, activityWindows }] = await Promise.all([
    getTimeSeries(user, 'hrv_rmssd', start, end),
    getHrvContextWindows(user, start, end),
  ])

  const classified = classifyHrvByContext(hrvData, sleepWindows, activityWindows)
  return classified[context]
}

/**
 * Map contextual HRV metric names to their context.
 */
export const contextualHrvMetricToContext: Record<string, HrvContext> = {
  hrv_activity: 'activity',
  hrv_awake: 'awake',
  hrv_sleep: 'sleep',
}

/**
 * Get the HRV context for a metric, or null if not a contextual HRV metric.
 */
export const getHrvContextForMetric = (metric: MetricType): HrvContext | null =>
  contextualHrvMetricToContext[metric] ?? null

/**
 * Convert contextual HRV data to TimeSeriesPoint format for insertion.
 * Note: Contextual HRV is computed, not stored - this is for consistency.
 */
export const hrvDataToTimeSeriesPoints = (
  data: [Date, number][],
  metric: MetricType,
): Omit<TimeSeriesPoint, 'source'>[] =>
  data.map(([time, value]) => ({
    metric,
    time,
    value,
  }))
