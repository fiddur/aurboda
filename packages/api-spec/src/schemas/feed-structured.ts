/**
 * Structured, machine-readable representation of a shared exercise or article
 * post — the data an Aurboda instance federates to *other Aurboda instances* so
 * they can render a native chart + typed stats instead of just the
 * Mastodon-style HTML.
 *
 * Imports only `common` and `correlations` (never `feed.ts`), so both the
 * public-series endpoint and the timeline entry can reuse
 * `publicSeriesSampleSchema` without a circular import back through `feed.ts`;
 * `correlations.ts` is itself a `common`-only leaf, so no cycle is introduced.
 *
 * The origin instance serves this at `GET /public/:username/feed/:postId`
 * (see the backend feed-public router); a following instance fetches it on
 * ingest (see `timeline-enrich.ts`) and stores it on the timeline entry.
 */
import { z } from 'zod'

import { iso8601DateTimeSchema } from './common.ts'
import { alignedPointSchema, groupComparisonSchema, selectorSchema } from './correlations.ts'

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

/** One shared scalar summary — a typed metric value (mirrors the `aurboda:metrics` extension). */
export const feedStructuredMetricSchema = z
  .object({
    key: z
      .string()
      .meta({ description: 'Machine key, e.g. `heart_rate_avg`, `distance`, `hr_zone_minutes`' }),
    unit: z.string().optional().meta({ description: 'Unit for the scalar form (e.g. `bpm`, `km`)' }),
    value: z
      .union([z.number(), z.record(z.string(), z.number())])
      .meta({ description: 'Scalar value, or a small keyed record (e.g. HR-zone minutes `{ z2: 22 }`)' }),
  })
  .meta({ id: 'FeedStructuredMetric' })

export type FeedStructuredMetric = z.infer<typeof feedStructuredMetricSchema>

/** One shared high-resolution series: a metric plus its bucketed samples over the activity window. */
export const feedStructuredSeriesSchema = z
  .object({
    bucket: z.string().meta({ description: 'Effective bucket granularity (e.g. `5s`)' }),
    metric: z.string().meta({ description: 'The metric key, e.g. `heart_rate`' }),
    samples: z
      .array(publicSeriesSampleSchema)
      .meta({ description: 'Bucketed samples over the activity window' }),
    unit: z.string().optional().meta({ description: 'Unit of the metric (e.g. `bpm`)' }),
  })
  .meta({ id: 'FeedStructuredSeries' })

export type FeedStructuredSeries = z.infer<typeof feedStructuredSeriesSchema>

/**
 * The full structured payload for a shared exercise post. Only the metrics and
 * series the author actually shared are present. Rendered natively by a
 * following Aurboda instance (typed stats + an interactive series chart).
 */
export const feedStructuredSchema = z
  .object({
    activity_type: z.string().meta({ description: 'Activity type, e.g. `exercise`' }),
    duration_seconds: z
      .number()
      .optional()
      .meta({ description: 'Activity duration in seconds (present when the activity has an end)' }),
    end_time: iso8601DateTimeSchema.optional().meta({ description: 'Activity end (ISO 8601), if any' }),
    metrics: z.array(feedStructuredMetricSchema).meta({ description: 'Shared scalar summaries' }),
    series: z
      .array(feedStructuredSeriesSchema)
      .meta({ description: 'Shared high-resolution series (may be empty)' }),
    start_time: iso8601DateTimeSchema.meta({ description: 'Activity start (ISO 8601)' }),
    title: z.string().optional().meta({ description: 'Activity title, if any' }),
  })
  .meta({ id: 'FeedStructured' })

export type FeedStructured = z.infer<typeof feedStructuredSchema>

/**
 * `FeedStructured` tagged with its post kind, so a consumer of the discriminated
 * `FeedStructuredPost` union (below) can narrow on `kind` before reading the
 * activity-shaped fields. The wire shape is otherwise identical to
 * `FeedStructured` — this is purely the `kind` tag for the union.
 */
export const feedStructuredActivitySchema = feedStructuredSchema
  .extend({ kind: z.literal('activity').meta({ description: 'Discriminator: an activity-share post' }) })
  .meta({ id: 'FeedStructuredActivity' })

export type FeedStructuredActivity = z.infer<typeof feedStructuredActivitySchema>

// =============================================================================
// Article structured enrichment (FeedStructuredArticle)
// =============================================================================

/**
 * A resolved prose block: the author's raw markdown, unmodified. Rendered
 * through the receiver's own sanitising markdown renderer (the same `#910`
 * boundary the owner's web app uses for its own posts) rather than pre-rendered
 * HTML, so a receiving Aurboda peer controls its own sanitisation rather than
 * trusting a remote instance's HTML.
 */
export const feedStructuredArticleProseBlockSchema = z
  .object({ markdown: z.string().meta({ description: 'Raw authored markdown' }), type: z.literal('prose') })
  .meta({ description: 'A resolved prose block', id: 'FeedStructuredArticleProseBlock' })

export type FeedStructuredArticleProseBlock = z.infer<typeof feedStructuredArticleProseBlockSchema>

/**
 * A resolved chart block: the metric bucketed over its locked `[start, end]`
 * window (the same bucketing the block's own PNG/inline render uses), so a
 * receiving peer can draw a real interactive chart instead of only linking the
 * rendered image.
 */
export const feedStructuredArticleChartBlockSchema = z
  .object({
    bucket: z.string().meta({ description: 'Effective bucket granularity used to resolve `samples`' }),
    caption: z.string().optional().meta({ description: 'Optional caption' }),
    end: iso8601DateTimeSchema.meta({ description: "Block's locked window end (ISO 8601)" }),
    metric: z.string().meta({ description: 'The charted metric' }),
    samples: z
      .array(publicSeriesSampleSchema)
      .meta({ description: 'Bucketed samples over the window (may be too few to draw a line)' }),
    start: iso8601DateTimeSchema.meta({ description: "Block's locked window start (ISO 8601)" }),
    type: z.literal('chart'),
    unit: z.string().optional().meta({ description: 'Unit of the metric, if known' }),
  })
  .meta({ description: 'A resolved chart block', id: 'FeedStructuredArticleChartBlock' })

export type FeedStructuredArticleChartBlock = z.infer<typeof feedStructuredArticleChartBlockSchema>

/**
 * A resolved correlation block: the computed continuous correlation (Pearson /
 * Spearman / n / the present-vs-absent group comparison) and the aligned daily
 * scatter points over its locked window — the same shape the server-side
 * scatter PNG and the web `ArticleCorrelationBlock` render from, so a receiving
 * peer can draw the identical scatter natively.
 */
export const feedStructuredArticleCorrelationBlockSchema = z
  .object({
    caption: z.string().optional().meta({ description: 'Optional caption' }),
    end: iso8601DateTimeSchema.meta({ description: "Block's locked window end (ISO 8601)" }),
    group_comparison: groupComparisonSchema
      .nullable()
      .meta({ description: 'Present-vs-absent group comparison; null when there is no split to compare' }),
    lag_days: z.number().int().optional().meta({ description: 'Days the outcome lags the trigger' }),
    n: z.number().int().meta({ description: 'Number of aligned day pairs' }),
    outcome: selectorSchema.meta({ description: 'Outcome dimension' }),
    pearson: z.number().nullable().meta({ description: 'Pearson correlation (-1..1)' }),
    pearson_p: z.number().nullable().meta({ description: 'Two-sided p-value for the Pearson correlation' }),
    series: z.array(alignedPointSchema).meta({ description: 'Aligned daily scatter points' }),
    spearman: z.number().nullable().meta({ description: 'Spearman rank correlation (-1..1)' }),
    start: iso8601DateTimeSchema.meta({ description: "Block's locked window start (ISO 8601)" }),
    trigger: selectorSchema.meta({ description: 'Trigger / predictor dimension' }),
    type: z.literal('correlation'),
  })
  .meta({ description: 'A resolved correlation block', id: 'FeedStructuredArticleCorrelationBlock' })

export type FeedStructuredArticleCorrelationBlock = z.infer<
  typeof feedStructuredArticleCorrelationBlockSchema
>

/** One resolved article content block (prose, chart, or correlation). */
export const feedStructuredArticleBlockSchema = z
  .discriminatedUnion('type', [
    feedStructuredArticleProseBlockSchema,
    feedStructuredArticleChartBlockSchema,
    feedStructuredArticleCorrelationBlockSchema,
  ])
  .meta({ description: 'A resolved article content block', id: 'FeedStructuredArticleBlock' })

export type FeedStructuredArticleBlock = z.infer<typeof feedStructuredArticleBlockSchema>

/**
 * The native structured representation of a shared *article* post: its title
 * and ordered blocks, each resolved to its locked window's live data. Served at
 * the same `GET /public/:username/feed/:postId` endpoint as an activity's
 * `FeedStructuredActivity` (see `FeedStructuredPost`) so a following Aurboda
 * instance renders a native inline article — real interactive charts and
 * scatters — instead of only the Mastodon-style prose + attached PNGs.
 */
export const feedStructuredArticleSchema = z
  .object({
    blocks: z
      .array(feedStructuredArticleBlockSchema)
      .meta({ description: 'Ordered, resolved content blocks' }),
    kind: z.literal('article').meta({ description: 'Discriminator: an article post' }),
    title: z.string().meta({ description: 'Article title' }),
  })
  .meta({ id: 'FeedStructuredArticle' })

export type FeedStructuredArticle = z.infer<typeof feedStructuredArticleSchema>

/**
 * Discriminated union of everything the structured-enrichment endpoint may
 * return: an activity share's typed scalars/series, or an article's title +
 * resolved blocks. `kind` tells a consuming peer (and the web timeline card)
 * which native render to use.
 *
 * A payload with NO `kind` is treated as an `activity` before discriminating, so
 * enrichment fetched from a peer running the *previous* release (which emitted
 * the un-tagged `FeedStructured` shape) still parses instead of silently dropping
 * the native chart during a rolling upgrade.
 */
export const feedStructuredPostSchema = z
  .preprocess(
    (v) => (v != null && typeof v === 'object' && !('kind' in v) ? { ...v, kind: 'activity' } : v),
    z.discriminatedUnion('kind', [feedStructuredActivitySchema, feedStructuredArticleSchema]),
  )
  .meta({ id: 'FeedStructuredPost' })

export type FeedStructuredPost = z.infer<typeof feedStructuredPostSchema>
