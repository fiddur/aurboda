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
  /**
   * Of the `n` aligned pairs, how many have *complete* nutrition on every
   * nutrition side. Null when neither side is a nutrition dimension (the notion
   * doesn't apply). Lets the UI surface `n_complete` beside `n` so flag-only
   * days don't quietly inflate confidence.
   */
  n_complete: number | null
}

export interface ContinuousInput {
  triggerDaily: Map<string, number>
  outcomeDaily: Map<string, number>
  triggerKnown: string[]
  outcomeKnown: string[]
  lagDays: number
  /** Max points returned in `series` (default 1000). */
  maxSeriesPoints?: number
  /** Days the trigger is nutrition-complete (only when the trigger is nutrition). */
  triggerCompleteDays?: string[]
  /** Days the outcome is nutrition-complete (only when the outcome is nutrition). */
  outcomeCompleteDays?: string[]
  /** When true, drop aligned pairs that aren't nutrition-complete on every nutrition side. */
  requireComplete?: boolean
}

const MS_PER_DAY = 86_400_000

/** Shift a YYYY-MM-DD day string by a whole number of days (UTC). */
const shiftDay = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * MS_PER_DAY).toISOString().split('T')[0]

/** A nutrition-side day-set: null means "every day is complete" for that side. */
type CompleteSet = Set<string> | null

/** A pair is complete when every nutrition side present is complete on its day. */
const pairIsComplete = (
  day: string,
  outcomeDay: string,
  triggerComplete: CompleteSet,
  outcomeComplete: CompleteSet,
): boolean =>
  (triggerComplete === null || triggerComplete.has(day)) &&
  (outcomeComplete === null || outcomeComplete.has(outcomeDay))

/**
 * Pure continuous correlation. A day pair (d, d+lag) is used only when the
 * trigger is known on d and the outcome is known on d+lag. Missing values on a
 * known day default to 0 (e.g. a meal-log-completed day with no carbs).
 */
export const computeContinuous = (input: ContinuousInput): ContinuousResult => {
  const outcomeKnownSet = new Set(input.outcomeKnown)
  const triggerCompleteSet: CompleteSet = input.triggerCompleteDays
    ? new Set(input.triggerCompleteDays)
    : null
  const outcomeCompleteSet: CompleteSet = input.outcomeCompleteDays
    ? new Set(input.outcomeCompleteDays)
    : null
  const tracksCompleteness = triggerCompleteSet !== null || outcomeCompleteSet !== null
  const triggerValues: number[] = []
  const outcomeValues: number[] = []
  const series: AlignedPoint[] = []
  const cap = input.maxSeriesPoints ?? 1000
  let nComplete = 0

  // Iterate trigger-known days in chronological order for a tidy series.
  const triggerKnownSorted = [...input.triggerKnown].sort()
  for (const day of triggerKnownSorted) {
    const outcomeDay = shiftDay(day, input.lagDays)
    if (!outcomeKnownSet.has(outcomeDay)) continue
    const pairComplete = pairIsComplete(day, outcomeDay, triggerCompleteSet, outcomeCompleteSet)
    if (input.requireComplete && !pairComplete) continue
    const triggerValue = input.triggerDaily.get(day) ?? 0
    const outcomeValue = input.outcomeDaily.get(outcomeDay) ?? 0
    triggerValues.push(triggerValue)
    outcomeValues.push(outcomeValue)
    if (pairComplete) nComplete++
    if (series.length < cap) series.push({ date: day, trigger: triggerValue, outcome: outcomeValue })
  }

  return {
    n: triggerValues.length,
    lag_days: input.lagDays,
    pearson: pearson(triggerValues, outcomeValues),
    spearman: spearman(triggerValues, outcomeValues),
    series,
    group_comparison: computeGroupComparison(triggerValues, outcomeValues),
    n_complete: tracksCompleteness ? nComplete : null,
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
