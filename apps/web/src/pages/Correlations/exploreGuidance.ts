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

/** Tooltip copy for the controls users most often misread. */
export const TOOLTIPS = {
  collapseGap: 'Consecutive bad-days within this gap count as ONE onset (a 6-day flare = 1 event).',
  denominator:
    'All days = for presence-only metrics that only log bad days. Known days = for metrics that log explicit zeros.',
  lagWindows: 'How far back before an onset to look for the trigger (e.g. 24h, 48h).',
  regime: 'Limit the analysis to a behavioural era (e.g. since you started a protocol).',
} as const
