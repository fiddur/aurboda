/**
 * A Selector describes any data dimension (tag/activity, metric, nutrition,
 * productivity, sensitivity, time with people) and resolves to a uniform shape: discrete event days (for the
 * event-outcome engine), a daily value series (for continuous correlation), and
 * the set of days where the dimension's status is known (the denominator).
 *
 * Everything is bucketed by UTC calendar day so metrics, nutrients and events
 * align regardless of process/DB timezone (matching getDailyNutrientTotals). A meal sensitivity
 * keeps the same day keys but files each meal under the user's local date, the day
 * `meal_log_completed` marks complete.
 */

import type { NutrientKey, TimeInterval } from '../../db/index.ts'

import {
  getEffectiveActivitiesInRange,
  getDailyNutrientTotals,
  getMealFlagsInRange,
  getMealLogCompletedInRange,
  getNutritionCompleteDaysInRange,
  getProductivity,
  getTimeSeries,
  listActivityIntervalsWithPeople,
} from '../../db/index.ts'
import { getUserTimezone } from '../settings.ts'
import { localDate } from '../sleep-debt.ts'
import { sampleMean } from '../time-weighted-mean.ts'

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

export interface SensitivitySelector {
  kind: 'sensitivity'
  /** Sensitivity flag id. */
  flag: string
  /** Threshold for event mode on the daily count of flagged meals (default: value > 0). */
  threshold?: ThresholdSpec
}

export interface PeopleSelector {
  kind: 'people'
  /** Absent: time with anyone. */
  person_id?: string
  /** Threshold for event mode on the daily minutes (default: value > 0). */
  threshold?: ThresholdSpec
}

export type Selector =
  | PeopleSelector
  | TagSelector
  | ActivitySelector
  | MetricSelector
  | NutritionSelector
  | ProductivitySelector
  | SensitivitySelector

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
   * partial logging: for nutrition the days with real macros (vs flag-only
   * days), for a sensitivity the days marked meal log completed; undefined for
   * dimensions where every known day is complete.
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
  const activities = await getEffectiveActivitiesInRange(user, start, end)
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
  const byDay = new Map<string, [Date, number][]>()
  // Track whether any single entry on the day passes the threshold (event mode).
  const eventDaySet = new Set<string>()

  for (const entry of entries) {
    const day = toUtcDay(entry[0])
    byDay.getOrInsert(day, []).push(entry)
    if (passesThreshold(entry[1], selector.threshold)) eventDaySet.add(day)
  }

  const daily = new Map<string, number>()
  for (const [day, dayEntries] of byDay) {
    daily.set(
      day,
      agg === 'sum'
        ? dayEntries.reduce((sum, [, value]) => sum + value, 0)
        : (sampleMean(selector.metric, dayEntries) ?? 0),
    )
  }

  // A metric's status is known only on days it was logged (incl. explicit 0s).
  return { eventDays: [...eventDaySet], daily, knownDays: [...byDay.keys()] }
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
  for (const day of completed) daily.getOrInsert(day, 0)

  // Complete = days with a real logged value for *this* nutrient, so callers can
  // exclude or count flag-only days that otherwise read as noisy zeros.
  return { ...fromDailyValues(daily, [...knownSet], selector.threshold), completeDays }
}

/**
 * Meals carrying the flag per day. Known days follow resolveNutrition: a day with any meal, or one
 * marked meal log completed; a known day without a flagged meal is 0.
 */
const resolveSensitivity = async (
  user: string,
  selector: SensitivitySelector,
  start: Date,
  end: Date,
): Promise<ResolvedSeries> => {
  const tz = await getUserTimezone(user)
  const firstDay = toUtcDay(start)
  const lastDay = toUtcDay(end)
  const [meals, completed] = await Promise.all([
    getMealFlagsInRange(user, new Date(start.getTime() - MS_PER_DAY), new Date(end.getTime() + MS_PER_DAY)),
    getMealLogCompletedInRange(user, firstDay, lastDay),
  ])

  const daily = new Map<string, number>()
  for (const meal of meals) {
    const day = localDate(meal.time, tz)
    if (day < firstDay || day > lastDay) continue
    daily.set(day, (daily.get(day) ?? 0) + (meal.flag_ids.includes(selector.flag) ? 1 : 0))
  }
  for (const day of completed) daily.getOrInsert(day, 0)

  return { ...fromDailyValues(daily, [...daily.keys()], selector.threshold), completeDays: completed }
}

/**
 * Minutes per UTC day covered by `intervals`, overlapping time counted once, inside the days of
 * [start, end]. Days without any time are absent.
 */
export const unionMinutesPerDay = (
  intervals: TimeInterval[],
  start: Date,
  end: Date,
): Map<string, number> => {
  const lower = Date.parse(`${toUtcDay(start)}T00:00:00Z`)
  const upper = Date.parse(`${toUtcDay(end)}T00:00:00Z`) + MS_PER_DAY
  const clipped = intervals
    .map((i) => [Math.max(i.start_time.getTime(), lower), Math.min(i.end_time.getTime(), upper)] as const)
    .filter(([from, to]) => to > from)
    .toSorted((a, b) => a[0] - b[0])

  const merged: [number, number][] = []
  for (const [from, to] of clipped) {
    const last = merged.at(-1)
    if (last && from <= last[1]) last[1] = Math.max(last[1], to)
    else merged.push([from, to])
  }

  const daily = new Map<string, number>()
  for (const [from, to] of merged) {
    let cur = from
    while (cur < to) {
      const dayEnd = Math.min(to, Math.floor(cur / MS_PER_DAY) * MS_PER_DAY + MS_PER_DAY)
      const day = toUtcDay(new Date(cur))
      daily.set(day, (daily.get(day) ?? 0) + (dayEnd - cur) / 60_000)
      cur = dayEnd
    }
  }
  return daily
}

/** Minutes per day with people (or one person); absence of company is a known 0, so every day is known. */
const resolvePeople = async (
  user: string,
  selector: PeopleSelector,
  start: Date,
  end: Date,
): Promise<ResolvedSeries> => {
  const intervals = await listActivityIntervalsWithPeople(user, start, end, selector.person_id)
  return fromDailyValues(
    unionMinutesPerDay(intervals, start, end),
    enumerateDays(start, end),
    selector.threshold,
  )
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
    case 'sensitivity':
      return resolveSensitivity(user, selector, start, end)
    case 'people':
      return resolvePeople(user, selector, start, end)
  }
}
