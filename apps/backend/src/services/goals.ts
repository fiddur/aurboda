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

import { getDailyAggregates, getDailyAggregateValues, getHrZoneSecs, getRawDailySum } from '../db/index.ts'
import { getEffectiveGoals, getEffectiveHrZones } from './settings.ts'
import { getTrend } from './trends.ts'

/**
 * Handles HR zone metrics specially (computed from heart_rate).
 * Uses deduplicated aggregates for cumulative metrics (steps, distance, etc.).
 */
const getMetricSum = async (user: string, metric: MetricType, start: Date, end: Date): Promise<number> => {
  if (metric.startsWith('hr_zone_')) {
    const { zones } = await getEffectiveHrZones(user)
    const [row] = await getHrZoneSecs(user, start, end, zones)
    const zoneIndex = parseInt(metric.replace('hr_zone_', '').replace('_sec', ''), 10) as
      | 0
      | 1
      | 2
      | 3
      | 4
      | 5
    return row?.secs[zoneIndex] ?? 0
  }

  if (cumulativeMetrics.includes(metric)) {
    const values = await getDailyAggregateValues(user, metric, start, end)
    if (values.size > 0) {
      let sum = 0
      for (const v of values.values()) sum += v
      return sum
    }

    // Fall back to raw data from ALL sources if no aggregates exist.
    // This may double-count but is better than showing 0.
    return getRawDailySum(user, metric, start, end)
  }

  const dailyData = await getDailyAggregates(user, [metric], start, end)
  return dailyData.reduce((sum, day) => sum + day.sum, 0)
}

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

export const getGoalsProgress = async (user: string): Promise<GoalProgress[]> => {
  const goals = await getEffectiveGoals(user)

  if (goals.length === 0) {
    return []
  }

  return Promise.all(
    goals.map((goal) =>
      goal.goal_type === 'trend'
        ? computeTrendGoalProgress(user, goal)
        : computeMetricGoalProgress(user, goal),
    ),
  )
}

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

export const getWidgetGoalsProgress = async (user: string): Promise<WidgetGoalProgress[]> => {
  const progress = await getGoalsProgress(user)
  return progress.map(toWidgetProgress)
}
