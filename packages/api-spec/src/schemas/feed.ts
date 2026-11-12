/**
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
 */

import { z } from 'zod'

import { maxPostTags, normalizeTag } from '../hashtags.ts'
import { normalizeFediverseHandle } from '../support-contacts.ts'
import { challengeResultSchema } from './challenges.ts'
import {
  activityTypeSchema,
  baseResponseSchema,
  dataFieldPathSchema,
  iso8601DateTimeSchema,
  metricTypeSchema,
} from './common.ts'
import { activityImpactTypeSchema, selectorSchema } from './correlations.ts'
import { dashboardConfigSchema, periodKeySchema } from './dashboard.ts'
import {
  feedStructuredDashboardShareSchema,
  feedStructuredExerciseShareSchema,
  feedStructuredMetricSchema,
  feedStructuredPostSchema,
  publicSeriesSampleSchema,
} from './feed-structured.ts'
import { shareVisibilityValues } from './visibility.ts'

/**
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

const scalarMetricKeySchema = z.string().min(1).max(64)

/**
 * Exported so the share dialog can cap its textarea at the same limit the
 * schemas validate.
 */
export const feedPostMessageMaxLength = 2000

/** One hashtag as a client sends it: a leading `#` and any casing are accepted, and stored lowercase without `#`. */
export const hashtagInputSchema = z
  .string()
  .max(80)
  .refine((value) => normalizeTag(value) != null, {
    message: 'A tag is letters, digits and _ (at least one not a digit), at most 64 characters',
  })
  .meta({ description: 'A hashtag, e.g. `running` or `#Running` (stored lowercase without `#`)' })

const postTagsDescription =
  'Hashtags for the post, replacing the automatic ones (your default tags and the kind tag, e.g. `#aurboda #running`); `#tags` typed in the text are always added. Omit to use the automatic tags.'

/** Explicit tags on a share/create/update body; omitted means the automatic ones. */
export const postTagsInputSchema = z
  .array(hashtagInputSchema)
  .max(maxPostTags)
  .meta({ description: postTagsDescription })

const postTagsSchema = z
  .array(z.string())
  .meta({ description: "The post's hashtags, lowercase without `#` (federated as AS2 `Hashtag`s)" })

/**
 * Defaults are privacy-conservative: nothing is shared unless listed, and
 * high-resolution `series_metrics` default to empty (opt-in only).
 */
export const shareActivityBodySchema = z
  .object({
    include_chart: z
      .boolean()
      .default(false)
      .meta({ description: 'Attach a rendered chart image (drawn only from shared metrics)' }),
    include_exercises: z.boolean().default(false).meta({
      description:
        "Share each exercise of the session (a list field's categorical item, e.g. a strength session's sets by exercise) with its sets, e1RM, volume and the records it set",
    }),
    include_map: z
      .boolean()
      .default(false)
      .meta({ description: 'Attach a rendered route-map image (GPS activities only)' }),
    included_metrics: z
      .array(scalarMetricKeySchema)
      .max(64)
      .default([])
      .meta({ description: 'Scalar-summary metric keys to share (the single source of truth for the post)' }),
    message: z.string().max(feedPostMessageMaxLength).optional().meta({
      description:
        'Personal message shown above the shared stats (plain text; linebreaks preserved). Empty/absent shares no text.',
    }),
    series_metrics: z.array(metricTypeSchema).max(64).default([]).meta({
      description:
        'Metrics whose full high-resolution series are explicitly shared. Separate opt-in from the scalar summary; empty by default.',
    }),
    tags: postTagsInputSchema.optional(),
    visibility: feedVisibilitySchema.default('public'),
  })
  .meta({ id: 'ShareActivityBody' })

export type ShareActivityBody = z.infer<typeof shareActivityBodySchema>

export const updateFeedPostBodySchema = z
  .object({
    include_chart: z.boolean().optional().meta({ description: 'Attach a rendered chart image' }),
    include_exercises: z
      .boolean()
      .optional()
      .meta({ description: "Share the session's exercises with their sets, e1RM, volume and records" }),
    include_map: z.boolean().optional().meta({ description: 'Attach a rendered route-map image' }),
    included_metrics: z
      .array(scalarMetricKeySchema)
      .max(64)
      .optional()
      .meta({ description: 'Replacement set of shared scalar-summary metric keys' }),
    message: z.string().max(feedPostMessageMaxLength).optional().meta({
      description: 'Replacement personal message; an empty string clears it. Omit to keep the current one.',
    }),
    series_metrics: z
      .array(metricTypeSchema)
      .max(64)
      .optional()
      .meta({ description: 'Replacement set of explicitly-shared series metrics' }),
    tags: postTagsInputSchema.optional().meta({
      description:
        "Replacement hashtags; `#tags` typed in the message are always added. Omit to keep the post's tags (adjusted for a changed message).",
    }),
    visibility: feedVisibilitySchema.optional(),
  })
  .meta({ id: 'UpdateFeedPostBody' })

export type UpdateFeedPostBody = z.infer<typeof updateFeedPostBodySchema>

/**
 * The kind of a feed post. `activity` (the default) shares one of the user's
 * activities; `article` is a long-form post carrying markdown prose and inline
 * chart blocks over locked time windows; `challenge` invites people to a
 * challenge (a personal note plus the challenge's canonical join-by-URL link);
 * `exercise` shares one exercise's progress (records, trend, recent sessions);
 * `dashboard` shares one finished period of a period dashboard; `reply` is a
 * Mastodon-style comment on another post (`inReplyTo` + a `Mention` of its author). Modelled as a post *kind* rather than a separate entity so
 * every kind reuses the whole feed (visibility, federation, home timeline, the
 * public-profile feed, permalinks).
 */
export const feedPostKindSchema = z
  .enum(['activity', 'article', 'challenge', 'exercise', 'dashboard', 'reply'])
  .meta({
    description:
      "Feed post kind: an activity share, a long-form article, a challenge invitation, an exercise's progress, one period of a dashboard, or a reply to another post",
    id: 'FeedPostKind',
  })

export type FeedPostKind = z.infer<typeof feedPostKindSchema>

/**
 * The reply target (the object id, its author's actor URI and `@user@host`
 * handle) is resolved server-side from the addressed timeline entry, never
 * client-supplied, so a reply can never claim to answer a post it doesn't.
 *
 * `visibility` defaults to `unlisted`, matching Mastodon's convention that a
 * reply belongs to its thread rather than on public timelines; the author can
 * still choose `public` or `followers`.
 */
export const replyToPostBodySchema = z
  .object({
    message: z
      .string()
      .min(1)
      .max(feedPostMessageMaxLength)
      .refine((text) => text.trim().length > 0, { message: 'Reply text cannot be blank' })
      .meta({
        description:
          'The reply text (markdown, rendered through the shared sanitiser). Must be non-blank after trimming.',
      }),
    visibility: feedVisibilitySchema.default('unlisted'),
  })
  .meta({ id: 'ReplyToPostBody' })

export type ReplyToPostBody = z.infer<typeof replyToPostBodySchema>

/**
 * The stored payload of a `challenge` post: what the post links to. A snapshot
 * of the challenge's name plus its canonical public URL — the same join-by-URL
 * target the challenge page shares — resolved server-side at share time (from
 * the owner's own challenge, or from a joined remote challenge's
 * participation), never client-supplied. Deliberately carries no join token or
 * standings data; anyone following the link goes through the normal public
 * page / join flow.
 */
export const challengeShareSchema = z
  .object({
    host_identity: z.string().max(200).optional().meta({
      description:
        "The hosting instance's identity (e.g. `@user@host`) when sharing a joined remote challenge",
    }),
    name: z.string().min(1).max(200).meta({ description: 'Challenge name at share time' }),
    result: challengeResultSchema.optional().meta({
      description:
        'Final standings, present only on the completion post the host instance publishes when the challenge ends',
    }),
    url: z
      .string()
      .url()
      .max(500)
      .meta({ description: "The challenge's canonical public page URL (the join-by-URL target)" }),
  })
  .meta({ id: 'ChallengeShare' })

export type ChallengeShare = z.infer<typeof challengeShareSchema>

/**
 * Body for sharing a challenge to the feed. Exactly ONE of `challenge_id` (one
 * of the user's own challenges) or `participation_id` (a challenge they joined,
 * possibly hosted elsewhere) — the server resolves the linked name/URL itself,
 * so a post can never carry a spoofed link.
 */
export const shareChallengeBodySchema = z
  .object({
    challenge_id: z
      .string()
      .uuid()
      .optional()
      .meta({ description: 'One of your own challenges to share (exclusive with `participation_id`)' }),
    include_chart: z.boolean().default(true).meta({
      description:
        'Attach a rendered standings race-chart image (`standings.png`) for consumers that cannot draw the race themselves',
    }),
    message: z.string().max(feedPostMessageMaxLength).optional().meta({
      description:
        'Personal note shown above the link (markdown, rendered through the shared sanitiser). Empty/absent shares no text.',
    }),
    participation_id: z
      .string()
      .uuid()
      .optional()
      .meta({ description: 'A challenge you joined to share (exclusive with `challenge_id`)' }),
    tags: postTagsInputSchema.optional(),
    visibility: feedVisibilitySchema.default('public'),
  })
  .meta({ id: 'ShareChallengeBody' })

export type ShareChallengeBody = z.infer<typeof shareChallengeBodySchema>

/**
 * The stored payload of an `exercise` post (#1398): a pointer to one exercise (one item value of
 * one activity type) and the owner's opt-ins, resolved server-side at share time. The exercise's
 * data is not stored: it is resolved from the pointer whenever the post is rendered, so the post
 * shows the progress as of that read.
 */
export const exerciseShareSchema = z
  .object({
    activity_type: z.string().meta({ description: 'Activity type the exercise belongs to' }),
    field: z.string().meta({ description: 'Item path the exercise is a value of, e.g. `sets.exercise`' }),
    include_records: z
      .boolean()
      .meta({ description: 'Whether the records (best e1RM, max weight, …) and session count are shared' }),
    include_sessions: z.boolean().meta({ description: "Whether the last 5 sessions' sets are shared" }),
    name: z.string().min(1).max(200).meta({
      description: "Display name at share time: the published exercise's name, else the value",
    }),
    url: z.string().url().max(500).optional().meta({
      description: "The exercise's public page, present only when it was published and linked at share time",
    }),
    value: z.string().min(1).meta({ description: 'The item value, e.g. `Bench Press`' }),
  })
  .meta({ id: 'ExerciseShare' })

export type ExerciseShare = z.infer<typeof exerciseShareSchema>

/**
 * Body for sharing an exercise's progress to the feed. The server resolves the name and link
 * itself; the link is only included when the exercise is published as a shared exercise.
 */
export const shareExerciseBodySchema = z
  .object({
    activity_type: activityTypeSchema,
    field: dataFieldPathSchema.meta({
      description:
        'A categorical list-item path of the activity type whose value is shared, such as `sets.exercise`; session-level fields are rejected',
    }),
    include_chart: z.boolean().default(true).meta({
      description: 'Share the trend and per-week series, and attach a rendered trend image (`trend.png`)',
    }),
    include_link: z.boolean().default(true).meta({
      description: "Link the exercise's public page; only has an effect when the exercise is published",
    }),
    include_records: z
      .boolean()
      .default(true)
      .meta({ description: 'Share the records (best e1RM, max weight, …) and the session count' }),
    include_sessions: z
      .boolean()
      .default(false)
      .meta({ description: "Share the last 5 sessions' sets and measures" }),
    message: z.string().max(feedPostMessageMaxLength).optional().meta({
      description:
        'Personal note shown above the progress (markdown, rendered through the shared sanitiser). Empty/absent shares no text.',
    }),
    tags: postTagsInputSchema.optional(),
    value: z.string().min(1).max(200).meta({ description: 'The item value to share, e.g. `Bench Press`' }),
    visibility: feedVisibilitySchema.default('public'),
  })
  .meta({ id: 'ShareExerciseBody' })

export type ShareExerciseBody = z.infer<typeof shareExerciseBodySchema>

/**
 * The stored payload of a `dashboard` post (#1505): one finished period of a period dashboard and a
 * snapshot of the dashboard's config at share time, so a later edit of the dashboard never changes
 * what was shared. The figures are not stored: they are resolved from the snapshot for the period
 * whenever the post is read.
 */
export const dashboardShareSchema = z
  .object({
    config: dashboardConfigSchema.meta({
      description:
        'The dashboard config at share time (quick links neutered); the post draws its widgets from it',
    }),
    dashboard_id: z
      .string()
      .uuid()
      .optional()
      .meta({ description: 'The shared dashboard; absent for the home dashboard' }),
    include_link: z.boolean().meta({ description: "Whether the author asked to link the dashboard's page" }),
    name: z
      .string()
      .min(1)
      .max(200)
      .meta({ description: 'Dashboard name at share time (`Home` for the home dashboard)' }),
    period: periodKeySchema.meta({ description: 'The shared finished period' }),
    url: z.string().url().max(500).optional().meta({
      description:
        "The dashboard's public page, present only when it was published (unlisted or public) and linked at share time",
    }),
  })
  .meta({ id: 'DashboardShare' })

export type DashboardShare = z.infer<typeof dashboardShareSchema>

/**
 * Body for sharing one finished period of a period dashboard to the feed. The server snapshots the
 * dashboard's config and resolves the name and link itself; the link is only included when the
 * dashboard is published.
 */
export const shareDashboardPeriodBodySchema = z
  .object({
    dashboard_id: z.string().uuid().optional().meta({
      description:
        'One of your shared dashboards (see `list_shared_dashboards`); omit for the home dashboard',
    }),
    include_link: z.boolean().default(true).meta({
      description: "Link the dashboard's public page; only has an effect when the dashboard is published",
    }),
    message: z.string().max(feedPostMessageMaxLength).optional().meta({
      description:
        'Personal note shown above the figures (markdown, rendered through the shared sanitiser). Empty/absent shares no text.',
    }),
    period: periodKeySchema.meta({
      description:
        "The finished period to share, of the dashboard's granularity: 2026-10 (month), 2026-W44 (ISO week) or 2026 (year)",
    }),
    tags: postTagsInputSchema.optional(),
    visibility: feedVisibilitySchema.default('public'),
  })
  .meta({ id: 'ShareDashboardPeriodBody' })

export type ShareDashboardPeriodBody = z.infer<typeof shareDashboardPeriodBodySchema>

/** A run of markdown, rendered through the shared sanitiser. */
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
 * Pick a bucket granularity for an article chart block from its window span when
 * the block doesn't fix one (`bucket` omitted). Shared single source used by both
 * the web inline render and the backend server-side chart PNG, so a chart buckets
 * the same in-app and in a federated/exported image.
 */
export const defaultArticleChartBucket = (start: Date, end: Date): string =>
  end.getTime() - start.getTime() <= 2 * 86_400_000 ? '1h' : '1d'

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

/**
 * An impact block: HRV, heart rate and stress in the window before, during and
 * after each session of one activity over a locked `[start, end]` period — the
 * Analyze page's impact chart. `activity` names one grouping key exactly, as the
 * Analyze context table lists it. Like a chart block, the period is re-resolved
 * live and inherits the article's default window when `start`/`end` are omitted.
 */
export const articleImpactBlockSchema = z
  .object({
    activity: z.string().min(1).max(200).meta({
      description: 'The activity, location or category, exactly as the Analyze context table lists it',
    }),
    activity_type: activityImpactTypeSchema,
    caption: z.string().max(280).optional().meta({ description: 'Optional caption shown under the chart' }),
    end: iso8601DateTimeSchema
      .optional()
      .meta({ description: "Window end (ISO 8601); inherits the article's default window if omitted" }),
    start: iso8601DateTimeSchema
      .optional()
      .meta({ description: "Window start (ISO 8601); inherits the article's default window if omitted" }),
    type: z.literal('impact'),
    window_minutes: z
      .number()
      .int()
      .min(10)
      .max(1440)
      .optional()
      .meta({ description: 'Minutes before and after each session (10-1440, default 30)' }),
  })
  .meta({
    description:
      'The impact of an activity on HRV, heart rate and stress around its sessions, over a locked window',
    id: 'ArticleImpactBlock',
  })

/**
 * A challenge block: a challenge embedded by its public URL (one hosted here or
 * on another instance), rendered with its live standings and a link to join.
 * It has no time window — the challenge's own window applies.
 */
export const articleChallengeBlockSchema = z
  .object({
    caption: z
      .string()
      .max(280)
      .optional()
      .meta({ description: 'Optional caption shown with the challenge' }),
    challenge_url: z.string().url().max(2000).meta({
      description:
        "Public challenge URL (`<base>/u/<username>/<slug>`): an own challenge's `share_url` or a joined challenge's URL",
    }),
    type: z.literal('challenge'),
  })
  .meta({ description: 'A challenge with its live standings and a join link', id: 'ArticleChallengeBlock' })

export const articleBlockSchema = z
  .discriminatedUnion('type', [
    articleProseBlockSchema,
    articleChartBlockSchema,
    articleCorrelationBlockSchema,
    articleChallengeBlockSchema,
    articleImpactBlockSchema,
  ])
  .meta({
    description: 'An article content block (prose, chart, correlation, challenge, or impact)',
    id: 'ArticleBlock',
  })

export type ArticleBlock = z.infer<typeof articleBlockSchema>

export const articleContentSchema = z
  .object({
    blocks: z.array(articleBlockSchema).max(100).meta({ description: 'Ordered content blocks' }),
    default_end: iso8601DateTimeSchema.optional().meta({
      description: 'Default window end inherited by chart, correlation and impact blocks (ISO 8601)',
    }),
    default_start: iso8601DateTimeSchema.optional().meta({
      description: 'Default window start inherited by chart, correlation and impact blocks (ISO 8601)',
    }),
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
    article: articleContentSchema
      .optional()
      .meta({ description: 'Article content, present only for `article` posts' }),
    autoshare_rule_id: z.string().uuid().optional().meta({
      description: 'The auto-share rule that created this post (#903), absent for manual posts',
    }),
    // Attached by the feed LISTING only (one batched count query per page);
    // single-post responses (share / update) leave both absent.
    boost_count: z.number().int().optional().meta({
      description: 'How many remote actors boosted (`Announce`d) this post; absent on single-post responses',
    }),
    challenge: challengeShareSchema
      .optional()
      .meta({ description: 'Challenge link payload, present only for `challenge` posts' }),
    dashboard: dashboardShareSchema
      .optional()
      .meta({ description: 'Dashboard period and config snapshot, present only for `dashboard` posts' }),
    exercise: exerciseShareSchema
      .optional()
      .meta({ description: 'Exercise share pointer and opt-ins, present only for `exercise` posts' }),
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
    include_exercises: z
      .boolean()
      .meta({ description: "Whether the session's exercises (sets, e1RM, volume, records) are shared" }),
    include_map: z.boolean().meta({ description: 'Whether a route-map image is attached' }),
    included_metrics: z.array(z.string()).meta({ description: 'Shared scalar-summary metric keys' }),
    // Present only for `reply` posts: what this post answers. The handle is a
    // snapshot taken at reply time (it names the federated `Mention`), the same
    // rule `TimelineEntry.handle` follows.
    in_reply_to_actor_uri: z.string().optional().meta({
      description: "The replied-to post author's actor URI, present only for `reply` posts",
    }),
    in_reply_to_handle: z.string().optional().meta({
      description: "The replied-to post author's `@user@host` handle at reply time (`reply` posts)",
    }),
    in_reply_to_uri: z
      .string()
      .optional()
      .meta({ description: 'The replied-to object id, present only for `reply` posts' }),
    kind: feedPostKindSchema.meta({
      description: 'Post kind: `activity`, `article`, `challenge`, `exercise`, `dashboard` or `reply`',
    }),
    like_count: z.number().int().optional().meta({
      description: 'How many remote actors favourited (`Like`d) this post; absent on single-post responses',
    }),
    quote_count: z.number().int().optional().meta({
      description:
        'How many remote posts quote this post under an approval we granted (FEP-044f); absent on single-post responses',
    }),
    message: z
      .string()
      .optional()
      .meta({ description: 'Personal message shared with the post (plain text), if any' }),
    // The resolved scalar values behind `included_metrics`, typed — the same
    // shapes the structured-enrichment payload carries — so the web can render a
    // native stat grid instead of parsing the flattened `content` HTML. Resolved
    // at query time like `content`; absent when there is no resolvable activity.
    metrics: z
      .array(feedStructuredMetricSchema)
      .optional()
      .meta({ description: 'Resolved typed scalar values for the shared metrics (activity posts)' }),
    // Attached by the feed LISTING only, like the reaction counts above.
    reply_count: z.number().int().optional().meta({
      description:
        'How many replies (comments) this instance holds for this post; absent on single-post responses',
    }),
    series_metrics: z.array(z.string()).meta({ description: 'Explicitly-shared series metrics' }),
    structured: feedStructuredPostSchema.optional().meta({
      description:
        "The post's native structured payload (an activity's typed metrics + inline series; on the public profile listing also an article's resolved blocks or a challenge's document + standings snapshot), identical to what a subscribing peer receives — drives the native card render",
    }),
    tags: postTagsSchema,
    updated_at: z.string().meta({ description: 'Last update timestamp (ISO 8601)' }),
    visibility: feedVisibilitySchema,
  })
  .meta({ id: 'FeedPost' })

export type FeedPost = z.infer<typeof feedPostSchema>

export const feedPostResponseSchema = baseResponseSchema
  .extend({ post: feedPostSchema.optional() })
  .meta({ id: 'FeedPostResponse' })

export type FeedPostResponse = z.infer<typeof feedPostResponseSchema>

export const feedPostsQuerySchema = z
  .object({
    cursor: z.string().optional().meta({ description: "Opaque cursor from a previous page's `next_cursor`" }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .meta({ description: 'Max posts to return (1–50, default 20)' }),
  })
  .meta({ id: 'FeedPostsQuery' })

export type FeedPostsQuery = z.infer<typeof feedPostsQuerySchema>

/**
 * The UNAUTHENTICATED public profile listing takes only a cursor: the page size
 * is fixed server-side, since each post carries a full structured payload.
 */
export const publicPostsQuerySchema = z
  .object({
    cursor: z.string().optional().meta({ description: "Opaque cursor from a previous page's `next_cursor`" }),
    kind: feedPostKindSchema
      .optional()
      .meta({ description: 'Only posts of this kind, e.g. `article` for a blog view' }),
    tag: hashtagInputSchema
      .optional()
      .meta({ description: 'Only posts carrying this hashtag, e.g. `running`' }),
  })
  .meta({ id: 'PublicPostsQuery' })

export type PublicPostsQuery = z.infer<typeof publicPostsQuerySchema>

export const feedPostsResponseSchema = baseResponseSchema
  .extend({
    next_cursor: z
      .string()
      .nullable()
      .optional()
      .meta({ description: 'Cursor for the next page; null on the last page; absent when unpaginated' }),
    posts: z.array(feedPostSchema),
  })
  .meta({ id: 'FeedPostsResponse' })

export type FeedPostsResponse = z.infer<typeof feedPostsResponseSchema>

/** At most this many users, remote authors and tags, each, in the official feed setting. */
export const officialFeedMaxEntries = 20

/** A fediverse handle as an admin types it: `@name@host` or `name@host`, stored as `name@host`. */
export const fediverseHandleInputSchema = z
  .string()
  .max(255)
  .refine((value) => (normalizeFediverseHandle(value) ?? '') !== '', {
    message: 'A fediverse handle, e.g. @name@example.social',
  })
  .meta({ description: 'A fediverse handle, e.g. `@name@example.social` (stored as `name@example.social`)' })

export const officialFeedSettingSchema = z
  .object({
    remote_authors: z.array(fediverseHandleInputSchema).max(officialFeedMaxEntries).default([]).meta({
      description:
        "Authors on other servers (`user@host`) whose public posts carrying one of `tags` are listed; the server follows each tag's actor on the tag actor host to receive them. Needs at least one tag.",
    }),
    tags: z.array(hashtagInputSchema).max(officialFeedMaxEntries).meta({
      description:
        'Only posts carrying at least one of these hashtags (lowercase, without `#`); empty lists every public post of the users',
    }),
    users: z.array(z.string().min(1)).max(officialFeedMaxEntries).meta({
      description:
        'Local usernames whose public posts make up the feed; the feed is off when both this and `remote_authors` are empty',
    }),
  })
  .meta({
    description:
      "The instance's official feed, linked from the front page as its blog: public posts by these users and remote authors that carry one of these tags",
    id: 'OfficialFeedSetting',
  })

export type OfficialFeedSetting = z.infer<typeof officialFeedSettingSchema>

export const officialFeedQuerySchema = z
  .object({
    cursor: z.string().optional().meta({ description: "Opaque cursor from a previous page's `next_cursor`" }),
  })
  .meta({ description: 'Query of the official feed listing', id: 'OfficialFeedQuery' })

export type OfficialFeedQuery = z.infer<typeof officialFeedQuerySchema>

/**
 * The share PREVIEW returns the exact federated `content` HTML a
 * Mastodon follower would see and the typed scalars behind the native stat
 * grid, resolved for a given share selection WITHOUT creating a post — so the
 * dialog shows precisely what would leave the instance.
 */
export const sharePreviewResponseSchema = baseResponseSchema
  .extend({
    content: z
      .string()
      .optional()
      .meta({ description: 'The AS2 `content` HTML the post would federate with' }),
    has_exercises: z.boolean().optional().meta({
      description: 'Whether the session has exercises that `include_exercises` would share',
    }),
    metrics: z
      .array(feedStructuredMetricSchema)
      .optional()
      .meta({ description: 'The resolved typed scalar values for the selection' }),
    tags: z.array(z.string()).optional().meta({
      description:
        'The hashtags the post would carry (lowercase, without `#`): the automatic or given ones plus typed ones',
    }),
  })
  .meta({ id: 'SharePreviewResponse' })

export type SharePreviewResponse = z.infer<typeof sharePreviewResponseSchema>

/** The exercise share PREVIEW: the exact Note HTML and structured payload, creating nothing. */
export const exerciseSharePreviewResponseSchema = baseResponseSchema
  .extend({
    content: z
      .string()
      .optional()
      .meta({ description: 'The AS2 `content` HTML the post would federate with' }),
    structured: feedStructuredExerciseShareSchema
      .optional()
      .meta({ description: 'The structured payload an Aurboda peer would receive' }),
    tags: z.array(z.string()).optional().meta({
      description:
        'The hashtags the post would carry (lowercase, without `#`): the automatic or given ones plus typed ones',
    }),
  })
  .meta({ id: 'ExerciseSharePreviewResponse' })

export type ExerciseSharePreviewResponse = z.infer<typeof exerciseSharePreviewResponseSchema>

/** The dashboard-period share PREVIEW: the exact Note HTML and structured payload, creating nothing. */
export const dashboardSharePreviewResponseSchema = baseResponseSchema
  .extend({
    content: z
      .string()
      .optional()
      .meta({ description: 'The AS2 `content` HTML the post would federate with' }),
    structured: feedStructuredDashboardShareSchema
      .optional()
      .meta({ description: 'The structured payload an Aurboda peer would receive' }),
    tags: z.array(z.string()).optional().meta({
      description:
        'The hashtags the post would carry (lowercase, without `#`): the automatic or given ones plus typed ones',
    }),
  })
  .meta({ id: 'DashboardSharePreviewResponse' })

export type DashboardSharePreviewResponse = z.infer<typeof dashboardSharePreviewResponseSchema>

export const createArticleBodySchema = z
  .object({
    blocks: z.array(articleBlockSchema).max(100).default([]).meta({
      description: 'Ordered content blocks (prose, charts, correlations, challenges, impact charts)',
    }),
    default_end: iso8601DateTimeSchema.optional().meta({
      description: 'Default window end inherited by chart, correlation and impact blocks (ISO 8601)',
    }),
    default_start: iso8601DateTimeSchema.optional().meta({
      description: 'Default window start inherited by chart, correlation and impact blocks (ISO 8601)',
    }),
    tags: postTagsInputSchema.optional().meta({
      description:
        'Hashtags for the article, replacing your default tags; `#tags` typed in the title and prose are always added. Omit to use your default tags.',
    }),
    title: z.string().min(1).max(200).meta({ description: 'Article title' }),
    visibility: feedVisibilitySchema.default('public'),
  })
  .meta({ id: 'CreateArticleBody' })

export type CreateArticleBody = z.infer<typeof createArticleBodySchema>

export const updateArticleBodySchema = z
  .object({
    blocks: z
      .array(articleBlockSchema)
      .max(100)
      .optional()
      .meta({ description: 'Replacement ordered content blocks' }),
    default_end: iso8601DateTimeSchema.optional().meta({ description: 'Default window end (ISO 8601)' }),
    default_start: iso8601DateTimeSchema.optional().meta({ description: 'Default window start (ISO 8601)' }),
    tags: postTagsInputSchema.optional().meta({
      description:
        "Replacement hashtags; `#tags` typed in the title and prose are always added. Omit to keep the article's tags (adjusted for changed text).",
    }),
    title: z.string().min(1).max(200).optional().meta({ description: 'Article title' }),
    visibility: feedVisibilitySchema.optional(),
  })
  .meta({ id: 'UpdateArticleBody' })

export type UpdateArticleBody = z.infer<typeof updateArticleBodySchema>

/**
 * Article drafts are private work in progress: stored apart from feed posts, so
 * they never federate or appear on any feed, and lenient, so an unfinished
 * article can be saved. The block schemas below loosen only what a draft may
 * leave unset; publishing re-validates against `createArticleBodySchema`.
 */
export const articleDraftChartBlockSchema = articleChartBlockSchema
  .extend({ metric: metricTypeSchema.optional().meta({ description: 'The metric to chart, once chosen' }) })
  .meta({ description: 'A chart block in a draft; the metric may be unset', id: 'ArticleDraftChartBlock' })

export const articleDraftCorrelationBlockSchema = articleCorrelationBlockSchema
  .extend({
    outcome: selectorSchema.optional().meta({ description: 'Outcome dimension, once chosen' }),
    trigger: selectorSchema.optional().meta({ description: 'Trigger / predictor dimension, once chosen' }),
  })
  .meta({
    description: 'A correlation block in a draft; trigger and outcome may be unset',
    id: 'ArticleDraftCorrelationBlock',
  })

export const articleDraftChallengeBlockSchema = articleChallengeBlockSchema
  .extend({
    challenge_url: z
      .string()
      .url()
      .max(2000)
      .optional()
      .meta({ description: 'Public challenge URL, once chosen' }),
  })
  .meta({
    description: 'A challenge block in a draft; the URL may be unset',
    id: 'ArticleDraftChallengeBlock',
  })

export const articleDraftImpactBlockSchema = articleImpactBlockSchema
  .extend({
    activity: z.string().min(1).max(200).optional().meta({ description: 'The activity, once chosen' }),
  })
  .meta({
    description: 'An impact block in a draft; the activity may be unset',
    id: 'ArticleDraftImpactBlock',
  })

export const articleDraftBlockSchema = z
  .discriminatedUnion('type', [
    articleProseBlockSchema,
    articleDraftChartBlockSchema,
    articleDraftCorrelationBlockSchema,
    articleDraftChallengeBlockSchema,
    articleDraftImpactBlockSchema,
  ])
  .meta({
    description: 'A draft article block (prose, chart, correlation, challenge, or impact)',
    id: 'ArticleDraftBlock',
  })

export type ArticleDraftBlock = z.infer<typeof articleDraftBlockSchema>

export const articleDraftContentSchema = z
  .object({
    blocks: z.array(articleDraftBlockSchema).max(100).meta({ description: 'Ordered content blocks' }),
    default_end: iso8601DateTimeSchema.optional().meta({
      description: 'Default window end inherited by chart, correlation and impact blocks (ISO 8601)',
    }),
    default_start: iso8601DateTimeSchema.optional().meta({
      description: 'Default window start inherited by chart, correlation and impact blocks (ISO 8601)',
    }),
    tags: postTagsInputSchema.optional().meta({
      description:
        'Hashtags the article gets when published, replacing your default tags; absent uses the defaults. `#tags` typed in the text are always added.',
    }),
    title: z.string().max(200).meta({ description: 'Article title (may be empty in a draft)' }),
  })
  .meta({ description: 'Draft article content, possibly incomplete', id: 'ArticleDraftContent' })

export type ArticleDraftContent = z.infer<typeof articleDraftContentSchema>

export const articleDraftSchema = z
  .object({
    article: articleDraftContentSchema,
    created_at: z.string().meta({ description: 'Creation timestamp (ISO 8601)' }),
    id: z.string().uuid().meta({ description: 'Draft ID' }),
    updated_at: z.string().meta({ description: 'Last save timestamp (ISO 8601)' }),
    visibility: feedVisibilitySchema.meta({ description: 'Audience the article gets when published' }),
  })
  .meta({
    description: 'A private, unpublished article draft. Never federated or shown on any feed.',
    id: 'ArticleDraft',
  })

export type ArticleDraft = z.infer<typeof articleDraftSchema>

export const articleDraftResponseSchema = baseResponseSchema
  .extend({ draft: articleDraftSchema.optional() })
  .meta({ id: 'ArticleDraftResponse' })

export type ArticleDraftResponse = z.infer<typeof articleDraftResponseSchema>

export const articleDraftsResponseSchema = baseResponseSchema
  .extend({ drafts: z.array(articleDraftSchema).meta({ description: 'Drafts, most recently saved first' }) })
  .meta({ id: 'ArticleDraftsResponse' })

export type ArticleDraftsResponse = z.infer<typeof articleDraftsResponseSchema>

export const createArticleDraftBodySchema = z
  .object({
    article: articleDraftContentSchema
      .optional()
      .meta({ description: 'Initial content (may be incomplete); omitted starts an empty, untitled draft' }),
    visibility: feedVisibilitySchema.default('public'),
  })
  .meta({ description: 'Start a new article draft', id: 'CreateArticleDraftBody' })

export type CreateArticleDraftBody = z.infer<typeof createArticleDraftBodySchema>

export const updateArticleDraftBodySchema = z
  .object({
    blocks: z
      .array(articleDraftBlockSchema)
      .max(100)
      .optional()
      .meta({ description: 'Replacement ordered content blocks' }),
    default_end: iso8601DateTimeSchema
      .nullable()
      .optional()
      .meta({ description: 'Default window end (ISO 8601); `null` clears it, omitted keeps it' }),
    default_start: iso8601DateTimeSchema
      .nullable()
      .optional()
      .meta({ description: 'Default window start (ISO 8601); `null` clears it, omitted keeps it' }),
    tags: postTagsInputSchema.nullable().optional().meta({
      description:
        'Hashtags the article gets when published, replacing your default tags; `null` returns to the defaults, omitted keeps them',
    }),
    title: z.string().max(200).optional().meta({ description: 'Article title' }),
    visibility: feedVisibilitySchema.optional(),
  })
  .meta({
    description: 'Save changes to a draft; provided fields replace stored ones',
    id: 'UpdateArticleDraftBody',
  })

export type UpdateArticleDraftBody = z.infer<typeof updateArticleDraftBodySchema>

export const publishArticleDraftBodySchema = z
  .object({
    visibility: feedVisibilitySchema
      .optional()
      .meta({ description: "Audience for the published article; defaults to the draft's visibility" }),
  })
  .meta({ description: 'Publish a draft as an article post', id: 'PublishArticleDraftBody' })

export type PublishArticleDraftBody = z.infer<typeof publishArticleDraftBodySchema>

export const previewArticleBodySchema = z
  .object({
    article: articleDraftContentSchema.meta({
      description:
        'The article as written so far (may be incomplete); only its complete blocks are previewed',
    }),
    include_images: z.boolean().optional().meta({
      description:
        'Also draw each figure Mastodon shows, as SVG markup in `attachments[].image_svg` (meant for UIs)',
    }),
    visibility: feedVisibilitySchema.default('public'),
  })
  .meta({
    description: 'Preview what an article (draft) would federate as; creates nothing',
    id: 'PreviewArticleBody',
  })

export type PreviewArticleBody = z.infer<typeof previewArticleBodySchema>

export const articlePreviewAttachmentSchema = z
  .object({
    block_index: z.number().int().optional().meta({
      description: "The figure's block index in `article.blocks`; absent for an image in the prose",
    }),
    figure: z.number().int().meta({ description: 'The 1-based figure number, in document order' }),
    height: z.number().int().optional().meta({ description: 'Image height in pixels, when known' }),
    image_svg: z.string().nullable().optional().meta({
      description:
        'With `include_images`, for a block figure Mastodon shows: the image as SVG markup, `null` when the block has no data to draw',
    }),
    media_type: z.string().optional().meta({ description: 'Image media type, when known' }),
    name: z.string().meta({ description: 'The alt text the attachment carries (`Figure N: label`)' }),
    shown_in_mastodon: z.boolean().meta({
      description: "Whether Mastodon shows it; false beyond Mastodon's four-attachment limit",
    }),
    url: z.string().optional().meta({
      description: "A prose image's own URL; absent for a block figure, whose post does not exist yet",
    }),
    width: z.number().int().optional().meta({ description: 'Image width in pixels, when known' }),
  })
  .meta({ description: 'One image the article Note would attach', id: 'ArticlePreviewAttachment' })

export type ArticlePreviewAttachment = z.infer<typeof articlePreviewAttachmentSchema>

export const articlePreviewResponseSchema = baseResponseSchema
  .extend({
    attachments: z
      .array(articlePreviewAttachmentSchema)
      .optional()
      .meta({ description: 'The images the Note would attach, numbered as in the text' }),
    content: z
      .string()
      .optional()
      .meta({ description: 'The AS2 `content` HTML the article would federate with' }),
    mastodon: z
      .object({
        attachment_limit: z
          .number()
          .int()
          .meta({ description: 'How many attachments Mastodon shows on one status' }),
        content: z.string().meta({
          description:
            '`content` as Mastodon keeps it after its sanitiser, without the trailing paragraph of hashtags',
        }),
        hashtag_bar: z.array(z.string()).meta({
          description: 'Tags Mastodon shows as a bar under the media (lowercase, without `#`)',
        }),
      })
      .optional()
      .meta({ description: "An emulation of how Mastodon's web UI shows the status" }),
    name: z.string().optional().meta({ description: 'The Note `name` (the title)' }),
    notes: z
      .array(z.string())
      .optional()
      .meta({ description: 'What Mastodon changes for this post, in plain sentences' }),
    publish_error: z.string().nullable().optional().meta({
      description: 'What still keeps the article from publishing; `null` when it is publishable',
    }),
    tags: z.array(z.string()).optional().meta({
      description:
        'The hashtags the article would carry (lowercase, without `#`): the explicit or default ones plus typed ones',
    }),
  })
  .meta({ id: 'ArticlePreviewResponse' })

export type ArticlePreviewResponse = z.infer<typeof articlePreviewResponseSchema>

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
    notify_on_post: z.boolean().meta({
      description: "Whether to notify on this actor's new posts (used by the app for push notifications)",
    }),
  })
  .meta({ id: 'FollowingActor' })

export type FollowingActor = z.infer<typeof followingActorSchema>

export const updateFollowingBodySchema = z
  .object({
    notify_on_post: z.boolean().meta({
      description: "Whether to notify on this actor's new posts",
    }),
  })
  .meta({ id: 'UpdateFollowingBody' })

export type UpdateFollowingBody = z.infer<typeof updateFollowingBodySchema>

export const followActorResponseSchema = baseResponseSchema
  .extend({ actor: followingActorSchema.optional() })
  .meta({ id: 'FollowActorResponse' })

export type FollowActorResponse = z.infer<typeof followActorResponseSchema>

export const followingResponseSchema = baseResponseSchema
  .extend({ following: z.array(followingActorSchema) })
  .meta({ id: 'FollowingResponse' })

export type FollowingResponse = z.infer<typeof followingResponseSchema>

export const followTagBodySchema = z
  .object({
    tag: z.string().trim().min(1).max(80).meta({
      description: 'The hashtag to follow, with or without `#`',
      example: '#running',
    }),
  })
  .meta({ id: 'FollowTagBody' })

export type FollowTagBody = z.infer<typeof followTagBodySchema>

/** A followed hashtag: the follow of its tag actor (`<tag>@<tag actor host>`), plus the tag. */
export const followedTagSchema = followingActorSchema
  .extend({ tag: z.string().meta({ description: 'The followed hashtag, lowercase without `#`' }) })
  .meta({ id: 'FollowedTag' })

export type FollowedTag = z.infer<typeof followedTagSchema>

export const followTagResponseSchema = baseResponseSchema
  .extend({ followed_tag: followedTagSchema.optional() })
  .meta({ id: 'FollowTagResponse' })

export type FollowTagResponse = z.infer<typeof followTagResponseSchema>

export const followedTagsResponseSchema = baseResponseSchema
  .extend({ followed_tags: z.array(followedTagSchema) })
  .meta({ id: 'FollowedTagsResponse' })

export type FollowedTagsResponse = z.infer<typeof followedTagsResponseSchema>

export const followerStatusValues = ['pending', 'accepted', 'all'] as const

export const followerStatusSchema = z.enum(followerStatusValues).meta({
  description:
    'Follower acceptance filter: `pending` (awaiting your approval), `accepted` (approved), or `all`.',
  id: 'FollowerStatus',
})

export type FollowerStatus = z.infer<typeof followerStatusSchema>

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

export const followersResponseSchema = baseResponseSchema
  .extend({ followers: z.array(followerActorSchema) })
  .meta({ id: 'FollowersResponse' })

export type FollowersResponse = z.infer<typeof followersResponseSchema>

export const followerResponseSchema = baseResponseSchema
  .extend({ follower: followerActorSchema.optional() })
  .meta({ id: 'FollowerResponse' })

export type FollowerResponse = z.infer<typeof followerResponseSchema>

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

/**
 * The followee who boosted (AS2 `Announce`d) a post into the reader's timeline —
 * present only on a **boost card**, whose author fields describe the ORIGINAL
 * post. Mastodon shows the same "X boosted" line above the original card.
 */
export const timelineBoostedBySchema = z
  .object({
    actor_uri: z.string().meta({ description: "The booster's ActivityPub actor URI" }),
    display_name: z.string().nullable().meta({ description: "The booster's display name, if known" }),
    handle: z.string().nullable().meta({ description: "The booster's `@user@host` handle, if known" }),
    tag: z.string().optional().meta({
      description:
        'Set when the booster is a followed tag actor: the tag (lowercase, no `#`), so the card can show `#tag` instead of a boost line',
    }),
  })
  .meta({ id: 'TimelineBoostedBy' })

export type TimelineBoostedBy = z.infer<typeof timelineBoostedBySchema>

export const timelineEntrySchema = z
  .object({
    actor_uri: z.string().meta({ description: "The author's ActivityPub actor URI" }),
    avatar_url: z.string().nullable().meta({ description: "The author's avatar URL, if known" }),
    boost_of_uri: z.string().optional().meta({
      description:
        'On a boost card, the id of the ORIGINAL Note that was boosted (this entry’s `object_uri` is the `Announce` activity id). Absent on a direct entry.',
    }),
    boosted: z.boolean().optional().meta({
      description: 'Present (and true) when YOU have boosted this post (an `Announce` you sent)',
    }),
    boosted_by: timelineBoostedBySchema.optional().meta({
      description: 'On a boost card, the followee who boosted the original post',
    }),
    content: z
      .string()
      .meta({ description: 'The post HTML (already sanitised server-side; safe to render)' }),
    display_name: z.string().nullable().meta({ description: "The author's display name, if known" }),
    handle: z.string().nullable().meta({ description: "The author's `@user@host` handle, if known" }),
    id: z.string().uuid().meta({ description: 'Local id of the timeline entry' }),
    liked: z.boolean().optional().meta({
      description: 'Present (and true) when YOU have favourited this post (a `Like` you sent)',
    }),
    in_reply_to_mine: z.boolean().optional().meta({
      description:
        'True when this is a reply to one of YOUR posts (present only on replies) — such replies always show and notify regardless of the `timeline_show_replies` setting',
    }),
    in_reply_to_uri: z.string().nullable().optional().meta({
      description: 'The `inReplyTo` object id when this post is a reply, else absent/null',
    }),
    mentions_me: z.boolean().optional().meta({
      description:
        'True when the post carries a Mention of you — such posts always show and notify regardless of the `timeline_show_replies` setting',
    }),
    images: z.array(timelineImageSchema).optional().meta({
      description:
        'Image attachments (e.g. a rendered chart or route map), shown when the post carries no native structured chart.',
    }),
    object_uri: z.string().meta({ description: "The remote post's canonical id" }),
    published_at: iso8601DateTimeSchema.meta({ description: 'When the post was published (ISO 8601)' }),
    received_at: iso8601DateTimeSchema.meta({
      description:
        'When this instance received the post (ISO 8601). Monotonic per timeline — the correct high-water mark for "what have I already seen", since `published_at` can arrive out of order after federation retries.',
    }),
    structured: feedStructuredPostSchema.optional().meta({
      description:
        'Native structured data (an activity share’s typed metrics/series, an article’s title + resolved blocks, or a challenge’s document + standings snapshot), present only for posts from Aurboda instances — drives a native render instead of the HTML.',
    }),
    tags: z.array(z.string()).meta({
      description:
        "The post's hashtags, lowercase without `#`, as the origin declared them (plus the followed tag on a card boosted by a tag actor)",
    }),
    url: z.string().nullable().meta({ description: 'Link to the original post' }),
  })
  .meta({ id: 'TimelineEntry' })

export type TimelineEntry = z.infer<typeof timelineEntrySchema>

/**
 * Response wrapping a single home-timeline entry — what a like/boost toggle
 * returns, so the client can replace its optimistic patch with the server's
 * authoritative row.
 */
export const timelineEntryResponseSchema = baseResponseSchema
  .extend({ entry: timelineEntrySchema.optional() })
  .meta({ id: 'TimelineEntryResponse' })

export type TimelineEntryResponse = z.infer<typeof timelineEntryResponseSchema>

export const publicTagPostsQuerySchema = z
  .object({
    cursor: z.string().optional().meta({ description: "Opaque cursor from a previous page's `next_cursor`" }),
  })
  .meta({ description: 'Query of a public tag page listing', id: 'PublicTagPostsQuery' })

export type PublicTagPostsQuery = z.infer<typeof publicTagPostsQuerySchema>

export const publicTagPostSchema = timelineEntrySchema
  .pick({
    actor_uri: true,
    avatar_url: true,
    content: true,
    display_name: true,
    handle: true,
    id: true,
    images: true,
    object_uri: true,
    published_at: true,
    received_at: true,
    tags: true,
    url: true,
  })
  .meta({
    description: 'A post on a public tag page, shown as the home timeline shows a remote post',
    id: 'PublicTagPost',
  })

export type PublicTagPost = z.infer<typeof publicTagPostSchema>

export const publicTagPostsResponseSchema = baseResponseSchema
  .extend({
    next_cursor: z
      .string()
      .nullable()
      .meta({ description: 'Cursor for the next page; null on the last page' }),
    posts: z.array(publicTagPostSchema).meta({
      description:
        'Public posts carrying the tag, from this server and others, newest first (content sanitised server-side)',
    }),
    retention_days: z.number().int().meta({ description: 'How many days a post stays listed' }),
    tag: z.string().meta({ description: 'The tag, lowercase without `#`' }),
  })
  .meta({
    description:
      "A page of a public tag page: public posts carrying the hashtag that this server's instance actor received from the tag's actor, plus this server's own",
    id: 'PublicTagPostsResponse',
  })

export type PublicTagPostsResponse = z.infer<typeof publicTagPostsResponseSchema>

/** A post on the instance's official feed by a local user: as on its author's public profile, plus who wrote it. */
export const officialFeedPostSchema = feedPostSchema
  .extend({
    author_username: z.string().meta({ description: "The post author's local username" }),
    origin: z.literal('local').meta({ description: 'A post by a local user' }),
  })
  .meta({
    description: 'A post in the official feed by a local user, with its author',
    id: 'OfficialFeedPost',
  })

export type OfficialFeedPost = z.infer<typeof officialFeedPostSchema>

/** A post on the instance's official feed by an author on another server, as a public tag page shows it. */
export const officialFeedRemotePostSchema = publicTagPostSchema
  .extend({
    origin: z.literal('remote').meta({ description: 'A post by an author on another server' }),
  })
  .meta({
    description: 'A post in the official feed by an author on another server',
    id: 'OfficialFeedRemotePost',
  })

export type OfficialFeedRemotePost = z.infer<typeof officialFeedRemotePostSchema>

export const officialFeedEntrySchema = z
  .discriminatedUnion('origin', [officialFeedPostSchema, officialFeedRemotePostSchema])
  .meta({
    description:
      "A post in the official feed: `origin` `local` for a local user's post, `remote` for one by an author on another server",
    id: 'OfficialFeedEntry',
  })

export type OfficialFeedEntry = z.infer<typeof officialFeedEntrySchema>

export const officialFeedResponseSchema = baseResponseSchema
  .extend({
    next_cursor: z
      .string()
      .nullable()
      .optional()
      .meta({ description: 'Cursor for the next page; null on the last page' }),
    posts: z.array(officialFeedEntrySchema),
    remote_authors: z.array(z.string()).optional().meta({
      description: 'The authors on other servers (`user@host`) whose posts are listed; absent on errors',
    }),
    tags: z
      .array(z.string())
      .optional()
      .meta({ description: 'The hashtags a post needs one of to be listed (empty: any); absent on errors' }),
    users: z
      .array(z.string())
      .optional()
      .meta({ description: 'The usernames whose posts are listed; absent on errors' }),
  })
  .meta({
    description:
      "A page of the instance's official feed: public posts by the chosen users and remote authors with one of the chosen tags",
    id: 'OfficialFeedResponse',
  })

export type OfficialFeedResponse = z.infer<typeof officialFeedResponseSchema>

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
    tag: z
      .string()
      .max(80)
      .transform((value) => normalizeTag(value))
      .refine((value): value is string => value != null, { message: 'Not a valid hashtag' })
      .optional()
      .meta({ description: 'Only entries carrying this hashtag, e.g. `running` or `#running`' }),
  })
  .meta({ id: 'TimelineQuery' })

export type TimelineQuery = z.infer<typeof timelineQuerySchema>

/**
 * One reply in a post's thread snapshot: fetched live from the origin's
 * `replies` collection, or one of the reader's OWN replies merged in (`mine`)
 * — the origin may not list ours yet, and a thread that hides its own author's
 * reply reads as if it were never sent.
 */
export const timelineReplySchema = z
  .object({
    actor_uri: z.string().nullable().meta({ description: "The reply author's actor URI, if declared" }),
    content: z.string().meta({ description: 'The reply HTML (sanitised server-side; safe to render)' }),
    display_name: z.string().nullable().meta({ description: "The author's display name, if resolved" }),
    handle: z.string().nullable().meta({ description: "The author's `@user@host` handle, if resolved" }),
    mine: z.boolean().optional().meta({
      description: 'Present (and true) when this reply is one YOU published from this instance',
    }),
    object_uri: z
      .string()
      .nullable()
      .meta({ description: "The reply's canonical AS2 object id, when it declares one" }),
    published_at: iso8601DateTimeSchema.nullable().meta({ description: 'When the reply was published' }),
    url: z.string().nullable().meta({ description: 'Link to the reply on its origin' }),
  })
  .meta({ id: 'TimelineReply' })

export type TimelineReply = z.infer<typeof timelineReplySchema>

/** Replies fetched live from the remote post behind one timeline entry. */
export const timelineRepliesResponseSchema = baseResponseSchema
  .extend({
    fetched: z.boolean().meta({
      description:
        "False when the origin's thread could not be read at all (the post or its first page never loaded) — an empty list then means 'unknown', not 'no replies'",
    }),
    partial: z.boolean().meta({
      description:
        'True when the fetch hit its budget (count/time) before exhausting the collection — more replies may exist on the origin',
    }),
    replies: z.array(timelineReplySchema).meta({ description: 'The fetched replies, oldest first' }),
  })
  .meta({ id: 'TimelineRepliesResponse' })

export type TimelineRepliesResponse = z.infer<typeof timelineRepliesResponseSchema>

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

/**
 * The comments under one of the owner's OWN posts: the replies this instance
 * already holds as timeline entries (ingested from any actor whose Note replied
 * to that post), oldest first. No network: the origin of each reply is
 * whoever delivered it. They are full `TimelineEntry`s, so each carries the
 * reader's like/boost state and can itself be replied to.
 */
export const feedPostRepliesResponseSchema = baseResponseSchema
  .extend({
    replies: z
      .array(timelineEntrySchema)
      .meta({ description: 'Replies received for this post, oldest first' }),
  })
  .meta({ id: 'FeedPostRepliesResponse' })

export type FeedPostRepliesResponse = z.infer<typeof feedPostRepliesResponseSchema>

export const feedReactionKindSchema = z.enum(['like', 'announce']).meta({
  description: 'Reaction kind: `like` (AS2 `Like` — a favourite) or `announce` (AS2 `Announce` — a boost)',
  id: 'FeedReactionKind',
})

export type FeedReactionKind = z.infer<typeof feedReactionKindSchema>

export const feedPostReactionKindSchema = z.enum(['like', 'announce', 'quote']).meta({
  description:
    'Kind of reaction on one of your posts: `like` (a favourite), `announce` (a boost) or `quote` (a remote post quoting it under an approval we granted, FEP-044f)',
  id: 'FeedPostReactionKind',
})

export type FeedPostReactionKind = z.infer<typeof feedPostReactionKindSchema>

/**
 * One remote actor's reaction to one of the owner's own feed posts: an inbound
 * `Like`/`Announce`, or a quote we approved. A like's or boost's presentation
 * fields are a best-effort snapshot taken when it arrived; a quote's are
 * resolved from whatever this instance has cached for the actor.
 */
export const feedPostReactionSchema = z
  .object({
    actor_uri: z.string().meta({ description: "The reacting actor's ActivityPub actor URI" }),
    avatar_url: z.string().nullable().meta({ description: "The actor's avatar URL, if known" }),
    created_at: iso8601DateTimeSchema.meta({
      description: 'When the reaction was received, or the quote approved (ISO 8601)',
    }),
    display_name: z.string().nullable().meta({ description: "The actor's display name, if known" }),
    handle: z.string().nullable().meta({ description: "The actor's `@user@host` handle, if known" }),
    kind: feedPostReactionKindSchema,
    url: z
      .string()
      .optional()
      .meta({ description: "The quoting post's id (URL), present only for `quote` reactions" }),
  })
  .meta({ id: 'FeedPostReaction' })

export type FeedPostReaction = z.infer<typeof feedPostReactionSchema>

/** Who liked, boosted or quoted one of the owner's posts, newest first. */
export const feedPostReactionsResponseSchema = baseResponseSchema
  .extend({ reactions: z.array(feedPostReactionSchema) })
  .meta({ id: 'FeedPostReactionsResponse' })

export type FeedPostReactionsResponse = z.infer<typeof feedPostReactionsResponseSchema>

/**
 * Bucket size for a public series request. Restricted to sub-day units
 * (`s`/`m`/`h`) because a series window is a single activity; server floors the
 * granularity to a minimum (see `PublicSeriesQuery`).
 */
export const seriesBucketSchema = z
  .string()
  .regex(/^\d+[smhd]$/, 'Must be {number}{unit} where unit is s, m, h, or d')
  .meta({
    description: 'Bucket size: {number}{unit} where unit is s (seconds), m (minutes), h (hours), or d (days)',
    example: '5s',
    id: 'SeriesBucket',
  })

/**
 * Resolves ONLY when a feed post shared `metric` as a series for an activity
 * whose window covers `[start, end]`. The effective range is clamped to that
 * activity's window and the bucket granularity is floored server-side. Requests
 * for an unshared metric, or a window not covered by any shared activity, 404.
 */
export const publicSeriesQuerySchema = z
  .object({
    bucket: seriesBucketSchema,
    end: iso8601DateTimeSchema.meta({ description: 'End of the requested window (ISO 8601)' }),
    metric: z.string().min(1).meta({
      description: 'Metric key, lowerCamelCase (`heartRate`); the `0.1` snake_case form is also accepted',
    }),
    start: iso8601DateTimeSchema.meta({ description: 'Start of the requested window (ISO 8601)' }),
  })
  .meta({ id: 'PublicSeriesQuery' })

export type PublicSeriesQuery = z.infer<typeof publicSeriesQuerySchema>

/** Payload fields are optional so 404 responses type-check. */
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
 * `structured` is absent (with `success: false`) for unknown / non-public posts. Consumed by
 * another Aurboda instance on ingest to render a native chart or article.
 */
export const feedPostStructuredResponseSchema = baseResponseSchema
  .extend({ structured: feedStructuredPostSchema.optional() })
  .meta({ id: 'FeedPostStructuredResponse' })

export type FeedPostStructuredResponse = z.infer<typeof feedPostStructuredResponseSchema>

/**
 * Response for the article markdown-export endpoint: a paste-ready rendering of
 * the article's title + prose, with each chart/correlation/impact block as a link to
 * its rendered PNG (the C1 block-image endpoint) — meant for pasting into a
 * text-only destination like r/QuantifiedSelf. `markdown` is absent (with
 * `success: false`) for an unknown id or a non-article post.
 */
export const articleExportResponseSchema = baseResponseSchema
  .extend({
    markdown: z.string().optional().meta({
      description: 'Paste-ready markdown: title + prose + one image link per data block',
    }),
  })
  .meta({ id: 'ArticleExportResponse' })

export type ArticleExportResponse = z.infer<typeof articleExportResponseSchema>
