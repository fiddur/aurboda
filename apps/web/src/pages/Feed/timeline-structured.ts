/**
 * Pure mapping from a post's native structured payload to what the native card
 * renders — kept free of any DOM/`window` import so it can be unit-tested in
 * Node (the web test runner has no jsdom).
 *
 * Only meaningful for an `activity` post's typed series/route; an `article`
 * post renders via `TimelineArticle` instead, so everything here is empty/false
 * for one. A legacy entry stored before the `kind` tag existed has the activity
 * shape, so gates are on `kind === 'article'` (not `!== 'activity'`) to avoid
 * dropping the native render on pre-existing timeline entries.
 */
import type { FeedStructuredPost } from '@aurboda/api-spec'

import type { CombinedChartSeries } from '../../components/charts/CombinedMetricChart'
import type { RoutePoint } from '../../components/charts/RouteMap'

/** A line (and a route polyline) needs at least two points to draw. */
const MIN_DRAWABLE_POINTS = 2

/** A bucketed sample's representative instant on the x-axis: the bucket midpoint. */
const sampleTime = (sample: { start: string; end: string }): Date =>
  new Date((new Date(sample.start).getTime() + new Date(sample.end).getTime()) / 2)

/**
 * The shared series as combined-chart input (bucket midpoint → avg), dropping
 * any series with fewer than two points (a line needs two).
 */
export const structuredCombinedSeries = (
  structured: FeedStructuredPost | undefined,
): CombinedChartSeries[] => {
  if (structured == null || structured.kind === 'article') return []
  return structured.series
    .map((series) => ({
      data: series.samples.map((sample) => [sampleTime(sample), sample.avg] as [Date, number]),
      metric: series.metric,
      ...(series.unit === undefined ? {} : { unit: series.unit }),
    }))
    .filter((series) => series.data.length >= MIN_DRAWABLE_POINTS)
}

/** The shared GPS route as map input (`t` parsed to a `Date`). */
export const structuredRoutePoints = (structured: FeedStructuredPost | undefined): RoutePoint[] => {
  if (structured == null || structured.kind === 'article') return []
  return (structured.route ?? []).map((point) => ({
    lat: point.lat,
    lon: point.lon,
    time: new Date(point.t),
  }))
}

/**
 * Whether the native chart actually draws a heart-rate line. The delivered
 * chart.png renders heart rate ONLY, so it is redundant exactly when this holds
 * — an `include_chart` post sharing e.g. only a power series must keep its HR
 * image next to the native power chart (#1001).
 */
export const structuredHasNativeHrChart = (structured: FeedStructuredPost | undefined): boolean =>
  structured != null &&
  structured.kind !== 'article' &&
  structured.series.some(
    (series) => series.metric === 'heart_rate' && series.samples.length >= MIN_DRAWABLE_POINTS,
  )

/** Whether the native interactive map actually renders (a polyline needs two points). */
export const structuredHasNativeMap = (structured: FeedStructuredPost | undefined): boolean =>
  structured != null &&
  structured.kind !== 'article' &&
  (structured.route?.length ?? 0) >= MIN_DRAWABLE_POINTS

/**
 * Whether a delivered attachment image is still wanted next to the native
 * render, by its Aurboda attachment `name` (stable — we set it on delivery).
 * An article's card renders everything natively; an activity keeps each image
 * unless its native counterpart actually draws (chart.png ↔ the heart-rate
 * line, route.png ↔ the interactive map); non-Aurboda images always show.
 */
export const timelineImageVisible = (
  structured: FeedStructuredPost | undefined,
  name: string | undefined,
): boolean => {
  if (structured == null) return true
  if (structured.kind === 'article') return false
  if (name === 'Heart rate') return !structuredHasNativeHrChart(structured)
  if (name === 'Route') return !structuredHasNativeMap(structured)
  return true
}
