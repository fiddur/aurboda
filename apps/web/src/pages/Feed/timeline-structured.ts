/**
 * Pure mapping from a timeline entry's native structured data to chart-ready
 * series — kept free of any DOM/`window` import so it can be unit-tested in Node
 * (the web test runner has no jsdom).
 *
 * Each shared series becomes a `{ date, value }[]` line (bucket start → avg),
 * dropping any series with fewer than two points (`TrendLineChart` needs ≥2).
 * Only meaningful for an `activity` post's typed series; an `article` post
 * renders via `TimelineArticle` instead, so this returns `[]` for one.
 */
import type { FeedStructuredPost } from '@aurboda/api-spec'

export interface ChartSeries {
  metric: string
  label: string
  color: string
  data: { date: string; value: number }[]
}

/** Presentation for the known series metrics; unknown metrics fall back to a prettified key + neutral colour. */
const SERIES_META: Record<string, { label: string; color: string }> = {
  elevation: { color: '#22c55e', label: 'Elevation' },
  heart_rate: { color: '#ef4444', label: 'Heart rate' },
  power: { color: '#a855f7', label: 'Power' },
  run_cadence: { color: '#f59e0b', label: 'Cadence' },
  speed: { color: '#3b82f6', label: 'Speed' },
  stress_level: { color: '#eab308', label: 'Stress' },
}

const DEFAULT_COLOR = '#6366f1'

const prettify = (key: string): string => {
  const spaced = key.replaceAll('_', ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * Chart-ready series for a structured post, newest metrics first as shared.
 * Series with fewer than two samples are dropped (a line needs two points).
 * Returns `[]` for an `article` post (rendered by `TimelineArticle` instead).
 */
export const structuredChartSeries = (structured: FeedStructuredPost): ChartSeries[] => {
  // Only an article renders elsewhere (TimelineArticle). Everything else — an
  // activity share, or a legacy entry stored before the `kind` tag existed — has
  // the activity series shape, so gate on `article` (not `!== 'activity'`) to
  // avoid dropping the native chart on pre-existing timeline entries.
  if (structured.kind === 'article') return []
  return structured.series
    .map((series) => ({
      color: SERIES_META[series.metric]?.color ?? DEFAULT_COLOR,
      data: series.samples.map((sample) => ({ date: sample.start, value: sample.avg })),
      label: SERIES_META[series.metric]?.label ?? prettify(series.metric),
      metric: series.metric,
    }))
    .filter((series) => series.data.length >= 2)
}
