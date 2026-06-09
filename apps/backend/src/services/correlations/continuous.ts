/**
 * Continuous daily correlation: align two daily series on the days where both
 * are known and compute Pearson + Spearman, with an optional day-lag shift so
 * questions like "how does carb intake affect my sleep the next day?" work.
 */

import { type TwoGroupComparison, pearson, spearman, twoGroupComparison } from './stats.ts'

/**
 * Group comparison for a binary/presence trigger: how the continuous outcome
 * differs between days the trigger was present vs absent. A Pearson r on a 0/1
 * trigger is misleading, so this answers "how much does X change Y?" directly.
 */
export interface GroupComparison extends TwoGroupComparison {
  /** True when every aligned trigger value is exactly 0 or 1. */
  trigger_is_binary: boolean
}

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
  /**
   * Present-vs-absent group comparison of the outcome. Null when the trigger is
   * never present or always present (no split to compare).
   */
  group_comparison: GroupComparison | null
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
    group_comparison: computeGroupComparison(triggerValues, outcomeValues),
  }
}

/**
 * Split the outcome by whether the trigger was present (value > 0) on the same
 * aligned day and compare the two groups. Returns null when there is nothing to
 * compare (the trigger is present on every day or on none).
 */
const computeGroupComparison = (triggerValues: number[], outcomeValues: number[]): GroupComparison | null => {
  const withValues: number[] = []
  const withoutValues: number[] = []
  for (let i = 0; i < triggerValues.length; i++) {
    if (triggerValues[i] > 0) withValues.push(outcomeValues[i])
    else withoutValues.push(outcomeValues[i])
  }
  if (withValues.length === 0 || withoutValues.length === 0) return null
  return {
    ...twoGroupComparison(withValues, withoutValues),
    trigger_is_binary: triggerValues.every((v) => v === 0 || v === 1),
  }
}
