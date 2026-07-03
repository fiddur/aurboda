/**
 * Federated activity feed schemas.
 *
 * A *feed post* publishes one of a user's activities (exercise, sleep, …) to
 * their public feed, choosing per-post exactly which data leaves the instance:
 *
 * - `included_metrics` — the scalar summaries the user opted to share (e.g.
 *   `duration`, `distance`, `heart_rate_avg`, `hr_zone_minutes`). These are the
 *   single source of truth for the human-readable summary and the machine
 *   scalars a remote Aurboda instance reads.
 * - `series_metrics` — a *separate, explicit* opt-in for high-resolution
 *   continuous series (e.g. per-5s heart rate). A per-sample trace is far more
 *   revealing than an average, so series are off unless deliberately chosen.
 *
 * The `series_metrics` set is the authorization boundary for the public,
 * read-only `GET /public/:username/series` endpoint: that endpoint resolves a
 * metric only when a feed post shared *that series* for an activity whose
 * window covers the requested range. See `PublicSeriesQuery`.
 *
 * ActivityPub delivery (actor, outbox, HTTP signatures) and image rendering are
 * layered on top of this persistence model in follow-up work; these schemas are
 * the storage + public-read foundation.
 */

import { z } from 'zod'

import { baseResponseSchema, iso8601DateTimeSchema, metricTypeSchema } from './common.ts'

/**
 * Who a feed post is addressed to.
 *
 * - `public` — listed on the public timeline and deliverable to the wider fediverse.
 * - `followers` — only the actor's followers.
 * - `unlisted` — reachable but not surfaced on public timelines.
 *
 * Only non-`followers` posts back the public `/series` endpoint, since that
 * endpoint has no viewer authentication.
 */
export const feedVisibilitySchema = z
  .enum(['public', 'followers', 'unlisted'])
  .meta({ description: 'Audience for a feed post', id: 'FeedVisibility' })

export type FeedVisibility = z.infer<typeof feedVisibilitySchema>

/** A scalar-summary metric key (e.g. `duration`, `distance`, `heart_rate_avg`). */
const scalarMetricKeySchema = z.string().min(1).max(64)

/**
 * Body for sharing an activity to the feed.
 *
 * Defaults are privacy-conservative: nothing is shared unless listed, and
 * high-resolution `series_metrics` default to empty (opt-in only).
 */
export const shareActivityBodySchema = z
  .object({
    include_chart: z
      .boolean()
      .default(false)
      .meta({ description: 'Attach a rendered chart image (drawn only from shared metrics)' }),
    include_map: z
      .boolean()
      .default(false)
      .meta({ description: 'Attach a rendered route-map image (GPS activities only)' }),
    included_metrics: z
      .array(scalarMetricKeySchema)
      .max(64)
      .default([])
      .meta({ description: 'Scalar-summary metric keys to share (the single source of truth for the post)' }),
    series_metrics: z.array(metricTypeSchema).max(64).default([]).meta({
      description:
        'Metrics whose full high-resolution series are explicitly shared. Separate opt-in from the scalar summary; empty by default.',
    }),
    visibility: feedVisibilitySchema.default('public'),
  })
  .meta({ id: 'ShareActivityBody' })

export type ShareActivityBody = z.infer<typeof shareActivityBodySchema>

/** Body for editing a feed post (all fields optional). */
export const updateFeedPostBodySchema = z
  .object({
    include_chart: z.boolean().optional().meta({ description: 'Attach a rendered chart image' }),
    include_map: z.boolean().optional().meta({ description: 'Attach a rendered route-map image' }),
    included_metrics: z
      .array(scalarMetricKeySchema)
      .max(64)
      .optional()
      .meta({ description: 'Replacement set of shared scalar-summary metric keys' }),
    series_metrics: z
      .array(metricTypeSchema)
      .max(64)
      .optional()
      .meta({ description: 'Replacement set of explicitly-shared series metrics' }),
    visibility: feedVisibilitySchema.optional(),
  })
  .meta({ id: 'UpdateFeedPostBody' })

export type UpdateFeedPostBody = z.infer<typeof updateFeedPostBodySchema>

/** A feed post as seen by its owner. */
export const feedPostSchema = z
  .object({
    activity_id: z
      .string()
      .uuid()
      .nullable()
      .meta({ description: 'The shared activity, or null for a non-activity post' }),
    // Resolved from the shared activity at query time (not stored on the post, so
    // a rename stays consistent). The window is the *merged* span — the same one
    // the detail view and share dialog present — so a client can show the title
    // and edit the metric selection without a second per-post activity fetch.
    // Absent when there is no activity, or it was deleted.
    activity_end_time: z
      .string()
      .optional()
      .meta({ description: "The shared activity's merged-span end (ISO 8601)" }),
    activity_start_time: z
      .string()
      .optional()
      .meta({ description: "The shared activity's merged-span start (ISO 8601)" }),
    activity_title: z
      .string()
      .optional()
      .meta({ description: "The shared activity's title, resolved at query time" }),
    activity_type: z
      .string()
      .optional()
      .meta({ description: "The shared activity's type (e.g. `exercise`)" }),
    // The exact HTML `content` that federates for this post (headline + shared
    // scalar summary), so a client can render the post WYSIWYG — matching what
    // Mastodon shows — instead of reconstructing it from the metric keys. Absent
    // when there is no resolvable activity.
    content: z
      .string()
      .optional()
      .meta({ description: 'Rendered AS2 `content` HTML for the post (as federated)' }),
    created_at: z.string().meta({ description: 'Creation timestamp (ISO 8601)' }),
    id: z.string().uuid().meta({ description: 'Feed post ID' }),
    include_chart: z.boolean().meta({ description: 'Whether a chart image is attached' }),
    include_map: z.boolean().meta({ description: 'Whether a route-map image is attached' }),
    included_metrics: z.array(z.string()).meta({ description: 'Shared scalar-summary metric keys' }),
    series_metrics: z.array(z.string()).meta({ description: 'Explicitly-shared series metrics' }),
    updated_at: z.string().meta({ description: 'Last update timestamp (ISO 8601)' }),
    visibility: feedVisibilitySchema,
  })
  .meta({ id: 'FeedPost' })

export type FeedPost = z.infer<typeof feedPostSchema>

/** Response wrapping a single feed post. */
export const feedPostResponseSchema = baseResponseSchema
  .extend({ post: feedPostSchema.optional() })
  .meta({ id: 'FeedPostResponse' })

export type FeedPostResponse = z.infer<typeof feedPostResponseSchema>

/** Response wrapping the owner's list of feed posts. */
export const feedPostsResponseSchema = baseResponseSchema
  .extend({ posts: z.array(feedPostSchema) })
  .meta({ id: 'FeedPostsResponse' })

export type FeedPostsResponse = z.infer<typeof feedPostsResponseSchema>

// =============================================================================
// Following (the actors this user follows — inbound feed direction)
// =============================================================================

/** Body for following an actor. */
export const followActorBodySchema = z
  .object({
    handle: z.string().trim().min(1).max(512).meta({
      description: 'The actor to follow: a fediverse handle (`@user@host` or `user@host`) or an actor URL',
      example: '@alice@mastodon.social',
    }),
  })
  .meta({ id: 'FollowActorBody' })

export type FollowActorBody = z.infer<typeof followActorBodySchema>

/**
 * An actor this user follows. Internal delivery details (the followee's inbox /
 * shared-inbox URIs) are deliberately NOT exposed — only presentation fields and
 * the acceptance state. `accepted` is false while a sent Follow awaits the
 * followee's `Accept`.
 */
export const followingActorSchema = z
  .object({
    accepted: z
      .boolean()
      .meta({ description: 'Whether the followee has accepted the follow (else pending)' }),
    actor_uri: z.string().meta({ description: "The followee's ActivityPub actor URI" }),
    avatar_url: z.string().nullable().meta({ description: "The followee's avatar URL, if known" }),
    created_at: iso8601DateTimeSchema.meta({ description: 'When the follow was initiated (ISO 8601)' }),
    display_name: z.string().nullable().meta({ description: "The followee's display name, if known" }),
    handle: z.string().nullable().meta({ description: "The followee's `@user@host` handle, if resolvable" }),
    id: z.string().uuid().meta({ description: 'Local id of the follow (used to unfollow)' }),
  })
  .meta({ id: 'FollowingActor' })

export type FollowingActor = z.infer<typeof followingActorSchema>

/** Response wrapping a single follow (e.g. the result of following an actor). */
export const followActorResponseSchema = baseResponseSchema
  .extend({ actor: followingActorSchema.optional() })
  .meta({ id: 'FollowActorResponse' })

export type FollowActorResponse = z.infer<typeof followActorResponseSchema>

/** Response wrapping the owner's list of followed actors. */
export const followingResponseSchema = baseResponseSchema
  .extend({ following: z.array(followingActorSchema) })
  .meta({ id: 'FollowingResponse' })

export type FollowingResponse = z.infer<typeof followingResponseSchema>

// =============================================================================
// Public series endpoint (unauthenticated, data-scoped)
// =============================================================================

/**
 * Bucket size for a public series request. Restricted to sub-day units
 * (`s`/`m`/`h`) because a series window is a single activity; server floors the
 * granularity to a minimum (see `PublicSeriesQuery`).
 */
export const seriesBucketSchema = z
  .string()
  .regex(/^\d+[smh]$/, 'Must be {number}{unit} where unit is s, m, or h')
  .meta({
    description: 'Bucket size: {number}{unit} where unit is s (seconds), m (minutes), or h (hours)',
    example: '5s',
    id: 'SeriesBucket',
  })

/**
 * Query for the public, read-only bucketed series endpoint.
 *
 * Resolves ONLY when a feed post shared `metric` as a series for an activity
 * whose window covers `[start, end]`. The effective range is clamped to that
 * activity's window and the bucket granularity is floored server-side. Requests
 * for an unshared metric, or a window not covered by any shared activity, 404.
 */
export const publicSeriesQuerySchema = z
  .object({
    bucket: seriesBucketSchema,
    end: iso8601DateTimeSchema.meta({ description: 'End of the requested window (ISO 8601)' }),
    metric: metricTypeSchema.meta({ description: 'The single metric to fetch' }),
    start: iso8601DateTimeSchema.meta({ description: 'Start of the requested window (ISO 8601)' }),
  })
  .meta({ id: 'PublicSeriesQuery' })

export type PublicSeriesQuery = z.infer<typeof publicSeriesQuerySchema>

/**
 * One bucketed sample. Individual-measurement timestamps are deliberately
 * omitted (only the bucket window is exposed) to limit resolution leakage.
 */
export const publicSeriesSampleSchema = z
  .object({
    avg: z.number().meta({ description: 'Average value in the bucket' }),
    count: z.number().int().meta({ description: 'Number of measurements in the bucket' }),
    end: iso8601DateTimeSchema.meta({ description: 'Bucket end time' }),
    max: z.number().meta({ description: 'Maximum value in the bucket' }),
    min: z.number().meta({ description: 'Minimum value in the bucket' }),
    start: iso8601DateTimeSchema.meta({ description: 'Bucket start time' }),
    sum: z
      .number()
      .optional()
      .meta({ description: 'Sum of values in the bucket (present for cumulative metrics)' }),
  })
  .meta({ id: 'PublicSeriesSample' })

export type PublicSeriesSample = z.infer<typeof publicSeriesSampleSchema>

/** Response for the public series endpoint. Payload fields optional so 404s type-check. */
export const publicSeriesResponseSchema = baseResponseSchema
  .extend({
    bucket: z.string().optional().meta({ description: 'Effective bucket size after server flooring' }),
    end: z.string().optional().meta({ description: 'Effective end of the returned window (ISO 8601)' }),
    metric: z.string().optional().meta({ description: 'The metric returned' }),
    samples: z.array(publicSeriesSampleSchema).optional().meta({ description: 'Bucketed samples' }),
    start: z.string().optional().meta({ description: 'Effective start of the returned window (ISO 8601)' }),
    unit: z.string().optional().meta({ description: 'Unit of the metric' }),
  })
  .meta({ id: 'PublicSeriesResponse' })

export type PublicSeriesResponse = z.infer<typeof publicSeriesResponseSchema>
