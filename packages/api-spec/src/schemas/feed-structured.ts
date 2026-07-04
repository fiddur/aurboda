/**
 * Structured, machine-readable representation of a shared exercise post — the
 * data an Aurboda instance federates to *other Aurboda instances* so they can
 * render a native chart + typed stats instead of just the Mastodon-style HTML.
 *
 * A leaf module (imports only `common`) so both the public-series endpoint and
 * the timeline entry can reuse `publicSeriesSampleSchema` without a circular
 * import back through `feed.ts`.
 *
 * The origin instance serves this at `GET /public/:username/feed/:postId`
 * (see the backend feed-public router); a following instance fetches it on
 * ingest (see `timeline-enrich.ts`) and stores it on the timeline entry.
 */
import { z } from 'zod'

import { iso8601DateTimeSchema } from './common.ts'

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
