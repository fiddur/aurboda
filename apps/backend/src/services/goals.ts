import {
  measureGoalTitle,
  activityMeasureUnits,
  type ActivityTypeDefinition,
  cumulativeMetrics,
  type CustomMetricDefinition,
  isCalendarBasedUnit,
  type MeasureGoal,
  type MeasureGoalProgress,
  metricUnits,
  parseDuration,
  type GoalProgress,
  type MetricGoalProgress,
  type MetricType,
  type TrendGoal,
  type TrendGoalProgress,
  type WidgetGoalProgress,
} from '@aurboda/api-spec'

import {
  getActivityTypeDefinitions,
  getDailyAggregates,
  getDailyAggregateValues,
  getHrZoneSecs,
  getRawDailySum,
} from '../db/index.ts'
import { getCustomMetrics } from './custom-metrics.ts'
import { dayEndInTz, dayKey, dayStartInTz, shiftDayKey } from './day-keys.ts'
import { measureFilter, queryMeasuredActivities } from './queries/activity-measure-series.ts'
import { getEffectiveGoals, getEffectiveHrZones, getUserTimezone } from './settings.ts'
import { getTrend } from './trends.ts'

/**
 * Handles HR zone metrics specially (computed from heart_rate).
 * Uses deduplicated aggregates for cumulative metrics (steps, distance, etc.).
 */
const getMetricSum = async (
  user: string,
  metric: MetricType,
  start: Date,
  end: Date,
  tz: string,
): Promise<number> => {
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
    const values = await getDailyAggregateValues(user, metric, start, end, tz)
    if (values.size > 0) {
      let sum = 0
      for (const v of values.values()) sum += v
      return sum
    }

    // Fall back to raw data from ALL sources if no aggregates exist.
    // This may double-count but is better than showing 0.
    return getRawDailySum(user, metric, start, end)
  }

  const dailyData = await getDailyAggregates(user, [metric], start, end, tz)
  return dailyData.reduce((sum, day) => sum + day.sum, 0)
}

/**
 * The window ending `now` and its oldest day, as calendar days in `tz`: calendar units (days,
 * weeks, months) start at local midnight in `tz`, time units exactly the duration back.
 */
const goalWindow = (
  window: string,
  now: Date,
  tz: string,
): { oldestDayEnd: Date; oldestDayStart: Date; windowStart: Date } => {
  const { ms: windowMs, unit, value } = parseDuration(window)
  let windowStart: Date

  if (isCalendarBasedUnit(unit)) {
    const daysInWindow = unit === 'd' ? value : unit === 'w' ? value * 7 : value * 30
    windowStart = dayStartInTz(shiftDayKey(dayKey(now, tz), -(daysInWindow - 1)), tz)
  } else {
    windowStart = new Date(now.getTime() - windowMs)
  }

  const oldestKey = dayKey(windowStart, tz)
  return { oldestDayEnd: dayEndInTz(oldestKey, tz), oldestDayStart: dayStartInTz(oldestKey, tz), windowStart }
}

const computeMetricGoalProgress = async (
  user: string,
  goal: { id: string; max?: number; metric: MetricType; min?: number; window: string },
  tz: string,
): Promise<MetricGoalProgress> => {
  const now = new Date()
  const { oldestDayEnd, oldestDayStart, windowStart } = goalWindow(goal.window, now, tz)

  const [current, losingTomorrow] = await Promise.all([
    getMetricSum(user, goal.metric, windowStart, now, tz),
    getMetricSum(user, goal.metric, oldestDayStart, oldestDayEnd, tz),
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

export interface DatedValue {
  time: Date
  value: number
}

/**
 * A measure goal's value over the window's session values, and what leaves with the oldest day:
 * for sum that day's total; for max, how far the best falls when every session holding it is on
 * that day (all of it when no later session has the measure).
 */
export const measureGoalValues = (
  values: DatedValue[],
  aggregation: MeasureGoal['aggregation'],
  oldestDayEnd: Date,
): { current: number; losing_tomorrow: number } => {
  const onOldestDay = (v: DatedValue) => v.time.getTime() <= oldestDayEnd.getTime()
  const oldest = values.filter(onOldestDay)
  const later = values.filter((v) => !onOldestDay(v))
  if (aggregation === 'sum') {
    const total = (list: DatedValue[]) => list.reduce((sum, v) => sum + v.value, 0)
    return { current: total(values), losing_tomorrow: total(oldest) }
  }
  if (values.length === 0) return { current: 0, losing_tomorrow: 0 }
  const current = Math.max(...values.map((v) => v.value))
  const laterBest = later.length > 0 ? Math.max(...later.map((v) => v.value)) : 0
  return { current, losing_tomorrow: laterBest < current ? current - laterBest : 0 }
}

const computeMeasureGoalProgress = async (
  user: string,
  goal: MeasureGoal,
  definitions: ActivityTypeDefinition[],
  tz: string,
): Promise<MeasureGoalProgress> => {
  const now = new Date()
  const { oldestDayEnd, windowStart } = goalWindow(goal.window, now, tz)
  const measured = await queryMeasuredActivities(
    user,
    goal.activity_type,
    windowStart,
    now,
    measureFilter(goal.filter_field, goal.filter_value),
  )
  const values = measured.flatMap(({ activity, measures }) => {
    const value = measures[goal.measure]
    return value === undefined ? [] : [{ time: activity.start_time, value }]
  })
  const { current, losing_tomorrow } = measureGoalValues(values, goal.aggregation, oldestDayEnd)

  return {
    activity_type: goal.activity_type,
    activity_type_name:
      definitions.find((d) => d.name === goal.activity_type)?.display_name ?? goal.activity_type,
    aggregation: goal.aggregation,
    current,
    filter_value: goal.filter_value,
    goal_type: 'measure',
    id: goal.id,
    losing_tomorrow,
    max: goal.max,
    measure: goal.measure,
    min: goal.min,
    unit: activityMeasureUnits[goal.measure],
    window: goal.window,
  }
}

/**
 * Compute progress for a trend goal (EMA value).
 */
const computeTrendGoalProgress = async (
  user: string,
  goal: TrendGoal,
  customMetrics: CustomMetricDefinition[],
): Promise<TrendGoalProgress> => {
  const trend = await getTrend(user, {
    aggregation: goal.aggregation,
    custom_metrics: customMetrics,
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

  const [customMetrics, definitions, tz] = await Promise.all([
    goals.some((goal) => goal.goal_type === 'trend') ? getCustomMetrics(user) : [],
    goals.some((goal) => goal.goal_type === 'measure') ? getActivityTypeDefinitions(user) : [],
    getUserTimezone(user),
  ])

  return Promise.all(
    goals.map((goal) => {
      if (goal.goal_type === 'trend') return computeTrendGoalProgress(user, goal, customMetrics)
      if (goal.goal_type === 'measure') return computeMeasureGoalProgress(user, goal, definitions, tz)
      return computeMetricGoalProgress(user, goal, tz)
    }),
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
  if (p.goal_type === 'measure') {
    return {
      current: p.current,
      id: p.id,
      losing_tomorrow: p.losing_tomorrow,
      max: p.max,
      min: p.min,
      title: measureGoalTitle(p.measure, p.filter_value, p.activity_type_name),
      unit: p.unit,
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
