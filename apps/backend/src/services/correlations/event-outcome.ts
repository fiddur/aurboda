/**
 * Event-outcome correlation with onset-collapsing and exposure/base-rate
 * correction (issue #792).
 *
 * Answers "does trigger X precede flare/event Y?" for presence-only outcomes
 * (e.g. back_pain, fissure_pain) where the outcome metric only has entries on
 * "bad" days. The naive approach — averaging the metric — is meaningless there.
 *
 * The model works at UTC-day granularity:
 *  - The outcome's discrete days are collapsed into onsets (a multi-day flare
 *    becomes one event) so long episodes don't dominate.
 *  - A known day is "exposed" when a trigger occurred within the lag window
 *    ending on that day.
 *  - Effect is the onset rate among exposed days vs unexposed days, computed
 *    only over days where the outcome status is known (the denominator), with a
 *    relative risk + 95% CI and a chi-squared / Fisher p-value.
 *  - The headline is the reverse conditional P(recent trigger | onset) — the
 *    user's actual question — reported beside the base rate.
 */

import { type ContingencyTable, riskRatio, significance2x2 } from './stats.ts'

/** Result for a single lag window. */
export interface LagExposureResult {
  /** Lag window label as supplied (e.g. "48h", "7d"). */
  lag: string
  /** Lag window length in days after parsing/rounding. */
  lag_days: number
  /** Days where outcome status is known (the denominator universe). */
  known_days: number
  /** Onset count (after collapsing) that fall on known days. */
  onsets: number
  /** Onsets that were exposed (a trigger within the lag window). */
  onsets_exposed: number
  /** Known days that were exposed (a + b). */
  exposed_days: number
  /** Known days that were not exposed (c + d). */
  unexposed_days: number
  /** P(a known day is exposed) — the base rate. */
  base_rate: number
  /** P(exposed | onset) — the reverse conditional headline. */
  reverse_conditional: number
  /** Onsets expected to be exposed under the base rate (onsets * base_rate). */
  expected_onsets_exposed: number
  /** Onset rate among exposed days / onset rate among unexposed days. */
  relative_risk: number | null
  /** Lower bound of the 95% CI for relative risk. */
  ci_low: number | null
  /** Upper bound of the 95% CI for relative risk. */
  ci_high: number | null
  /** Difference in onset rate (exposed minus unexposed). */
  risk_difference: number
  /** Chi-squared statistic (null when Fisher's exact test was used). */
  chi_squared: number | null
  /** Two-sided p-value. */
  p_value: number
  /** Which significance test produced the p-value. */
  test: 'chi_squared' | 'fisher'
}

export interface EventOutcomeInput {
  /** UTC day strings (YYYY-MM-DD) on which a trigger occurred. */
  triggerDays: string[]
  /** UTC day strings on which the outcome occurred (raw, pre-collapse). */
  outcomeDays: string[]
  /** UTC day strings where the outcome status is known (denominator universe). */
  knownDays: string[]
  /** Lag windows to evaluate (e.g. ["24h", "48h", "7d"]). */
  lagWindows: string[]
  /** Consecutive outcome days within this gap collapse into one onset. */
  collapseGapDays: number
}

export interface EventOutcomeResult {
  /** Onset count after collapsing (restricted to known days). */
  onsets: number
  /** Raw outcome-day count before collapsing. */
  outcome_days: number
  /** Trigger-day count. */
  trigger_days: number
  /** Known-day denominator size. */
  known_days: number
  per_lag: LagExposureResult[]
}

const MS_PER_DAY = 86_400_000

/** Convert a YYYY-MM-DD string to an integer day number (days since epoch, UTC). */
const dayNumber = (day: string): number => Math.floor(Date.parse(`${day}T00:00:00Z`) / MS_PER_DAY)

/** Parse a lag window ("12h", "24h", "7d") to whole days (rounded up, min 1). */
export const parseLagDays = (lag: string): number | null => {
  const match = lag.match(/^(\d+)([hd])$/)
  if (!match) return null
  const value = parseInt(match[1], 10)
  return match[2] === 'd' ? Math.max(1, value) : Math.max(1, Math.ceil(value / 24))
}

/**
 * Collapse a set of outcome day-numbers into onset day-numbers. Consecutive
 * days no more than `gapDays` apart belong to the same episode; only the first
 * day of each episode is kept. The gap is measured against the previous day in
 * the run, so a long contiguous flare collapses to a single onset.
 */
export const collapseOnsets = (dayNumbers: number[], gapDays: number): number[] => {
  if (dayNumbers.length === 0) return []
  const sorted = [...new Set(dayNumbers)].sort((a, b) => a - b)
  const onsets: number[] = [sorted[0]]
  let prev = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - prev > gapDays) onsets.push(sorted[i])
    prev = sorted[i]
  }
  return onsets
}

/** True when any trigger day falls in the lag window [day - lagDays + 1, day]. */
const isExposed = (day: number, sortedTriggers: number[], lagDays: number): boolean => {
  const windowStart = day - lagDays + 1
  // Binary search for the first trigger >= windowStart.
  let lo = 0
  let hi = sortedTriggers.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sortedTriggers[mid] < windowStart) lo = mid + 1
    else hi = mid
  }
  return lo < sortedTriggers.length && sortedTriggers[lo] <= day
}

/**
 * Pure event-outcome computation. All inputs are day strings so this is fully
 * deterministic and unit-testable without a database.
 */
export const computeEventOutcome = (input: EventOutcomeInput): EventOutcomeResult => {
  const knownSet = new Set(input.knownDays.map(dayNumber))
  const sortedTriggers = [...new Set(input.triggerDays.map(dayNumber))].sort((a, b) => a - b)

  // Onsets restricted to known days (an onset off the known window can't be
  // placed in the denominator universe).
  const outcomeNums = input.outcomeDays.map(dayNumber).filter((d) => knownSet.has(d))
  const onsetNums = collapseOnsets(outcomeNums, input.collapseGapDays)
  const onsetSet = new Set(onsetNums)
  const knownNums = [...knownSet]

  const perLag: LagExposureResult[] = []
  for (const lag of input.lagWindows) {
    const lagDays = parseLagDays(lag)
    if (lagDays === null) continue

    let exposedKnown = 0
    let onsetsExposed = 0
    for (const day of knownNums) {
      const exposed = isExposed(day, sortedTriggers, lagDays)
      if (exposed) {
        exposedKnown++
        if (onsetSet.has(day)) onsetsExposed++
      }
    }

    const known = knownNums.length
    const onsets = onsetNums.length
    const table: ContingencyTable = {
      a: onsetsExposed,
      b: exposedKnown - onsetsExposed,
      c: onsets - onsetsExposed,
      d: known - exposedKnown - (onsets - onsetsExposed),
    }
    const rr = riskRatio(table)
    const sig = significance2x2(table)
    const baseRate = known > 0 ? exposedKnown / known : 0

    perLag.push({
      lag,
      lag_days: lagDays,
      known_days: known,
      onsets,
      onsets_exposed: onsetsExposed,
      exposed_days: exposedKnown,
      unexposed_days: known - exposedKnown,
      base_rate: baseRate,
      reverse_conditional: onsets > 0 ? onsetsExposed / onsets : 0,
      expected_onsets_exposed: onsets * baseRate,
      relative_risk: rr.relative_risk,
      ci_low: rr.ci_low,
      ci_high: rr.ci_high,
      risk_difference: rr.risk_difference,
      chi_squared: sig.chi_squared,
      p_value: sig.p_value,
      test: sig.test,
    })
  }

  return {
    onsets: onsetNums.length,
    outcome_days: new Set(outcomeNums).size,
    trigger_days: sortedTriggers.length,
    known_days: knownNums.length,
    per_lag: perLag,
  }
}
