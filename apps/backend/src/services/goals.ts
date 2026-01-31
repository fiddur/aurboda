/**
 * Goals service for calculating progress toward user-defined goals.
 */

import { metricUnits, parseDuration, type GoalProgress, type MetricType } from '@aurboda/api-spec'
import { getDailyAggregates, getTimeSeries } from '../db'
import { computeHrZoneSecs, getEffectiveGoals, getEffectiveHrZones, getSettings } from './settings'

/**
 * Calculate the sum of a metric over a time range.
 * Handles HR zone metrics specially (computed from heart_rate).
 */
const getMetricSum = async (user: string, metric: MetricType, start: Date, end: Date): Promise<number> => {
  // HR zone metrics need to be computed from heart rate data
  if (metric.startsWith('hr_zone_')) {
    const [hrData, { zones: hrZones }] = await Promise.all([
      getTimeSeries(user, 'heart_rate', start, end),
      getEffectiveHrZones(user),
    ])
    const zoneSecs = computeHrZoneSecs(hrData, hrZones)
    const zoneIndex = parseInt(metric.replace('hr_zone_', '').replace('_sec', ''), 10) as
      | 0
      | 1
      | 2
      | 3
      | 4
      | 5
    return zoneSecs[zoneIndex]
  }

  // For regular metrics, use daily aggregates and sum them
  const dailyData = await getDailyAggregates(user, [metric], start, end)
  return dailyData.reduce((sum, day) => sum + day.sum, 0)
}

/**
 * Get progress for all user goals.
 * Returns current value and "losing tomorrow" value for each goal.
 */
export const getGoalsProgress = async (user: string): Promise<GoalProgress[]> => {
  const settings = await getSettings(user)
  const goals = getEffectiveGoals(settings)

  if (goals.length === 0) {
    return []
  }

  const now = new Date()
  const results: GoalProgress[] = []

  for (const goal of goals) {
    const windowMs = parseDuration(goal.window)
    const windowStart = new Date(now.getTime() - windowMs)

    // Calculate "losing tomorrow" - the oldest day's contribution
    // For a 7-day window, this is the first day that will drop off tomorrow
    const oldestDayStart = new Date(windowStart)
    oldestDayStart.setUTCHours(0, 0, 0, 0)
    const oldestDayEnd = new Date(oldestDayStart)
    oldestDayEnd.setUTCHours(23, 59, 59, 999)

    // Get current total and oldest day value in parallel
    const [current, losingTomorrow] = await Promise.all([
      getMetricSum(user, goal.metric, windowStart, now),
      getMetricSum(user, goal.metric, oldestDayStart, oldestDayEnd),
    ])

    results.push({
      current,
      id: goal.id,
      losingTomorrow,
      max: goal.max,
      metric: goal.metric,
      min: goal.min,
      unit: metricUnits[goal.metric],
      window: goal.window,
    })
  }

  return results
}
