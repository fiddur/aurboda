/**
 * Pure guidance helpers and copy for the correlation Explore form. Kept free of
 * signals/JSX so the mismatch heuristic is unit-testable in isolation.
 */

import { isValidMetric } from '@aurboda/api-spec'

export type ExploreMode = 'event' | 'continuous'

/**
 * Event-onset mode is for presence-only outcomes (logged only on "bad" days).
 * Picking a value-every-day metric there collapses every day into ~1 onset and
 * returns nonsense. Built-in device/biometric metrics (sleep_score, hrv_rmssd,
 * weight, …) are continuous; presence-only symptom metrics (back_pain,
 * fissure_pain) are custom and therefore NOT built-in — so a built-in metric in
 * event mode is almost certainly a mode mismatch worth warning about. Custom
 * metrics (the ones that genuinely belong in event mode) are left un-warned.
 */
export const eventOutcomeLooksContinuous = (
  mode: ExploreMode,
  outcomeSource: 'metric' | 'tag',
  metricValue: string,
): boolean => mode === 'event' && outcomeSource === 'metric' && isValidMetric(metricValue.trim())

export const MODE_HELP =
  'Pick mode by your OUTCOME. Presence-only metrics that are logged only on bad ' +
  'days (back_pain, fissure_pain) → Event onset. Value-every-day metrics ' +
  '(sleep_score, hrv_rmssd, weight) → Continuous.'

/**
 * Plain-language strength label for a correlation coefficient, so a small r
 * isn't over-read. Includes direction once the magnitude is non-negligible.
 */
export const describeCorrelationStrength = (r: number | null): string => {
  if (r === null) return 'not enough data'
  const a = Math.abs(r)
  if (a < 0.1) return 'negligible'
  const strength = a < 0.3 ? 'weak' : a < 0.5 ? 'moderate' : a < 0.7 ? 'strong' : 'very strong'
  return `${strength} ${r > 0 ? 'positive' : 'negative'}`
}

/** Plain-language label for a Cohen's d effect size (standard conventions). */
export const describeEffectSize = (d: number | null): string => {
  if (d === null) return 'not estimable'
  const a = Math.abs(d)
  return a < 0.2 ? 'negligible' : a < 0.5 ? 'small' : a < 0.8 ? 'medium' : 'large'
}

/** A caution string when the sample is too small to trust, otherwise null. */
export const sampleCaution = (n: number): string | null => {
  if (n < 10) return 'very small sample — treat as anecdotal'
  if (n < 30) return 'small sample — interpret with caution'
  return null
}

/** Tooltip copy for the controls users most often misread. */
export const TOOLTIPS = {
  collapseGap: 'Consecutive bad-days within this gap count as ONE onset (a 6-day flare = 1 event).',
  denominator:
    'All days = for presence-only metrics that only log bad days. Known days = for metrics that log explicit zeros.',
  lagWindows: 'How far back before an onset to look for the trigger (e.g. 24h, 48h).',
  regime: 'Limit the analysis to a behavioural era (e.g. since you started a protocol).',
} as const
