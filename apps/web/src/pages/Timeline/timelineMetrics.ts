import type { MetricType } from '@aurboda/api-spec'

export const TIMELINE_SLEEP_METRICS = [
  'sleep_score',
  'sleep_efficiency',
  'sleep_restfulness',
  'sleep_deep_score',
  'sleep_rem_score',
] as const satisfies readonly MetricType[]

/**
 * The metrics the Timeline reads from its bucketed query. Naming them keeps the
 * backend from discovering and bucketing every metric with samples in the window.
 */
export const TIMELINE_METRICS: MetricType[] = [
  'heart_rate',
  'hrv_rmssd',
  'stress_level',
  'steps',
  'calories_active',
  ...TIMELINE_SLEEP_METRICS,
]
