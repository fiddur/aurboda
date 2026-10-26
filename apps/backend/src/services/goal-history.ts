import {
  activityMeasureUnits,
  cumulativeMetrics,
  type Goal,
  type GoalDayStatus,
  type GoalHistoryDay,
  type GoalHistoryMonth,
  type GoalHistoryQuery,
  type GoalHistoryResponse,
  type GoalHistorySummary,
  isCalendarBasedUnit,
  type MeasureGoal,
  type MetricGoal,
  metricUnits,
  type MetricType,
  parseDuration,
  type TrendGoal,
} from '@aurboda/api-spec'

import { getDailyAggregates, getDailyAggregateValues, getHrZoneSecs, getRawDailySums } from '../db/index.ts'
import { getCustomMetrics } from './custom-metrics.ts'
import { measureFilter, queryMeasuredActivities } from './queries/activity-measure-series.ts'
import { getEffectiveGoals, getEffectiveHrZones } from './settings.ts'
import { getTrend } from './trends.ts'

const DAY_MS = 24 * 60 * 60 * 1000

export const windowDays = (window: string): number => {
  const { ms, unit, value } = parseDuration(window)
  if (isCalendarBasedUnit(unit)) return unit === 'd' ? value : unit === 'w' ? value * 7 : value * 30
  return Math.max(1, Math.ceil(ms / DAY_MS))
}

export const utcDayKey = (d: Date): string => d.toISOString().slice(0, 10)

const dayStart = (key: string): Date => new Date(`${key}T00:00:00Z`)

const shiftDay = (key: string, days: number): string =>
  utcDayKey(new Date(dayStart(key).getTime() + days * DAY_MS))

export const dayKeysEndingAt = (today: Date, count: number): string[] => {
  const todayKey = utcDayKey(today)
  return Array.from({ length: count }, (_, i) => shiftDay(todayKey, i - (count - 1)))
}

export const goalStatus = (value: number, min?: number, max?: number): GoalDayStatus => {
  if (max !== undefined && value > max) return 'over'
  if (min === undefined || value >= min) return 'met'
  return 'below'
}

export const rollingSeries = (
  daily: Map<string, number>,
  days: string[],
  windowLength: number,
  todayKey: string,
): Omit<GoalHistoryDay, 'status'>[] =>
  days.map((date) => {
    let value = 0
    for (let i = 0; i < windowLength; i++) value += daily.get(shiftDay(date, -i)) ?? 0
    return { contribution: daily.get(date) ?? 0, date, partial: date === todayKey, value }
  })

/** Like `rollingSeries` with the window's max: `contribution` is the day's own best, 0 when none. */
export const rollingMaxSeries = (
  daily: Map<string, number>,
  days: string[],
  windowLength: number,
  todayKey: string,
): Omit<GoalHistoryDay, 'status'>[] =>
  days.map((date) => {
    let value = 0
    for (let i = 0; i < windowLength; i++) value = Math.max(value, daily.get(shiftDay(date, -i)) ?? 0)
    return { contribution: daily.get(date) ?? 0, date, partial: date === todayKey, value }
  })

const emptyCounts = (): GoalHistorySummary => ({ days_below: 0, days_met: 0, days_over: 0, days_total: 0 })

const countDay = (counts: GoalHistorySummary, status: GoalDayStatus): void => {
  counts[`days_${status}`]++
  counts.days_total++
}

export const summarize = (days: GoalHistoryDay[]): GoalHistorySummary => {
  const counts = emptyCounts()
  for (const d of days) if (!d.partial) countDay(counts, d.status)
  return counts
}

export const foldMonths = (days: GoalHistoryDay[]): GoalHistoryMonth[] => {
  const months = new Map<string, GoalHistoryMonth>()
  for (const d of days) {
    const month = d.date.slice(0, 7)
    let entry = months.get(month)
    if (!entry) {
      entry = { ...emptyCounts(), month, partial: false }
      months.set(month, entry)
    }
    if (d.partial) entry.partial = true
    else countDay(entry, d.status)
  }
  return [...months.values()]
}

const sumByDay = (rows: { date: string; sum: number }[]): Map<string, number> => {
  const sums = new Map<string, number>()
  for (const row of rows) sums.set(row.date, (sums.get(row.date) ?? 0) + row.sum)
  return sums
}

export const getDailyMetricSums = async (
  user: string,
  metric: MetricType,
  start: Date,
  end: Date,
): Promise<Map<string, number>> => {
  if (metric.startsWith('hr_zone_')) {
    const { zones } = await getEffectiveHrZones(user)
    const rows = await getHrZoneSecs(user, start, end, zones, '1d', 'UTC')
    const zoneIndex = parseInt(metric.replace('hr_zone_', '').replace('_sec', ''), 10) as
      | 0
      | 1
      | 2
      | 3
      | 4
      | 5
    const sums = new Map<string, number>()
    for (const row of rows) {
      if (row.bucket_start) sums.set(utcDayKey(row.bucket_start), row.secs[zoneIndex] ?? 0)
    }
    return sums
  }

  if (cumulativeMetrics.includes(metric)) {
    const values = await getDailyAggregateValues(user, metric, start, end)
    // Same last resort as getMetricSum in goals.ts: every source, so the history
    // agrees with the progress bar when steps come from a non-aggregate source.
    return values.size > 0 ? values : sumByDay(await getRawDailySums(user, metric, start, end))
  }

  return sumByDay(await getDailyAggregates(user, [metric], start, end))
}

const metricGoalDays = async (
  user: string,
  goal: MetricGoal,
  days: string[],
  today: Date,
): Promise<GoalHistoryDay[]> => {
  const w = windowDays(goal.window)
  const start = new Date(dayStart(days[0]).getTime() - (w - 1) * DAY_MS)
  const daily = await getDailyMetricSums(user, goal.metric, start, today)
  return rollingSeries(daily, days, w, utcDayKey(today)).map((d) => ({
    ...d,
    status: goalStatus(d.value, goal.min, goal.max),
  }))
}

const measureGoalDays = async (
  user: string,
  goal: MeasureGoal,
  days: string[],
  today: Date,
): Promise<GoalHistoryDay[]> => {
  const w = windowDays(goal.window)
  const start = new Date(dayStart(days[0]).getTime() - (w - 1) * DAY_MS)
  const measured = await queryMeasuredActivities(
    user,
    goal.activity_type,
    start,
    today,
    measureFilter(goal.filter_field, goal.filter_value),
  )
  const combine = goal.aggregation === 'max' ? Math.max : (a: number, b: number) => a + b
  const daily = new Map<string, number>()
  for (const { activity, measures } of measured) {
    const value = measures[goal.measure]
    if (value === undefined) continue
    const key = utcDayKey(activity.start_time)
    const prev = daily.get(key)
    daily.set(key, prev === undefined ? value : combine(prev, value))
  }
  const series = goal.aggregation === 'max' ? rollingMaxSeries : rollingSeries
  return series(daily, days, w, utcDayKey(today)).map((d) => ({
    ...d,
    status: goalStatus(d.value, goal.min, goal.max),
  }))
}

const trendGoalHistory = async (
  user: string,
  goal: TrendGoal,
  lookbackDays: number,
  todayKey: string,
): Promise<{ days: GoalHistoryDay[]; unit: string }> => {
  const customMetrics = await getCustomMetrics(user)
  const trend = await getTrend(user, {
    aggregation: goal.aggregation,
    custom_metrics: customMetrics,
    display_period: goal.display_period,
    half_life_days: goal.half_life_days,
    lookback_days: lookbackDays,
    pattern: goal.pattern,
    source_type: goal.source_type,
  })
  const days = trend.history.map(({ date, value }) => ({
    date,
    partial: date === todayKey,
    status: goalStatus(value, goal.min, goal.max),
    value,
  }))
  return { days, unit: trend.display_unit }
}

const goalDaysAndUnit = async (
  user: string,
  goal: Goal,
  query: GoalHistoryQuery,
  today: Date,
): Promise<{ days: GoalHistoryDay[]; unit: string }> => {
  if (goal.goal_type === 'trend') return trendGoalHistory(user, goal, query.lookback_days, utcDayKey(today))
  const keys = dayKeysEndingAt(today, query.lookback_days + 1)
  if (goal.goal_type === 'measure') {
    return { days: await measureGoalDays(user, goal, keys, today), unit: activityMeasureUnits[goal.measure] }
  }
  return { days: await metricGoalDays(user, goal, keys, today), unit: metricUnits[goal.metric] }
}

export const getGoalHistory = async (
  user: string,
  goalId: string,
  query: GoalHistoryQuery,
): Promise<GoalHistoryResponse | null> => {
  const goals = await getEffectiveGoals(user)
  const goal = goals.find((g) => g.id === goalId)
  if (!goal) return null

  const { days, unit } = await goalDaysAndUnit(user, goal, query, new Date())

  return {
    bucket: query.bucket,
    ...(query.bucket === 'month' ? { months: foldMonths(days) } : { days }),
    goal,
    max: goal.max,
    min: goal.min,
    success: true,
    summary: summarize(days),
    unit,
  }
}
