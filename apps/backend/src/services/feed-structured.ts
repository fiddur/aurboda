/**
 * Build the native structured representation of a shared exercise post — the
 * payload served at `GET /public/:username/feed/:postId` and fetched by a
 * following Aurboda instance to render a native chart + typed stats instead of
 * the Mastodon-style HTML.
 *
 * Reuses the exact same shared-scalar resolution as delivery/the object
 * dispatcher (`resolveActivityScalars`) and the exact same data-scoped series
 * resolution as the public `/series` endpoint (`resolvePublicSeries`), so what a
 * peer renders can never exceed what the author shared. Only `public`/`unlisted`
 * posts resolve (the same gate as the object dispatcher and outbox).
 */
import { type FeedStructured, type FeedStructuredSeries, metricTypeSchema } from '@aurboda/api-spec'

import { findCoveringSharedSeriesWindow, getFeedPostById } from '../db/index.ts'
import { resolveActivityScalars } from './activitypub/feed-activity.ts'
import { isPubliclyVisible } from './activitypub/object.ts'
import { resolvePublicSeries } from './feed-series.ts'
import { resolveFeedActivity } from './feed.ts'
import { queryMetricsBucketed } from './queries/index.ts'

/** Series granularity for the structured payload — floored to the server minimum by `resolvePublicSeries`. */
const SERIES_BUCKET = '5s'

/**
 * Resolve a post's shared series to inline samples, reusing the public-series
 * data-scoping (an unshared/uncovered metric resolves to nothing, never leaks).
 */
const resolveStructuredSeries = async (
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
      findCoveringWindow: (m, s, e) => findCoveringSharedSeriesWindow(user, m, s, e),
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

/**
 * Build the structured payload for one of `user`'s feed posts, or null if it is
 * unknown, has no resolvable activity, or is not publicly visible.
 */
export const resolveStructuredPost = async (user: string, postId: string): Promise<FeedStructured | null> => {
  const post = await getFeedPostById(user, postId)
  if (post == null || post.activity_id == null || !isPubliclyVisible(post.visibility)) return null

  const activity = await resolveFeedActivity(user, post.activity_id)
  if (activity == null) return null

  const scalars = await resolveActivityScalars(
    user,
    { end_time: activity.end_time, start_time: activity.start_time },
    post.included_metrics,
  )

  const series = activity.end_time
    ? await resolveStructuredSeries(user, post.series_metrics, activity.start_time, activity.end_time)
    : []

  const structured: FeedStructured = {
    activity_type: activity.activity_type,
    metrics: scalars.map(({ key, unit, value }) => ({ key, value, ...(unit === undefined ? {} : { unit }) })),
    series,
    start_time: activity.start_time.toISOString(),
  }
  if (activity.title !== undefined) structured.title = activity.title
  if (activity.end_time) {
    structured.end_time = activity.end_time.toISOString()
    structured.duration_seconds = Math.round(
      (activity.end_time.getTime() - activity.start_time.getTime()) / 1000,
    )
  }
  return structured
}
