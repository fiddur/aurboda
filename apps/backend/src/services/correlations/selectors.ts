/**
 * Selector resolution for the generic correlation engine.
 *
 * A Selector describes any data dimension (tag/activity, metric, nutrition,
 * productivity) and resolves to a uniform shape: discrete event days (for the
 * event-outcome engine), a daily value series (for continuous correlation), and
 * the set of days where the dimension's status is known (the denominator).
 *
 * Everything is bucketed by UTC calendar day so metrics, nutrients and events
 * align regardless of process/DB timezone (matching getDailyNutrientTotals).
 */

import type { NutrientKey } from '../../db/index.ts'

import {
  getAllActivitiesInRange,
  getDailyNutrientTotals,
  getMealLogCompletedInRange,
  getNutritionCompleteDaysInRange,
  getProductivity,
  getTimeSeries,
} from '../../db/index.ts'

/** Comparison used to turn a numeric value into a discrete event. */
export interface ThresholdSpec {
  op: 'gt' | 'gte' | 'lt' | 'lte'
  value: number
}

export interface TagSelector {
  kind: 'tag'
  /** Regex (case-insensitive) matched against activity_type. */
  pattern: string
}

export interface ActivitySelector {
  kind: 'activity'
  pattern: string
  /** Daily measure for continuous mode (default 'count'). */
  measure?: 'count' | 'duration_min'
}

export interface MetricSelector {
  kind: 'metric'
  metric: string
  /** Daily aggregation for continuous mode (default 'avg'). */
  agg?: 'avg' | 'sum'
  /** Threshold for event mode (default: value > 0). */
  threshold?: ThresholdSpec
}

export interface NutritionSelector {
  kind: 'nutrition'
  nutrient: NutrientKey
  /** Threshold for event mode (default: value > 0). */
  threshold?: ThresholdSpec
}

export interface ProductivitySelector {
  kind: 'productivity_category' | 'productivity_app'
  pattern: string
}

export type Selector =
  | TagSelector
  | ActivitySelector
  | MetricSelector
  | NutritionSelector
  | ProductivitySelector

/** Uniform resolved representation of a selector over a date range. */
export interface ResolvedSeries {
  /** Days (YYYY-MM-DD) with at least one event under the selector's threshold. */
  eventDays: string[]
  /** Daily value series, date -> aggregated value (days with data only). */
  daily: Map<string, number>
  /** Days where the dimension's status is known (the denominator universe). */
  knownDays: string[]
  /**
   * Days with *complete* data, when the dimension distinguishes complete from
   * partial logging. Only nutrition populates this (days with real macros, vs
   * flag-only days); undefined for dimensions where every known day is complete.
   */
  completeDays?: string[]
}

const MS_PER_DAY = 86_400_000

/** UTC calendar day (YYYY-MM-DD) for an instant. */
const toUtcDay = (date: Date): string => date.toISOString().split('T')[0]

/** All UTC days in the inclusive [start, end] range. */
const enumerateDays = (start: Date, end: Date): string[] => {
  const days: string[] = []
  let cur = Date.parse(`${toUtcDay(start)}T00:00:00Z`)
  const last = Date.parse(`${toUtcDay(end)}T00:00:00Z`)
  while (cur <= last) {
    days.push(new Date(cur).toISOString().split('T')[0])
    cur += MS_PER_DAY
  }
  return days
}

/** Case-insensitive regex match with a plain-substring fallback. */
const matchesPattern = (value: string, pattern: string): boolean => {
  try {
    return new RegExp(pattern, 'i').test(value)
  } catch {
    return value.toLowerCase().includes(pattern.toLowerCase())
  }
}

/** Apply a threshold (default: strictly greater than 0). */
const passesThreshold = (value: number, threshold?: ThresholdSpec): boolean => {
  if (!threshold) return value > 0
  switch (threshold.op) {
    case 'gt':
      return value > threshold.value
    case 'gte':
      return value >= threshold.value
    case 'lt':
      return value < threshold.value
    case 'lte':
      return value <= threshold.value
  }
}

/** Build a resolved series from per-day values plus an explicit known-day set. */
const fromDailyValues = (
  daily: Map<string, number>,
  knownDays: string[],
  threshold: ThresholdSpec | undefined,
): ResolvedSeries => {
  const eventDays: string[] = []
  for (const [day, value] of daily) {
    if (passesThreshold(value, threshold)) eventDays.push(day)
  }
  return { eventDays, daily, knownDays }
}

/** Sum or count activity occurrences per day. */
const resolveActivity = async (
  user: string,
  selector: TagSelector | ActivitySelector,
  start: Date,
  end: Date,
): Promise<ResolvedSeries> => {
  const activities = await getAllActivitiesInRange(user, start, end)
  const measure = selector.kind === 'activity' ? (selector.measure ?? 'count') : 'count'
  const daily = new Map<string, number>()

  for (const act of activities) {
    if (!matchesPattern(act.activity_type, selector.pattern)) continue
    const day = toUtcDay(act.start_time)
    const increment =
      measure === 'duration_min' && act.end_time
        ? (act.end_time.getTime() - act.start_time.getTime()) / 60_000
        : measure === 'duration_min'
          ? 0
          : 1
    daily.set(day, (daily.get(day) ?? 0) + increment)
  }

  // Absence of a tag/activity is a known "no event", so every day is known.
  return fromDailyValues(daily, enumerateDays(start, end), undefined)
}

/** Aggregate metric entries per day; events are days passing the threshold. */
const resolveMetric = async (
  user: string,
  selector: MetricSelector,
  start: Date,
  end: Date,
): Promise<ResolvedSeries> => {
  const entries = await getTimeSeries(user, selector.metric, start, end)
  const agg = selector.agg ?? 'avg'
  const sums = new Map<string, number>()
  const counts = new Map<string, number>()
  // Track whether any single entry on the day passes the threshold (event mode).
  const eventDaySet = new Set<string>()

  for (const [time, value] of entries) {
    const day = toUtcDay(time)
    sums.set(day, (sums.get(day) ?? 0) + value)
    counts.set(day, (counts.get(day) ?? 0) + 1)
    if (passesThreshold(value, selector.threshold)) eventDaySet.add(day)
  }

  const daily = new Map<string, number>()
  for (const [day, sum] of sums) {
    daily.set(day, agg === 'sum' ? sum : sum / (counts.get(day) ?? 1))
  }

  // A metric's status is known only on days it was logged (incl. explicit 0s).
  return { eventDays: [...eventDaySet], daily, knownDays: [...sums.keys()] }
}

/** Daily nutrient totals; known days include meal-log-completed zero days. */
const resolveNutrition = async (
  user: string,
  selector: NutritionSelector,
  start: Date,
  end: Date,
): Promise<ResolvedSeries> => {
  const [totals, completed, completeDays] = await Promise.all([
    getDailyNutrientTotals(user, [selector.nutrient], start, end),
    getMealLogCompletedInRange(user, toUtcDay(start), toUtcDay(end)),
    getNutritionCompleteDaysInRange(user, selector.nutrient, start, end),
  ])

  const daily = new Map<string, number>()
  for (const t of totals) daily.set(t.date, t.total)

  // Known = any day with a meal logged, plus days the user marked complete
  // (a completed day with no meal is a true zero, not unknown).
  const knownSet = new Set<string>([...daily.keys(), ...completed])
  for (const day of completed) if (!daily.has(day)) daily.set(day, 0)

  // Complete = days with a real logged value for *this* nutrient, so callers can
  // exclude or count flag-only days that otherwise read as noisy zeros.
  return { ...fromDailyValues(daily, [...knownSet], selector.threshold), completeDays }
}

/** Productivity minutes per day for a matching category or app. */
const resolveProductivity = async (
  user: string,
  selector: ProductivitySelector,
  start: Date,
  end: Date,
): Promise<ResolvedSeries> => {
  const records = await getProductivity(user, start, end)
  const daily = new Map<string, number>()

  for (const rec of records) {
    const haystack =
      selector.kind === 'productivity_category'
        ? (rec.resolved_category?.join(' > ') ?? rec.category ?? '')
        : rec.activity
    if (!matchesPattern(haystack, selector.pattern)) continue
    const day = toUtcDay(rec.start_time)
    daily.set(day, (daily.get(day) ?? 0) + rec.duration_sec / 60)
  }

  return fromDailyValues(daily, enumerateDays(start, end), undefined)
}

/** Resolve any selector to its uniform representation over [start, end]. */
export const resolveSelector = (
  user: string,
  selector: Selector,
  start: Date,
  end: Date,
): Promise<ResolvedSeries> => {
  switch (selector.kind) {
    case 'tag':
    case 'activity':
      return resolveActivity(user, selector, start, end)
    case 'metric':
      return resolveMetric(user, selector, start, end)
    case 'nutrition':
      return resolveNutrition(user, selector, start, end)
    case 'productivity_category':
    case 'productivity_app':
      return resolveProductivity(user, selector, start, end)
  }
}
