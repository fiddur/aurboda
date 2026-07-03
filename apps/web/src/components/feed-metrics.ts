/**
 * Shared metric-option lists for the federated feed UI (share dialog + feed
 * view), so the labels a post is created with match the labels it's displayed
 * with.
 */
import type { MetricType } from '@aurboda/api-spec'

/**
 * Scalar summaries the backend knows how to resolve (see
 * services/activitypub/scalars.ts). `source` is the time-series metric a
 * summary is derived from — used to offer only metrics the activity actually
 * has. `duration` has no source (it comes from the activity's window).
 */
export const SUMMARY_METRICS: { key: string; label: string; source?: MetricType }[] = [
  { key: 'duration', label: 'Duration' },
  { key: 'distance', label: 'Distance', source: 'distance' },
  { key: 'heart_rate_avg', label: 'Avg HR', source: 'heart_rate' },
  { key: 'heart_rate_max', label: 'Max HR', source: 'heart_rate' },
  { key: 'hr_zone_minutes', label: 'HR zones', source: 'heart_rate' },
  { key: 'calories', label: 'Calories', source: 'calories_active' },
  { key: 'stress_avg', label: 'Avg stress', source: 'stress_level' },
]

/** High-resolution series a user can explicitly opt into sharing. */
export const SERIES_METRICS: { key: MetricType; label: string }[] = [
  { key: 'heart_rate', label: 'Heart rate' },
  { key: 'speed', label: 'Speed' },
  { key: 'power', label: 'Power' },
  { key: 'elevation', label: 'Elevation' },
  { key: 'run_cadence', label: 'Cadence' },
  { key: 'stress_level', label: 'Stress' },
]

/** Human label for a stored `included_metrics` key (falls back to the raw key). */
export const summaryLabel = (key: string): string => SUMMARY_METRICS.find((m) => m.key === key)?.label ?? key

/** Human label for a stored `series_metrics` key (falls back to the raw key). */
export const seriesLabel = (key: string): string => SERIES_METRICS.find((m) => m.key === key)?.label ?? key
