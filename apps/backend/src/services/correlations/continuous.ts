/**
 * Continuous daily correlation: align two daily series on the days where both
 * are known and compute Pearson + Spearman, with an optional day-lag shift so
 * questions like "how does carb intake affect my sleep the next day?" work.
 */

import { pearson, spearman } from './stats.ts'

export interface AlignedPoint {
  /** Trigger day (YYYY-MM-DD). */
  date: string
  /** Trigger value on `date`. */
  trigger: number
  /** Outcome value on `date` + lag_days. */
  outcome: number
}

export interface ContinuousResult {
  /** Number of aligned day pairs used. */
  n: number
  /** Lag in days (outcome measured this many days after the trigger). */
  lag_days: number
  /** Pearson correlation, or null when fewer than 3 pairs / no variance. */
  pearson: number | null
  /** Spearman rank correlation, or null when fewer than 3 pairs. */
  spearman: number | null
  /** Aligned series (for plotting); capped to avoid huge payloads. */
  series: AlignedPoint[]
}

export interface ContinuousInput {
  triggerDaily: Map<string, number>
  outcomeDaily: Map<string, number>
  triggerKnown: string[]
  outcomeKnown: string[]
  lagDays: number
  /** Max points returned in `series` (default 1000). */
  maxSeriesPoints?: number
}

const MS_PER_DAY = 86_400_000

/** Shift a YYYY-MM-DD day string by a whole number of days (UTC). */
const shiftDay = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * MS_PER_DAY).toISOString().split('T')[0]

/**
 * Pure continuous correlation. A day pair (d, d+lag) is used only when the
 * trigger is known on d and the outcome is known on d+lag. Missing values on a
 * known day default to 0 (e.g. a meal-log-completed day with no carbs).
 */
export const computeContinuous = (input: ContinuousInput): ContinuousResult => {
  const outcomeKnownSet = new Set(input.outcomeKnown)
  const triggerValues: number[] = []
  const outcomeValues: number[] = []
  const series: AlignedPoint[] = []
  const cap = input.maxSeriesPoints ?? 1000

  // Iterate trigger-known days in chronological order for a tidy series.
  const triggerKnownSorted = [...input.triggerKnown].sort()
  for (const day of triggerKnownSorted) {
    const outcomeDay = shiftDay(day, input.lagDays)
    if (!outcomeKnownSet.has(outcomeDay)) continue
    const triggerValue = input.triggerDaily.get(day) ?? 0
    const outcomeValue = input.outcomeDaily.get(outcomeDay) ?? 0
    triggerValues.push(triggerValue)
    outcomeValues.push(outcomeValue)
    if (series.length < cap) series.push({ date: day, trigger: triggerValue, outcome: outcomeValue })
  }

  return {
    n: triggerValues.length,
    lag_days: input.lagDays,
    pearson: pearson(triggerValues, outcomeValues),
    spearman: spearman(triggerValues, outcomeValues),
    series,
  }
}
