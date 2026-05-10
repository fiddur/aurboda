/**
 * Multi-day nutrient + calories-burned summary for the Meals overview tab.
 *
 * Pulls every meal in [start, end] once, looks up junction rows for all of
 * them, then aggregates per local-day so the average can ignore days with
 * no meal data. Reuses NUTRIENT_FIELD_NAMES so the field set stays in sync
 * with the meal layer automatically.
 */

import type { NutrientPeriodSummary, NutrientPeriodStat } from '@aurboda/api-spec'

import { NUTRIENT_FIELD_NAMES } from '@aurboda/api-spec'

import {
  getMeals,
  getMealFoodItemsBatch,
  getTimeSeriesBucketed,
  type MealFoodItemLink,
} from '../../db/index.ts'
import { dateOnlyToRange } from '../../mcp/tz-utils.ts'

export interface MealPeriodSummaryInput {
  start: string // YYYY-MM-DD
  end: string // YYYY-MM-DD
  /** IANA tz used to bucket meals into local days; defaults to UTC. */
  tz?: string
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Inclusive day count between two YYYY-MM-DD strings (Date math is safe here
 * because both points are at midnight UTC).
 */
const inclusiveDayCount = (startDate: string, endDate: string): number => {
  const a = new Date(`${startDate}T00:00:00Z`).getTime()
  const b = new Date(`${endDate}T00:00:00Z`).getTime()
  return Math.floor((b - a) / DAY_MS) + 1
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * One-formatter-per-tz cache. `Intl.DateTimeFormat` is non-trivial to
 * construct (locale data lookup); a 90-day window with dozens of meals would
 * otherwise allocate a fresh formatter for every meal.
 */
const dateKeyFormatterCache = new Map<string, Intl.DateTimeFormat>()

const getDateKeyFormatter = (tz: string): Intl.DateTimeFormat => {
  let fmt = dateKeyFormatterCache.get(tz)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('sv-SE', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    dateKeyFormatterCache.set(tz, fmt)
  }
  return fmt
}

/** Convert a UTC Date to its local YYYY-MM-DD key for the given tz. */
const localDateKey = (d: Date, tz: string): string => getDateKeyFormatter(tz).format(d)

const aggregateNutrientsFromLinks = (links: MealFoodItemLink[]): Map<string, number> => {
  const totals = new Map<string, number>()
  for (const link of links) {
    for (const field of NUTRIENT_FIELD_NAMES) {
      const v = link[field]
      if (typeof v === 'number' && v > 0) {
        totals.set(field, (totals.get(field) ?? 0) + v)
      }
    }
  }
  return totals
}

/** Bucket meals into local-date keys and sum nutrient totals within each day. */
const accumulateDayTotals = (
  meals: Awaited<ReturnType<typeof getMeals>>,
  junctionMap: Map<string, MealFoodItemLink[]>,
  tz: string,
): Map<string, Map<string, number>> => {
  const dayTotals = new Map<string, Map<string, number>>()
  for (const meal of meals) {
    const links = junctionMap.get(meal.id)
    if (!links || links.length === 0) continue
    const dayKey = localDateKey(meal.time, tz)
    const day = dayTotals.get(dayKey) ?? new Map<string, number>()
    const mealTotals = aggregateNutrientsFromLinks(links)
    for (const [field, val] of mealTotals) {
      day.set(field, (day.get(field) ?? 0) + val)
    }
    dayTotals.set(dayKey, day)
  }
  return dayTotals
}

/**
 * Roll up per-day totals to per-nutrient stats. The avg denominator is the
 * count of days with **any** meal logged (passed in as `daysWithMeals`), not
 * the count of days that had a value for this specific nutrient — otherwise
 * intermittently-eaten nutrients (fiber, vitamin K) would average over a
 * smaller window and overstate adequacy. `days_with_value` is preserved as a
 * diagnostic so callers can spot data sparsity.
 */
const computeNutrientStats = (
  dayTotals: Map<string, Map<string, number>>,
  daysWithMeals: number,
): Record<string, NutrientPeriodStat> => {
  const perNutrientTotal = new Map<string, number>()
  const perNutrientDaysWithValue = new Map<string, number>()
  for (const day of dayTotals.values()) {
    for (const [field, val] of day) {
      perNutrientTotal.set(field, (perNutrientTotal.get(field) ?? 0) + val)
      perNutrientDaysWithValue.set(field, (perNutrientDaysWithValue.get(field) ?? 0) + 1)
    }
  }
  const stats: Record<string, NutrientPeriodStat> = {}
  for (const [field, total] of perNutrientTotal) {
    stats[field] = {
      avg: round2(daysWithMeals > 0 ? total / daysWithMeals : 0),
      total: round2(total),
      days_with_value: perNutrientDaysWithValue.get(field) ?? 0,
    }
  }
  return stats
}

const computeCaloriesBurned = async (
  user: string,
  start: Date,
  end: Date,
  tz: string,
): Promise<NutrientPeriodSummary['calories_burned']> => {
  const burnedBuckets = await getTimeSeriesBucketed(user, ['calories_total'], start, end, '1 day', tz)
  let total = 0
  let days = 0
  for (const bucket of burnedBuckets) {
    if (bucket.sum > 0) {
      total += bucket.sum
      days += 1
    }
  }
  return days > 0 ? { avg: round2(total / days), days_with_data: days } : null
}

export const getMealPeriodSummary = async (
  user: string,
  input: MealPeriodSummaryInput,
): Promise<NutrientPeriodSummary> => {
  const tz = input.tz ?? 'UTC'
  const { start } = dateOnlyToRange(input.start, tz)
  const { end } = dateOnlyToRange(input.end, tz)
  const daysInRange = inclusiveDayCount(input.start, input.end)

  const meals = await getMeals(user, { end, start })
  const junctionMap = await getMealFoodItemsBatch(
    user,
    meals.map((m) => m.id),
  )

  const dayTotals = accumulateDayTotals(meals, junctionMap, tz)
  const daysWithMeals = dayTotals.size
  const nutrients = computeNutrientStats(dayTotals, daysWithMeals)
  const calories_burned = await computeCaloriesBurned(user, start, end, tz)

  return {
    start: input.start,
    end: input.end,
    days_in_range: daysInRange,
    days_with_meals: daysWithMeals,
    nutrients,
    calories_burned,
  }
}
