/**
 * Shared metric-option lists for the federated feed UI (share dialog + feed
 * view), so the labels a post is created with match the labels it's displayed
 * with.
 */
import type { FeedPost, FeedVisibility, MetricType, ShareActivityBody } from '@aurboda/api-spec'

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

/** Fallback default summary selection when the activity's chart metrics aren't known. */
export const DEFAULT_SUMMARY = ['duration', 'distance', 'heart_rate_avg', 'heart_rate_max', 'calories']

/**
 * Seed the share dialog's initial selection from the metrics currently shown on
 * the activity's chart: `duration` (always) plus every summary whose source
 * metric is on the chart, and the full series for each charted metric. Falls
 * back to {@link DEFAULT_SUMMARY} (no series) when the chart selection is unknown.
 */
export const defaultsFromChart = (chartMetrics?: string[]): { summary: string[]; series: MetricType[] } => {
  if (!chartMetrics || chartMetrics.length === 0) return { series: [], summary: DEFAULT_SUMMARY }
  return {
    series: SERIES_METRICS.filter((m) => chartMetrics.includes(m.key)).map((m) => m.key),
    summary: [
      'duration',
      ...SUMMARY_METRICS.filter((m) => m.source && chartMetrics.includes(m.source)).map((m) => m.key),
    ],
  }
}

/**
 * The heart-rate chart image and the heart-rate *series* are the same data in two
 * formats, so the share dialog offers a single heart-rate control. Opting into the
 * heart-rate series therefore also attaches the rendered chart image — an
 * interactive native chart for Aurboda followers plus a PNG for Mastodon and other
 * peers. `include_chart` is derived here, never toggled separately.
 */
const HEART_RATE: MetricType = 'heart_rate'

/**
 * Which heart-rate series a post starts with in edit mode. A post that attached
 * the chart image but predates the unified control (no `heart_rate` in
 * `series_metrics`) is still treated as sharing heart rate, so the one control
 * shows checked — and re-saving backfills the series the image already implied.
 */
export const initialSeriesSelection = (
  post: Pick<FeedPost, 'include_chart' | 'series_metrics'>,
): MetricType[] => {
  const keys = SERIES_METRICS.map((m) => m.key).filter((k) => post.series_metrics.includes(k))
  if (post.include_chart && !keys.includes(HEART_RATE)) keys.push(HEART_RATE)
  return keys
}

/** The dialog's current selection, resolved against what the activity can offer. */
export interface ShareSelection {
  summary: Set<string>
  series: Set<MetricType>
  includeMap: boolean
  visibility: FeedVisibility
  summaryOptions: readonly { key: string }[]
  seriesOptions: readonly { key: MetricType }[]
  canChart: boolean
  canMap: boolean
}

/**
 * Build the share/update request body from the dialog selection. Only metrics the
 * dialog actually offered are sent (unavailable ones are dropped, not defaulted),
 * and `include_chart` follows the heart-rate series toggle — the chart image is
 * the image format of that one shared series, so the two can't diverge.
 */
export const buildShareBody = (sel: ShareSelection): ShareActivityBody => ({
  include_chart: sel.canChart && sel.series.has(HEART_RATE),
  include_map: sel.canMap && sel.includeMap,
  included_metrics: sel.summaryOptions.map((m) => m.key).filter((k) => sel.summary.has(k)),
  series_metrics: sel.seriesOptions.map((m) => m.key).filter((k) => sel.series.has(k)),
  visibility: sel.visibility,
})

/** Human label for a stored `included_metrics` key (falls back to the raw key). */
export const summaryLabel = (key: string): string => SUMMARY_METRICS.find((m) => m.key === key)?.label ?? key

/** Human label for a stored `series_metrics` key (falls back to the raw key). */
export const seriesLabel = (key: string): string => SERIES_METRICS.find((m) => m.key === key)?.label ?? key
