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

import { getFeedPostById } from '../db/index.ts'
import { resolveActivityScalars } from './activitypub/feed-activity.ts'
import { isCapabilityAuthorized } from './feed-capability.ts'
import { resolvePublicSeries } from './feed-series.ts'
import { resolveFeedActivity } from './feed.ts'
import { queryMetricsBucketed } from './queries/index.ts'

/** Series granularity for the structured payload — floored to the server minimum by `resolvePublicSeries`. */
const SERIES_BUCKET = '5s'

/**
 * Resolve a post's opted-in series to inline samples over its activity window.
 *
 * The authorization boundary is the post itself: `resolveStructuredPost` has
 * already checked the caller may see this post, and we only ever iterate the
 * post's own `seriesMetrics` over its own `[start, end]`. So the covering window
 * *is* that window — we don't route through the public-only
 * `findCoveringSharedSeriesWindow` (which correctly rejects a `followers`-only
 * share for the public `/series` endpoint, but would wrongly blank the chart
 * here for a token-authorized follower).
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

/**
 * Build the structured payload for one of `user`'s feed posts, or null if it is
 * unknown, has no resolvable activity, or the requester isn't authorized to see
 * it. `public`/`unlisted` posts resolve unconditionally; a `followers`-only post
 * resolves only with a matching capability `token` (the same token that
 * authorizes its followers-only images), so an accepted follower's instance can
 * render the native chart while a public guess still 404s.
 */
export const resolveStructuredPost = async (
  user: string,
  postId: string,
  token?: string,
): Promise<FeedStructured | null> => {
  const post = await getFeedPostById(user, postId)
  if (post == null || post.activity_id == null || !isCapabilityAuthorized(post, token)) return null

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
