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
import { selectorSchema } from './correlations.ts'
import { feedStructuredSchema, publicSeriesSampleSchema } from './feed-structured.ts'
import { shareVisibilityValues } from './visibility.ts'

/**
 * Who a feed post is addressed to.
 *
 * - `public` — listed on the public timeline and deliverable to the wider fediverse.
 * - `unlisted` — reachable but not surfaced on public timelines.
 * - `followers` — only the actor's followers.
 *
 * This is the shared `ShareVisibility` vocabulary (`public`/`unlisted`) plus the
 * feed-only `followers` audience. Only non-`followers` posts back the public
 * `/series` endpoint, since that endpoint has no viewer authentication.
 */
export const feedVisibilitySchema = z
  .enum([...shareVisibilityValues, 'followers'])
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

// =============================================================================
// Article posts (long-form: title + markdown prose + inline chart blocks)
// =============================================================================

/**
 * The kind of a feed post. `activity` (the default) shares one of the user's
 * activities; `article` is a long-form post carrying markdown prose and inline
 * chart blocks over locked time windows. Modelled as a post *kind* rather than a
 * separate entity so articles reuse the whole feed (visibility, federation, home
 * timeline, the public-profile feed, permalinks).
 */
export const feedPostKindSchema = z
  .enum(['activity', 'article'])
  .meta({ description: 'Feed post kind: an activity share or a long-form article', id: 'FeedPostKind' })

export type FeedPostKind = z.infer<typeof feedPostKindSchema>

/** A prose block: a run of markdown, rendered through the shared sanitiser (#910). */
export const articleProseBlockSchema = z
  .object({
    markdown: z
      .string()
      .max(20_000)
      .meta({ description: 'Markdown prose (rendered to sanitised HTML at the sink)' }),
    type: z.literal('prose'),
  })
  .meta({ description: 'A markdown prose block', id: 'ArticleProseBlock' })

/**
 * A chart block: one shared metric drawn over a locked `[start, end]` window.
 * The window is what makes the chart stable and citable — data is re-resolved
 * live against it, never snapshotted. When `start`/`end` are omitted the block
 * inherits the article's default window.
 */
export const articleChartBlockSchema = z
  .object({
    bucket: z
      .string()
      .regex(/^\d+[smhd]$/, 'Must be {number}{unit} where unit is s, m, h, or d')
      .optional()
      .meta({
        description: 'Bucket granularity (e.g. `5s`, `1h`, `1d`); the server picks a default if omitted',
      }),
    caption: z.string().max(280).optional().meta({ description: 'Optional caption shown under the chart' }),
    end: iso8601DateTimeSchema
      .optional()
      .meta({ description: "Window end (ISO 8601); inherits the article's default window if omitted" }),
    metric: metricTypeSchema.meta({ description: 'The metric to chart' }),
    start: iso8601DateTimeSchema
      .optional()
      .meta({ description: "Window start (ISO 8601); inherits the article's default window if omitted" }),
    type: z.literal('chart'),
  })
  .meta({ description: 'A metric chart over a locked window', id: 'ArticleChartBlock' })

/**
 * A correlation block: a scatter of two data dimensions (a `trigger` predictor
 * against an `outcome`) over a locked `[start, end]` window, reusing the
 * exploratory correlation engine's selectors. Like a chart block, the window is
 * re-resolved live (never snapshotted) and inherits the article's default window
 * when `start`/`end` are omitted. `lag_days` shifts the outcome forward relative
 * to the trigger (e.g. does today's training load predict tomorrow's HRV).
 */
export const articleCorrelationBlockSchema = z
  .object({
    caption: z.string().max(280).optional().meta({ description: 'Optional caption shown under the scatter' }),
    end: iso8601DateTimeSchema
      .optional()
      .meta({ description: "Window end (ISO 8601); inherits the article's default window if omitted" }),
    lag_days: z
      .number()
      .int()
      .optional()
      .meta({ description: 'Days the outcome lags the trigger (default: 0)' }),
    outcome: selectorSchema.meta({ description: 'Outcome dimension' }),
    start: iso8601DateTimeSchema
      .optional()
      .meta({ description: "Window start (ISO 8601); inherits the article's default window if omitted" }),
    trigger: selectorSchema.meta({ description: 'Trigger / predictor dimension' }),
    type: z.literal('correlation'),
  })
  .meta({ description: 'A correlation scatter over a locked window', id: 'ArticleCorrelationBlock' })

/** An ordered content block of an article. */
export const articleBlockSchema = z
  .discriminatedUnion('type', [
    articleProseBlockSchema,
    articleChartBlockSchema,
    articleCorrelationBlockSchema,
  ])
  .meta({ description: 'An article content block (prose, chart, or correlation)', id: 'ArticleBlock' })

export type ArticleBlock = z.infer<typeof articleBlockSchema>

/**
 * The stored content of an article post: a title, an optional article-level
 * default window that chart and correlation blocks inherit, and the ordered blocks.
 */
export const articleContentSchema = z
  .object({
    blocks: z.array(articleBlockSchema).max(100).meta({ description: 'Ordered content blocks' }),
    default_end: iso8601DateTimeSchema
      .optional()
      .meta({ description: 'Default window end inherited by chart and correlation blocks (ISO 8601)' }),
    default_start: iso8601DateTimeSchema
      .optional()
      .meta({ description: 'Default window start inherited by chart and correlation blocks (ISO 8601)' }),
    title: z.string().min(1).max(200).meta({ description: 'Article title' }),
  })
  .meta({ id: 'ArticleContent' })

export type ArticleContent = z.infer<typeof articleContentSchema>

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
    // Present only for `article` posts (the stored title + default window +
    // ordered blocks); absent for `activity` posts.
    article: articleContentSchema
      .optional()
      .meta({ description: 'Article content, present only for `article` posts' }),
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
    kind: feedPostKindSchema.meta({ description: 'Post kind (`activity` or `article`)' }),
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

/**
 * Body for creating an article post. No activity anchor and no shared
 * metrics/series — an article carries its own title, default window, and blocks.
 */
export const createArticleBodySchema = z
  .object({
    blocks: z
      .array(articleBlockSchema)
      .max(100)
      .default([])
      .meta({ description: 'Ordered content blocks (prose, charts, correlations)' }),
    default_end: iso8601DateTimeSchema
      .optional()
      .meta({ description: 'Default window end inherited by chart and correlation blocks (ISO 8601)' }),
    default_start: iso8601DateTimeSchema
      .optional()
      .meta({ description: 'Default window start inherited by chart and correlation blocks (ISO 8601)' }),
    title: z.string().min(1).max(200).meta({ description: 'Article title' }),
    visibility: feedVisibilitySchema.default('public'),
  })
  .meta({ id: 'CreateArticleBody' })

export type CreateArticleBody = z.infer<typeof createArticleBodySchema>

/** Body for editing an article post (all fields optional; a given field replaces the stored one). */
export const updateArticleBodySchema = z
  .object({
    blocks: z
      .array(articleBlockSchema)
      .max(100)
      .optional()
      .meta({ description: 'Replacement ordered content blocks' }),
    default_end: iso8601DateTimeSchema.optional().meta({ description: 'Default window end (ISO 8601)' }),
    default_start: iso8601DateTimeSchema.optional().meta({ description: 'Default window start (ISO 8601)' }),
    title: z.string().min(1).max(200).optional().meta({ description: 'Article title' }),
    visibility: feedVisibilitySchema.optional(),
  })
  .meta({ id: 'UpdateArticleBody' })

export type UpdateArticleBody = z.infer<typeof updateArticleBodySchema>

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
// Followers (remote actors that follow this user — owner-facing management)
// =============================================================================

/** Acceptance state of a follower, and the filter used when listing them. */
export const followerStatusValues = ['pending', 'accepted', 'all'] as const

export const followerStatusSchema = z.enum(followerStatusValues).meta({
  description:
    'Follower acceptance filter: `pending` (awaiting your approval), `accepted` (approved), or `all`.',
  id: 'FollowerStatus',
})

export type FollowerStatus = z.infer<typeof followerStatusSchema>

/** Query for listing followers, optionally filtered by acceptance state. */
export const followersQuerySchema = z
  .object({
    status: followerStatusSchema.default('all').meta({
      description: 'Which followers to return (defaults to `all`).',
    }),
  })
  .meta({ id: 'FollowersQuery' })

export type FollowersQuery = z.infer<typeof followersQuerySchema>

/**
 * A remote actor that follows this user. Internal delivery details (the
 * follower's inbox / shared-inbox URIs) are deliberately NOT exposed — only
 * presentation fields and the acceptance state. `accepted` is false while their
 * Follow awaits the owner's approval (manual-approval mode).
 */
export const followerActorSchema = z
  .object({
    accepted: z
      .boolean()
      .meta({ description: 'Whether you have approved this follower (else a pending request)' }),
    actor_uri: z.string().meta({ description: "The follower's ActivityPub actor URI" }),
    avatar_url: z.string().nullable().meta({ description: "The follower's avatar URL, if known" }),
    created_at: iso8601DateTimeSchema.meta({ description: 'When the Follow arrived (ISO 8601)' }),
    display_name: z.string().nullable().meta({ description: "The follower's display name, if known" }),
    handle: z.string().nullable().meta({ description: "The follower's `@user@host` handle, if resolvable" }),
    id: z.string().uuid().meta({ description: 'Local id of the follower (used to approve/reject)' }),
  })
  .meta({ id: 'FollowerActor' })

export type FollowerActor = z.infer<typeof followerActorSchema>

/** Response wrapping the owner's list of followers (pending and/or accepted). */
export const followersResponseSchema = baseResponseSchema
  .extend({ followers: z.array(followerActorSchema) })
  .meta({ id: 'FollowersResponse' })

export type FollowersResponse = z.infer<typeof followersResponseSchema>

/** Response wrapping a single follower (e.g. the result of approving a request). */
export const followerResponseSchema = baseResponseSchema
  .extend({ follower: followerActorSchema.optional() })
  .meta({ id: 'FollowerResponse' })

export type FollowerResponse = z.infer<typeof followerResponseSchema>

// =============================================================================
// Home timeline (posts received from followed actors)
// =============================================================================

/**
 * An image attached to a received post (e.g. a rendered chart or route map, or a
 * Mastodon photo). Captured from the delivered Note's `attachment`s so the home
 * timeline can show it — the fallback when a post carries no native structured
 * chart. The `url` is served by the author's origin instance (a `followers`-only
 * post's URL carries its capability token).
 */
export const timelineImageSchema = z
  .object({
    height: z.number().int().optional().meta({ description: 'Intrinsic height in px, if known' }),
    media_type: z.string().optional().meta({ description: 'MIME type, e.g. `image/png`' }),
    name: z.string().optional().meta({ description: 'Alt text / caption, if any' }),
    url: z.string().meta({ description: 'Image URL (served by the author’s origin instance)' }),
    width: z.number().int().optional().meta({ description: 'Intrinsic width in px, if known' }),
  })
  .meta({ id: 'TimelineImage' })

export type TimelineImage = z.infer<typeof timelineImageSchema>

/** A post received from a followed actor, as shown in the home timeline. */
export const timelineEntrySchema = z
  .object({
    actor_uri: z.string().meta({ description: "The author's ActivityPub actor URI" }),
    avatar_url: z.string().nullable().meta({ description: "The author's avatar URL, if known" }),
    content: z
      .string()
      .meta({ description: 'The post HTML (already sanitised server-side; safe to render)' }),
    display_name: z.string().nullable().meta({ description: "The author's display name, if known" }),
    handle: z.string().nullable().meta({ description: "The author's `@user@host` handle, if known" }),
    id: z.string().uuid().meta({ description: 'Local id of the timeline entry' }),
    images: z.array(timelineImageSchema).optional().meta({
      description:
        'Image attachments (e.g. a rendered chart or route map), shown when the post carries no native structured chart.',
    }),
    object_uri: z.string().meta({ description: "The remote post's canonical id" }),
    published_at: iso8601DateTimeSchema.meta({ description: 'When the post was published (ISO 8601)' }),
    structured: feedStructuredSchema.optional().meta({
      description:
        'Native structured data (typed metrics + series), present only for posts from Aurboda instances — drives a native chart instead of the HTML.',
    }),
    url: z.string().nullable().meta({ description: 'Link to the original post' }),
  })
  .meta({ id: 'TimelineEntry' })

export type TimelineEntry = z.infer<typeof timelineEntrySchema>

/** Query for the home-timeline endpoint (keyset pagination). */
export const timelineQuerySchema = z
  .object({
    cursor: z.string().optional().meta({ description: "Opaque cursor from a previous page's `next_cursor`" }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .meta({ description: 'Max entries to return (1–50, default 20)' }),
  })
  .meta({ id: 'TimelineQuery' })

export type TimelineQuery = z.infer<typeof timelineQuerySchema>

/** A page of the home timeline, newest first, with an opaque cursor for the next page. */
export const timelineResponseSchema = baseResponseSchema
  .extend({
    entries: z.array(timelineEntrySchema),
    next_cursor: z
      .string()
      .nullable()
      .meta({ description: 'Cursor for the next page, or null if this is the last page' }),
  })
  .meta({ id: 'TimelineResponse' })

export type TimelineResponse = z.infer<typeof timelineResponseSchema>

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

/**
 * Response for the public *structured post* endpoint (`GET /public/:username/feed/:postId`).
 * `structured` is absent (with `success: false`) for unknown / non-public / non-exercise posts.
 * Consumed by another Aurboda instance on ingest to render a native chart.
 */
export const feedPostStructuredResponseSchema = baseResponseSchema
  .extend({ structured: feedStructuredSchema.optional() })
  .meta({ id: 'FeedPostStructuredResponse' })

export type FeedPostStructuredResponse = z.infer<typeof feedPostStructuredResponseSchema>
