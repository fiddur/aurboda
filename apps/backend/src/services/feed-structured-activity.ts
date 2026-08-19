/**
 * Assembly of an *activity* post's native structured payload
 * (`FeedStructuredActivity`) from its resolved pieces.
 *
 * A leaf module (no import back into `feed.ts`/`feed-structured.ts`) shared by
 * two producers so their payloads can never drift:
 *
 * - the public structured endpoint (`feed-structured.ts`) — what a subscribing
 *   Aurboda peer fetches and renders in its home timeline, and
 * - the owner-facing feed serialisation (`feed.ts`) — so the author's own feed
 *   card renders the **identical** payload with the identical component
 *   (#1008: "my own feed should look like it would for another Aurboda
 *   subscriber").
 */
import { type FeedStructuredActivity, type FeedStructuredSeries, metricTypeSchema } from '@aurboda/api-spec'

import type { ScalarMetric } from './activitypub/object.ts'

import { resolvePublicSeries } from './feed-series.ts'
import { queryMetricsBucketed } from './queries/index.ts'

/** Series granularity for the structured payload — floored to the server minimum by `resolvePublicSeries`. */
const SERIES_BUCKET = '5s'

/**
 * Resolve a post's opted-in series to inline samples over its activity window.
 *
 * The authorization boundary is the post itself: the caller has already
 * checked the requester may see this post, and we only ever iterate the post's
 * own `seriesMetrics` over its own `[start, end]`. So the covering window *is*
 * that window — we don't route through the public-only
 * `findCoveringSharedSeriesWindow` (which correctly rejects a `followers`-only
 * share for the public `/series` endpoint, but would wrongly blank the chart
 * here for a token-authorized follower or the owner).
 */
export const resolveStructuredSeries = async (
  user: string,
  seriesMetrics: string[],
  start: Date,
  end: Date,
): Promise<FeedStructuredSeries[]> => {
  const series: FeedStructuredSeries[] = []
  for (const raw of seriesMetrics) {
    const parsed = metricTypeSchema.safeParse(raw)
    if (!parsed.success) continue
    const result = await resolvePublicSeries(parsed.data, start, end, SERIES_BUCKET, {
      findCoveringWindow: async () => ({ end_time: end, start_time: start }),
      queryBucketed: (m, s, e, b) => queryMetricsBucketed(user, [m], s, e, b, {}),
    })
    if (result) {
      series.push({
        bucket: result.bucket,
        metric: result.metric,
        samples: result.samples,
        unit: result.unit,
      })
    }
  }
  return series
}

/** The activity fields the payload needs (satisfied by `ResolvedFeedActivity`). */
export interface StructuredActivitySource {
  activity_type: string
  start_time: Date
  end_time?: Date
  title?: string
}

/** Assemble the `FeedStructuredActivity` payload from its resolved pieces. */
export const assembleStructuredActivity = (
  activity: StructuredActivitySource,
  scalars: ScalarMetric[],
  series: FeedStructuredSeries[],
  message?: string | null,
): FeedStructuredActivity => {
  const structured: FeedStructuredActivity = {
    activity_type: activity.activity_type,
    kind: 'activity',
    metrics: scalars.map(({ key, unit, value }) => ({ key, value, ...(unit === undefined ? {} : { unit }) })),
    series,
    start_time: activity.start_time.toISOString(),
  }
  if (activity.title !== undefined) structured.title = activity.title
  if (message != null) structured.message = message
  if (activity.end_time) {
    structured.end_time = activity.end_time.toISOString()
    structured.duration_seconds = Math.round(
      (activity.end_time.getTime() - activity.start_time.getTime()) / 1000,
    )
  }
  return structured
}
