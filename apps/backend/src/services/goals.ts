/**
 * Goals service for calculating progress toward user-defined goals.
 */

import {
  cumulativeMetrics,
  isCalendarBasedUnit,
  metricUnits,
  parseDuration,
  type GoalProgress,
  type MetricGoalProgress,
  type MetricType,
  type TrendGoal,
  type TrendGoalProgress,
  type WidgetGoalProgress,
} from '@aurboda/api-spec'

import { getDailyAggregates, getDailyAggregateValue, getRawDailySum, getTimeSeries } from '../db/index.ts'
import { computeHrZoneSecs, getEffectiveGoals, getEffectiveHrZones } from './settings.ts'
import { getTrend } from './trends.ts'

/**
 * Get all dates in a range (inclusive).
 */
const getDatesInRange = (start: Date, end: Date): Date[] => {
  const dates: Date[] = []
  const current = new Date(start)
  current.setUTCHours(0, 0, 0, 0)

  const endDay = new Date(end)
  endDay.setUTCHours(23, 59, 59, 999)

  while (current <= endDay) {
    dates.push(new Date(current))
    current.setUTCDate(current.getUTCDate() + 1)
  }

  return dates
}

/**
 * Calculate the sum of a metric over a time range.
 * Handles HR zone metrics specially (computed from heart_rate).
 * Uses deduplicated aggregates for cumulative metrics (steps, distance, etc.).
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

  // For cumulative metrics (steps, distance, etc.), use deduplicated daily aggregates
  if (cumulativeMetrics.includes(metric)) {
    const dates = getDatesInRange(start, end)
    const values = await Promise.all(dates.map((date) => getDailyAggregateValue(user, metric, date)))

    // If we have any aggregate values, use them
    const hasAggregates = values.some((v) => v !== null)
    if (hasAggregates) {
      return values.reduce<number>((sum, v) => sum + (v ?? 0), 0)
    }

    // Fall back to raw data from ALL sources if no aggregates exist.
    // This may double-count but is better than showing 0.
    return getRawDailySum(user, metric, start, end)
  }

  // For non-cumulative metrics, use daily aggregates and sum them
  const dailyData = await getDailyAggregates(user, [metric], start, end)
  return dailyData.reduce((sum, day) => sum + day.sum, 0)
}

/**
 * Compute progress for a metric goal (windowed sum).
 */
const computeMetricGoalProgress = async (
  user: string,
  goal: { id: string; max?: number; metric: MetricType; min?: number; window: string },
): Promise<MetricGoalProgress> => {
  const now = new Date()
  const { ms: windowMs, unit, value } = parseDuration(goal.window)
  let windowStart: Date

  if (isCalendarBasedUnit(unit)) {
    const daysInWindow = unit === 'd' ? value : unit === 'w' ? value * 7 : value * 30
    windowStart = new Date(now)
    windowStart.setUTCHours(0, 0, 0, 0)
    windowStart.setUTCDate(windowStart.getUTCDate() - (daysInWindow - 1))
  } else {
    windowStart = new Date(now.getTime() - windowMs)
  }

  const oldestDayStart = new Date(windowStart)
  oldestDayStart.setUTCHours(0, 0, 0, 0)
  const oldestDayEnd = new Date(oldestDayStart)
  oldestDayEnd.setUTCHours(23, 59, 59, 999)

  const [current, losingTomorrow] = await Promise.all([
    getMetricSum(user, goal.metric, windowStart, now),
    getMetricSum(user, goal.metric, oldestDayStart, oldestDayEnd),
  ])

  return {
    current,
    goal_type: 'metric',
    id: goal.id,
    losing_tomorrow: losingTomorrow,
    max: goal.max,
    metric: goal.metric,
    min: goal.min,
    unit: metricUnits[goal.metric],
    window: goal.window,
  }
}

/**
 * Compute progress for a trend goal (EMA value).
 */
const computeTrendGoalProgress = async (user: string, goal: TrendGoal): Promise<TrendGoalProgress> => {
  const trend = await getTrend(user, {
    aggregation: goal.aggregation,
    display_period: goal.display_period,
    half_life_days: goal.half_life_days,
    lookback_days: 90,
    pattern: goal.pattern,
    source_type: goal.source_type,
  })

  return {
    current: trend.current_value,
    display_period: goal.display_period,
    display_unit: trend.display_unit,
    goal_type: 'trend',
    id: goal.id,
    max: goal.max,
    min: goal.min,
    pattern: goal.pattern,
    source_type: goal.source_type,
  }
}

/**
 * Get progress for all user goals.
 * Returns current value and targets for each goal.
 */
export const getGoalsProgress = async (user: string): Promise<GoalProgress[]> => {
  const goals = await getEffectiveGoals(user)

  if (goals.length === 0) {
    return []
  }

  const results: GoalProgress[] = []

  for (const goal of goals) {
    if (goal.goal_type === 'trend') {
      results.push(await computeTrendGoalProgress(user, goal))
    } else {
      results.push(await computeMetricGoalProgress(user, goal))
    }
  }

  return results
}

/**
 * Map full goal progress to flat widget format.
 * Merges both metric and trend goals into a simple { title, current, min, max, losing_tomorrow, unit }.
 */
const toWidgetProgress = (p: GoalProgress): WidgetGoalProgress => {
  if (p.goal_type === 'trend') {
    return {
      current: p.current,
      id: p.id,
      losing_tomorrow: 0,
      max: p.max,
      min: p.min,
      title: p.pattern,
      unit: p.display_unit,
    }
  }
  return {
    current: p.current,
    id: p.id,
    losing_tomorrow: p.losing_tomorrow,
    max: p.max,
    min: p.min,
    title: p.metric.replaceAll('_', ' '),
    unit: p.unit,
  }
}

/**
 * Get simplified goal progress for widgets (flat structure, no discriminated union).
 */
export const getWidgetGoalsProgress = async (user: string): Promise<WidgetGoalProgress[]> => {
  const progress = await getGoalsProgress(user)
  return progress.map(toWidgetProgress)
}
