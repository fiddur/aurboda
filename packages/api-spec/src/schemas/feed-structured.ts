/**
 * Structured, machine-readable representation of a shared exercise, article or
 * challenge post — the data an Aurboda instance federates to *other Aurboda instances* so
 * they can render a native chart + typed stats instead of just the
 * Mastodon-style HTML.
 *
 * Imports only `common`, `correlations`, `dashboard`, `shared-exercises`, `social` and the two
 * challenge schema files (never `feed.ts`), so both the public-series endpoint and the timeline
 * entry can reuse `publicSeriesSampleSchema` without a circular import back through `feed.ts`;
 * none of those import `feed.ts` or this file, so no cycle is introduced.
 *
 * The origin instance serves this at `GET /public/:username/feed/:postId`
 * (see the backend feed-public router); a following instance fetches it on
 * ingest (see `timeline-enrich.ts`) and stores it on the timeline entry.
 *
 * The activity payload is the QuantPub `0.2` wire payload (`docs/fep/quantpub.md`
 * now describes `0.3`, whose relative offsets Aurboda does not emit yet),
 * so its field names and metric keys are lowerCamelCase by design: the one
 * sanctioned exception to the snake_case convention. Aurboda's internal metric
 * names stay snake_case and are converted at the boundary
 * (`apps/backend/src/services/activitypub/quant-wire.ts`).
 */
import { z } from 'zod'

import { quantChallengeDocumentSchema, quantStandingsSchema } from './challenges-quantpub.ts'
import { challengeResultSchema } from './challenges.ts'
import { iso8601DateTimeSchema } from './common.ts'
import {
  activityImpactTypeSchema,
  alignedPointSchema,
  groupComparisonSchema,
  impactBucketSchema,
  selectorSchema,
  windowEffectSchema,
} from './correlations.ts'
import { dashboardConfigSchema, periodKeySchema } from './dashboard.ts'
import { sharedExerciseDataSchema } from './shared-exercises.ts'
import { periodWindowSchema, widgetDataMapSchema } from './social.ts'

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
      .meta({ description: 'Machine key, lowerCamelCase, e.g. `heartRateAvg`, `distance`, `hrZoneMinutes`' }),
    unit: z.string().optional().meta({ description: 'Unit for the scalar form (e.g. `bpm`, `km`)' }),
    value: z
      .union([z.number(), z.record(z.string(), z.number())])
      .meta({ description: 'Scalar value, or a small keyed record (e.g. HR-zone minutes `{ z2: 22 }`)' }),
  })
  .meta({ id: 'FeedStructuredMetric' })

export type FeedStructuredMetric = z.infer<typeof feedStructuredMetricSchema>

export const feedStructuredSeriesSchema = z
  .object({
    bucket: z.string().meta({ description: 'Effective bucket granularity (e.g. `5s`)' }),
    metric: z.string().meta({ description: 'The metric key, lowerCamelCase, e.g. `heartRate`' }),
    samples: z
      .array(publicSeriesSampleSchema)
      .meta({ description: 'Bucketed samples over the activity window' }),
    unit: z.string().optional().meta({ description: 'Unit of the metric (e.g. `bpm`)' }),
  })
  .meta({ id: 'FeedStructuredSeries' })

export type FeedStructuredSeries = z.infer<typeof feedStructuredSeriesSchema>

/** One point of the shared GPS route: a timestamped WGS84 coordinate. */
export const feedStructuredRoutePointSchema = z
  .object({
    lat: z.number().meta({ description: 'Latitude (WGS84)' }),
    lon: z.number().meta({ description: 'Longitude (WGS84)' }),
    t: iso8601DateTimeSchema.meta({ description: 'Timestamp of the GPS fix (ISO 8601)' }),
  })
  .meta({ id: 'FeedStructuredRoutePoint' })

export type FeedStructuredRoutePoint = z.infer<typeof feedStructuredRoutePointSchema>

/** One set of a shared exercise, as logged: any of reps, weight (kg) and time (seconds). */
export const feedStructuredExerciseSetSchema = z
  .object({
    reps: z.number().optional().meta({ description: 'Repetitions' }),
    setType: z.string().optional().meta({
      description: 'Set type as logged, e.g. `warmup`, `drop_set`, `failure`; absent for a working set',
    }),
    time: z.number().optional().meta({ description: 'Time under load or hold, in seconds' }),
    weight: z.number().optional().meta({ description: 'Load in kg' }),
  })
  .meta({ id: 'FeedStructuredExerciseSet' })

export type FeedStructuredExerciseSet = z.infer<typeof feedStructuredExerciseSetSchema>

/**
 * One exercise of a shared session (QuantPub `quant:exercises` entry): its sets
 * in logged order, its measures over the working sets as metric objects
 * (`e1rm`, `volume`, `maxWeight`, …) and the record measures it set.
 */
export const feedStructuredExerciseSchema = z
  .object({
    metrics: z.array(feedStructuredMetricSchema).meta({
      description:
        'Measures over the working sets (warm-ups excluded), lowerCamelCase keys: `e1rm`, `volume`, `maxWeight`, `setCount`, `totalReps`, `maxReps`, `maxTime`',
    }),
    name: z.string().meta({ description: 'Exercise name, e.g. `Bench Press`' }),
    records: z.array(z.string()).optional().meta({
      description:
        "Measure keys (lowerCamelCase) on which this session beat every earlier session of the exercise in the author's history",
    }),
    sets: z.array(feedStructuredExerciseSetSchema).meta({ description: 'The sets, in logged order' }),
  })
  .meta({ id: 'FeedStructuredExercise' })

export type FeedStructuredExercise = z.infer<typeof feedStructuredExerciseSchema>

/**
 * The full structured payload for a shared exercise post. Only the metrics and
 * series the author actually shared are present. Rendered natively by a
 * following Aurboda instance (typed stats + an interactive series chart).
 */
export const feedStructuredSchema = z
  .object({
    activityType: z.string().meta({ description: 'Activity type, e.g. `exercise`' }),
    endTime: iso8601DateTimeSchema.optional().meta({ description: 'Activity end (ISO 8601), if any' }),
    exercises: z.array(feedStructuredExerciseSchema).optional().meta({
      description:
        "The session's exercises with their sets, measures and records, present only when the author shared them (`include_exercises`)",
    }),
    message: z
      .string()
      .optional()
      .meta({ description: "The author's personal message for the post (plain text), if any" }),
    metrics: z.array(feedStructuredMetricSchema).meta({ description: 'Shared scalar summaries' }),
    name: z.string().optional().meta({ description: 'Activity title, if any' }),
    route: z
      .array(feedStructuredRoutePointSchema)
      .optional()
      .meta({
        description:
          'Downsampled GPS route (time-ordered), present only when the author attached the route map ' +
          '(`include_map`) — the same track and audience as the route image, no extra geography. ' +
          'The timestamps do additionally expose position-at-time (and thus pace) to machine consumers.',
      }),
    series: z
      .array(feedStructuredSeriesSchema)
      .meta({ description: 'Shared high-resolution series (may be empty)' }),
    startTime: iso8601DateTimeSchema.meta({ description: 'Activity start (ISO 8601)' }),
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

export const feedStructuredArticleProseImageSchema = z
  .object({
    alt: z.string().meta({ description: "The picture's alt text, '' when the markdown gives none" }),
    url: z.string().url().meta({ description: "The picture's http(s) URL, as the markdown gives it" }),
  })
  .meta({
    description: "An http(s) picture embedded in a prose block's markdown",
    id: 'FeedStructuredArticleProseImage',
  })

export type FeedStructuredArticleProseImage = z.infer<typeof feedStructuredArticleProseImageSchema>

/**
 * A resolved prose block: the author's raw markdown, unmodified. Rendered
 * through the receiver's own sanitising markdown renderer (the same `#910`
 * boundary the owner's web app uses for its own posts) rather than pre-rendered
 * HTML, so a receiving Aurboda peer controls its own sanitisation rather than
 * trusting a remote instance's HTML. The block declares the pictures its
 * markdown embeds, and a receiver draws only a declared one inline.
 */
export const feedStructuredArticleProseBlockSchema = z
  .object({
    images: z.array(feedStructuredArticleProseImageSchema).optional().meta({
      description:
        'The http(s) pictures the markdown embeds, in document order. A receiver draws an inline picture only when its URL is declared here.',
    }),
    markdown: z.string().meta({ description: 'Raw authored markdown' }),
    type: z.literal('prose'),
  })
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

/**
 * A resolved challenge block: the embedded challenge's URL (where to join) and,
 * when the origin could read it, the challenge document and a standings
 * snapshot taken at resolve time — the same pair a challenge-share post carries.
 */
export const feedStructuredArticleChallengeBlockSchema = z
  .object({
    caption: z.string().optional().meta({ description: 'Optional caption' }),
    challenge: quantChallengeDocumentSchema.optional().meta({
      description: 'The challenge (QuantPub Challenges §3 document); absent when it could not be resolved',
    }),
    standings: quantStandingsSchema.optional().meta({
      description: 'Standings snapshot at resolve time (QuantPub Challenges §6); absent when not readable',
    }),
    type: z.literal('challenge'),
    url: z.string().meta({ description: 'Public challenge URL (where to view and join it)' }),
  })
  .meta({ description: 'A resolved challenge block', id: 'FeedStructuredArticleChallengeBlock' })

export type FeedStructuredArticleChallengeBlock = z.infer<typeof feedStructuredArticleChallengeBlockSchema>

/**
 * A resolved impact block: HRV, heart rate and stress around the sessions of one
 * activity over its locked window, with the paired before -> after effects — the
 * same numbers the impact PNG and the web impact chart draw from.
 */
export const feedStructuredArticleImpactBlockSchema = z
  .object({
    activity: z.string().meta({ description: 'The activity grouping key, matched exactly' }),
    activity_type: activityImpactTypeSchema,
    avg_duration_min: z.number().meta({ description: 'Average session duration in minutes' }),
    caption: z.string().optional().meta({ description: 'Optional caption' }),
    end: iso8601DateTimeSchema.meta({ description: "Block's locked window end (ISO 8601)" }),
    hr_effect: windowEffectSchema.meta({ description: 'Paired before -> after change of heart rate' }),
    hrv_effect: windowEffectSchema.meta({ description: 'Paired before -> after change of HRV' }),
    occurrences: z.number().int().meta({ description: 'Number of sessions in the window' }),
    start: iso8601DateTimeSchema.meta({ description: "Block's locked window start (ISO 8601)" }),
    stress_effect: windowEffectSchema.meta({ description: 'Paired before -> after change of stress level' }),
    timeline: z
      .array(impactBucketSchema)
      .meta({ description: 'All three metrics around the sessions, in time order' }),
    type: z.literal('impact'),
    window_minutes: z.number().int().meta({ description: 'Minutes before and after each session analysed' }),
  })
  .meta({ description: 'A resolved impact block', id: 'FeedStructuredArticleImpactBlock' })

export type FeedStructuredArticleImpactBlock = z.infer<typeof feedStructuredArticleImpactBlockSchema>

export const feedStructuredArticleBlockSchema = z
  .discriminatedUnion('type', [
    feedStructuredArticleProseBlockSchema,
    feedStructuredArticleChartBlockSchema,
    feedStructuredArticleCorrelationBlockSchema,
    feedStructuredArticleChallengeBlockSchema,
    feedStructuredArticleImpactBlockSchema,
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
 * The native structured representation of a shared *challenge* post: the
 * challenge (QuantPub Challenges §3 document as listed publicly) and a snapshot
 * of its standings (§6) taken when the origin resolved the payload. A peer
 * stores the payload at ingest, so its standings are only as fresh as that
 * fetch; `standings.asOf` says when.
 */
export const feedStructuredChallengeSchema = z
  .object({
    challenge: quantChallengeDocumentSchema.meta({
      description: 'The challenge (QuantPub Challenges §3 document, without joinToken/members)',
    }),
    kind: z.literal('challenge').meta({ description: 'Discriminator: a challenge-share post' }),
    message: z.string().optional().meta({
      description: "The author's note, raw markdown (rendered by the receiver's sanitiser)",
    }),
    result: challengeResultSchema
      .optional()
      .meta({ description: 'Frozen final standings, present only on the completion post' }),
    standings: quantStandingsSchema.optional().meta({
      description:
        'Standings snapshot at resolve time (QuantPub Challenges §6); absent when the host could not be read',
    }),
  })
  .meta({ id: 'FeedStructuredChallenge' })

export type FeedStructuredChallenge = z.infer<typeof feedStructuredChallengeSchema>

/**
 * The native structured representation of an *exercise* share post (#1398): one exercise's
 * progress as the public exercise page projects it, filtered by the author's opt-ins and resolved
 * when the origin serves the payload. Aurboda's own kind, so snake_case.
 */
export const feedStructuredExerciseShareSchema = z
  .object({
    activity_type: z.string().meta({ description: 'Activity type the exercise belongs to' }),
    activity_type_name: z.string().meta({ description: 'Display name of the activity type' }),
    data: sharedExerciseDataSchema.meta({
      description:
        'The exercise progress, filtered by the opt-ins: `records` empty unless records were shared, `trend`/`per_week` null unless the chart was, `history` the newest 5 sessions when sessions were shared, else empty',
    }),
    kind: z.literal('exercise').meta({ description: 'Discriminator: an exercise-share post' }),
    message: z.string().optional().meta({
      description: "The author's note, raw markdown (rendered by the receiver's sanitiser)",
    }),
    name: z.string().meta({ description: 'Exercise display name at share time' }),
    url: z
      .url({ protocol: /^https?$/ })
      .optional()
      .meta({
        description:
          "The exercise's public page (http or https), present only when it was published and linked at share time",
      }),
  })
  .meta({ id: 'FeedStructuredExerciseShare' })

export type FeedStructuredExerciseShare = z.infer<typeof feedStructuredExerciseShareSchema>

/**
 * The native structured representation of a *dashboard* share post (#1505): one finished period of
 * a period dashboard, drawn from the config snapshot stored at share time and resolved for that
 * period when the origin serves the payload. Aurboda's own kind, so snake_case.
 */
export const feedStructuredDashboardShareSchema = z
  .object({
    config: dashboardConfigSchema.meta({
      description:
        'The dashboard config as it was shared (quick links neutered), which the widgets are drawn from',
    }),
    kind: z.literal('dashboard').meta({ description: 'Discriminator: a dashboard-period share post' }),
    message: z.string().optional().meta({
      description: "The author's note, raw markdown (rendered by the receiver's sanitiser)",
    }),
    name: z.string().meta({ description: 'Dashboard name at share time' }),
    period: periodKeySchema.meta({ description: 'The shared finished period' }),
    url: z
      .url({ protocol: /^https?$/ })
      .optional()
      .meta({
        description:
          "The dashboard's public page (http or https), present only when it was published and linked at share time",
      }),
    widget_data: widgetDataMapSchema.meta({
      description: "Each widget's data for the period, keyed by widget id",
    }),
    window: periodWindowSchema.meta({ description: "The period's bounds in the author's timezone" }),
  })
  .meta({ id: 'FeedStructuredDashboardShare' })

export type FeedStructuredDashboardShare = z.infer<typeof feedStructuredDashboardShareSchema>

/**
 * Discriminated union of everything the structured-enrichment endpoint may
 * return: an activity share's typed scalars/series, an article's title +
 * resolved blocks, a challenge's document + standings snapshot, an exercise's
 * progress, or one period of a dashboard. `kind` tells a consuming peer (and the
 * web timeline card) which native render to use.
 *
 * A payload with NO `kind` is treated as an `activity` before discriminating, so
 * enrichment fetched from a peer running the *previous* release (which emitted
 * the un-tagged `FeedStructured` shape) still parses instead of silently dropping
 * the native chart during a rolling upgrade.
 */
export const feedStructuredPostSchema = z
  .preprocess(
    (v) => (v != null && typeof v === 'object' && !('kind' in v) ? { ...v, kind: 'activity' } : v),
    z.discriminatedUnion('kind', [
      feedStructuredActivitySchema,
      feedStructuredArticleSchema,
      feedStructuredChallengeSchema,
      feedStructuredExerciseShareSchema,
      feedStructuredDashboardShareSchema,
    ]),
  )
  .meta({ id: 'FeedStructuredPost' })

export type FeedStructuredPost = z.infer<typeof feedStructuredPostSchema>
