/**
 * Social / sharing schemas.
 *
 * A *shared dashboard* is a named, independently-editable copy of a
 * `DashboardConfig` that a user publishes under their public namespace
 * (`<public-base>/u/<username>/<slug>`). Each one is **private** (only its owner
 * sees it), **unlisted** (reachable only via the unguessable slug) or **public**
 * (listed on the user's public profile).
 *
 * The federation key is a user's full public base URL, not `user@host`, so an
 * instance may be served over http or under a sub-path of another site. Public
 * responses therefore carry absolute `profile_url` / `share_url` strings rather
 * than a bare host.
 */

import { z } from 'zod'

import { activityRecordSchema, activityTypeSummarySchema } from './activity-sessions.ts'
import { challengeSpecSchema } from './challenges.ts'
import { chartDataBreakdownBucketSchema, chartDataBucketSchema } from './chart-data.ts'
import { baseResponseSchema } from './common.ts'
import { dashboardConfigSchema, dashboardPresetSchema, periodKeySchema } from './dashboard.ts'
import { goalProgressSchema } from './goals.ts'
import { placesSummaryNightsSchema, placesSummarySchema } from './locations.ts'
import { publicExerciseListItemSchema } from './shared-exercises.ts'
import { latestSleepSchema } from './sleep.ts'
import { trendHistoryPointSchema } from './trends.ts'

export const dashboardVisibilitySchema = z.enum(['private', 'unlisted', 'public']).meta({
  description:
    'Who can see a dashboard: `private` (only you), `unlisted` (anyone with its link) or `public` (listed on your public profile).',
  id: 'DashboardVisibility',
})

export type DashboardVisibility = z.infer<typeof dashboardVisibilitySchema>

export const periodLockSchema = z.enum(['latest', 'fixed', 'browsable']).meta({
  description:
    'What visitors of a published period dashboard may see: `latest` (the most recently finished period, no stepping), `fixed` (the one period in period_fixed) or `browsable` (every finished period from period_from on). Ignored by a rolling dashboard, which must keep `latest`.',
  id: 'PeriodLock',
})

export type PeriodLock = z.infer<typeof periodLockSchema>

const periodFixedSchema = periodKeySchema.nullable().meta({
  description: 'With period_lock fixed: the one period visitors see (a key of the dashboard granularity)',
})

const periodFromSchema = periodKeySchema.nullable().meta({
  description:
    'With period_lock browsable: the earliest period visitors may step back to (a key of the dashboard granularity)',
})

export const periodLockFieldsShape = {
  period_fixed: periodFixedSchema.optional(),
  period_from: periodFromSchema.optional(),
  period_lock: periodLockSchema.optional(),
}

export const sharedDashboardNameSchema = z
  .string()
  .min(1)
  .max(120)
  .meta({ description: 'Display name for the shared dashboard' })

export const sharedDashboardSchema = z
  .object({
    config: dashboardConfigSchema.meta({ description: 'The dashboard configuration' }),
    created_at: z.string().meta({ description: 'Creation timestamp (ISO 8601)' }),
    id: z.string().uuid().meta({ description: 'Shared dashboard ID' }),
    name: sharedDashboardNameSchema,
    period_fixed: periodFixedSchema,
    period_from: periodFromSchema,
    period_lock: periodLockSchema,
    share_url: z.string().meta({ description: 'Absolute URL of the shared dashboard' }),
    slug: z.string().meta({ description: 'URL-safe public slug' }),
    updated_at: z.string().meta({ description: 'Last update timestamp (ISO 8601)' }),
    visibility: dashboardVisibilitySchema.meta({
      description:
        'private → only the owner; unlisted → reachable only by its link; public → listed on the public profile',
    }),
  })
  .meta({ id: 'SharedDashboard' })

export type SharedDashboard = z.infer<typeof sharedDashboardSchema>

export const createSharedDashboardBodySchema = z
  .object({
    config: dashboardConfigSchema
      .optional()
      .meta({ description: 'The dashboard configuration; give either this or preset' }),
    name: sharedDashboardNameSchema,
    period_fixed: periodFixedSchema.optional(),
    period_from: periodFromSchema.optional(),
    period_lock: periodLockSchema.default('latest'),
    preset: dashboardPresetSchema
      .optional()
      .meta({ description: 'Start from a preset instead of an explicit config; give either this or config' }),
    visibility: dashboardVisibilitySchema.default('private').meta({
      description:
        'private (default) → only the owner; unlisted → link-only; public → listed on the public profile',
    }),
  })
  .refine((body) => (body.config === undefined) !== (body.preset === undefined), {
    message: 'Give exactly one of config or preset',
  })
  .meta({ id: 'CreateSharedDashboardBody' })

export type CreateSharedDashboardBody = z.infer<typeof createSharedDashboardBodySchema>

export const updateSharedDashboardBodySchema = z
  .object({
    config: dashboardConfigSchema.optional().meta({ description: 'Replacement dashboard configuration' }),
    name: sharedDashboardNameSchema.optional(),
    ...periodLockFieldsShape,
    visibility: dashboardVisibilitySchema.optional().meta({
      description: 'private → only the owner; unlisted → link-only; public → listed on the public profile',
    }),
  })
  .meta({ id: 'UpdateSharedDashboardBody' })

export type UpdateSharedDashboardBody = z.infer<typeof updateSharedDashboardBodySchema>

export const sharedDashboardResponseSchema = baseResponseSchema
  .extend({ dashboard: sharedDashboardSchema.optional() })
  .meta({ id: 'SharedDashboardResponse' })

export type SharedDashboardResponse = z.infer<typeof sharedDashboardResponseSchema>

export const sharedDashboardsResponseSchema = baseResponseSchema
  .extend({ dashboards: z.array(sharedDashboardSchema) })
  .meta({ id: 'SharedDashboardsResponse' })

export type SharedDashboardsResponse = z.infer<typeof sharedDashboardsResponseSchema>

export const metricSeriesPointSchema = z
  .object({
    time: z.string().meta({ description: 'Timestamp (ISO 8601)' }),
    value: z.number().meta({ description: 'Metric value' }),
  })
  .meta({ id: 'MetricSeriesPoint' })

const previousValueSchema = z.number().nullable().optional().meta({
  description: 'On a period dashboard: the headline value of the previous calendar period',
})

const previousFigure = (description: string) =>
  z
    .number()
    .nullable()
    .optional()
    .meta({ description: `On a period dashboard: ${description} in the previous calendar period` })

export const metricCardDataSchema = z
  .object({
    count: z.number().nullable().meta({ description: 'Number of contributing days, if applicable' }),
    max: z.number().nullable().meta({ description: 'Period max, if applicable' }),
    previous_value: previousValueSchema,
    trend_percent: z.number().nullable().meta({
      description:
        'Trend vs previous period (percent); on a period dashboard, the change against previous_value',
    }),
    value: z.number().nullable().meta({ description: 'Headline value' }),
  })
  .meta({ id: 'MetricCardData' })

export const sparklineCardDataSchema = z
  .object({
    count: z.number().nullable().meta({ description: 'Number of contributing days, if applicable' }),
    previous_value: previousValueSchema,
    series: z.array(metricSeriesPointSchema).meta({ description: 'Sparkline time series' }),
    trend_percent: z.number().nullable().meta({
      description:
        'Trend vs previous period (percent); on a period dashboard, the change against previous_value',
    }),
    value: z.number().nullable().meta({ description: 'Headline value' }),
  })
  .meta({ id: 'SparklineCardData' })

export const trendChartDataSchema = z
  .object({
    breakdown_histories: z
      .record(z.string(), z.array(trendHistoryPointSchema))
      .optional()
      .meta({ description: 'Per-series trend histories keyed by series name, when broken down' }),
    breakdown_series: z
      .array(z.string())
      .optional()
      .meta({ description: 'Distinct series names when broken down' }),
    current_value: z.number().meta({ description: 'Current trend value' }),
    history: z.array(trendHistoryPointSchema).meta({ description: 'Historical trend values' }),
  })
  .meta({ id: 'TrendChartData' })

export const barChartDataSchema = z
  .object({
    breakdown_buckets: z
      .array(chartDataBreakdownBucketSchema)
      .optional()
      .meta({ description: 'Bucketed values per series, when broken down' }),
    breakdown_series: z
      .array(z.string())
      .optional()
      .meta({ description: 'Distinct series names when broken down' }),
    buckets: z.array(chartDataBucketSchema).meta({ description: 'Bucketed chart values' }),
  })
  .meta({ id: 'BarChartData' })

export const combinedChartLayerDataSchema = z
  .discriminatedUnion('kind', [
    z.object({ data: barChartDataSchema.nullable(), kind: z.literal('bars') }),
    z.object({ data: trendChartDataSchema.nullable(), kind: z.literal('trend') }),
  ])
  .meta({
    description: "One layer's data; null when the layer could not be resolved",
    id: 'CombinedChartLayerData',
  })

export const combinedChartDataSchema = z
  .object({
    layers: z.array(combinedChartLayerDataSchema).meta({ description: "In the config's layer order" }),
  })
  .meta({ id: 'CombinedChartData' })

export const recordCardDataSchema = z
  .object({
    record: activityRecordSchema
      .nullable()
      .meta({ description: 'The record, or null when there is none yet' }),
  })
  .meta({ id: 'RecordCardData' })

export const activityTypeCardDataSchema = activityTypeSummarySchema
  .extend({
    previous_count: previousFigure('the number of sessions'),
    previous_distance_km: previousFigure('the total distance (km)'),
    previous_sleep_avg_minutes: previousFigure('the average night (minutes)'),
    previous_total_minutes: previousFigure('the total duration (minutes)'),
  })
  .meta({ id: 'ActivityTypeCardData' })

export const topListCardItemSchema = z
  .object({
    count: z.number().meta({ description: 'In the card unit: plays, hours (one decimal) or visits' }),
    name: z.string(),
  })
  .meta({ id: 'TopListCardItem' })

export const topListCardDataSchema = z
  .object({
    distinct: z.number().int().nullable().meta({
      description: 'Distinct artists, albums, tracks, apps or places in the window',
    }),
    items: z.array(topListCardItemSchema).meta({ description: 'The top entries, highest count first' }),
    per_day: z.number().nullable().meta({
      description: 'Hours per day over the window for screen time; null for the other sources',
    }),
    previous_total: previousFigure('the total'),
    total: z.number().meta({ description: 'Plays, hours or visits over the window' }),
    unit: z.enum(['plays', 'hours', 'visits']).meta({ description: 'Unit of total and the item counts' }),
  })
  .meta({ id: 'TopListCardData' })

export const placesCardDataSchema = placesSummarySchema
  .extend({
    previous_distinct_places: previousFigure('the number of distinct places'),
    previous_nights_away: previousFigure('the nights away'),
    previous_nights_by_place: z.array(placesSummaryNightsSchema).optional().meta({
      description: 'On a period dashboard: the nights per named place in the previous calendar period',
    }),
    previous_nights_elsewhere: previousFigure('the nights elsewhere'),
    previous_visits: previousFigure('the number of visits'),
  })
  .meta({ id: 'PlacesCardData' })

export const correlationDataSchema = z
  .object({
    hrv_after30: z.number().nullable().meta({ description: 'Mean HRV 30 min after the activity' }),
    hrv_before30: z.number().nullable().meta({ description: 'Mean HRV 30 min before the activity' }),
    hrv_during: z.number().nullable().meta({ description: 'Mean HRV during the activity' }),
    occurrences: z.number().meta({ description: 'Number of occurrences analyzed' }),
  })
  .meta({ id: 'CorrelationData' })

/**
 * Aggregated activity stats — exactly the figures the ActivitySummary widget
 * renders. Each category is null when its visibility toggle is off, so a public
 * viewer never receives data for a hidden category, nor the raw activity list.
 */
export const activitySummaryExerciseSchema = z
  .object({
    count: z.number().meta({ description: 'Number of workout sessions' }),
    previous_count: previousFigure('the number of workout sessions'),
    previous_total_minutes: previousFigure('the total workout minutes'),
    total_minutes: z.number().meta({ description: 'Total workout minutes' }),
  })
  .meta({ id: 'ActivitySummaryExercise' })

export const activitySummarySleepSchema = z
  .object({
    avg_hours: z.number().nullable().meta({ description: 'Average sleep hours per night' }),
    count: z.number().meta({ description: 'Number of nights tracked' }),
    previous_avg_hours: previousFigure('the average sleep hours per night'),
    previous_count: previousFigure('the number of nights tracked'),
  })
  .meta({ id: 'ActivitySummarySleep' })

export const activitySummaryMeditationSchema = z
  .object({
    count: z.number().meta({ description: 'Number of meditation sessions' }),
    previous_count: previousFigure('the number of meditation sessions'),
    previous_total_minutes: previousFigure('the total meditation minutes'),
    total_minutes: z.number().meta({ description: 'Total meditation minutes' }),
  })
  .meta({ id: 'ActivitySummaryMeditation' })

export const activitySummaryDataSchema = z
  .object({
    exercise: activitySummaryExerciseSchema
      .nullable()
      .meta({ description: 'Workout aggregates, or null when hidden' }),
    meditation: activitySummaryMeditationSchema
      .nullable()
      .meta({ description: 'Meditation aggregates, or null when hidden' }),
    sleep: activitySummarySleepSchema
      .nullable()
      .meta({ description: 'Sleep aggregates, or null when hidden' }),
  })
  .meta({ id: 'ActivitySummaryData' })

export const hrZoneDatumSchema = z
  .object({
    avg_seconds: z.number().nullable().meta({ description: 'Average seconds per day in this zone' }),
    metric: z.string().meta({ description: 'HR zone metric name (e.g. hr_zone_2_sec)' }),
    previous_avg_seconds: previousFigure('the average seconds per day in this zone'),
  })
  .meta({ id: 'HrZoneDatum' })

export const hrZonesDataSchema = z
  .object({
    hr_zone_start: z
      .array(z.number())
      .nullable()
      .meta({ description: 'Effective HR zone start thresholds (bpm)' }),
    zones: z.array(hrZoneDatumSchema).meta({ description: 'Per-zone average time' }),
  })
  .meta({ id: 'HrZonesData' })

export const goalProgressDataSchema = z
  .object({
    goals: z.array(goalProgressSchema).meta({ description: 'Goal progress entries' }),
  })
  .meta({ id: 'GoalProgressData' })

/**
 * Resolved data for one widget, discriminated by widget type. Built server-side
 * from the stored widget config only — never from viewer-supplied params. A
 * `null` data field means the widget renders without data (e.g. quick links, or
 * a widget whose data could not be resolved).
 */
export const widgetDataSchema = z
  .discriminatedUnion('type', [
    z.object({ data: metricCardDataSchema.nullable(), type: z.literal('metric_card') }),
    z.object({ data: sparklineCardDataSchema.nullable(), type: z.literal('sparkline_card') }),
    z.object({ data: trendChartDataSchema.nullable(), type: z.literal('trend_chart') }),
    z.object({ data: barChartDataSchema.nullable(), type: z.literal('bar_chart') }),
    z.object({ data: correlationDataSchema.nullable(), type: z.literal('correlation') }),
    z.object({ data: activitySummaryDataSchema.nullable(), type: z.literal('activity_summary') }),
    z.object({ data: z.null(), type: z.literal('quick_link') }),
    z.object({ data: hrZonesDataSchema.nullable(), type: z.literal('hr_zones') }),
    z.object({ data: goalProgressDataSchema.nullable(), type: z.literal('goal_progress') }),
    z.object({ data: latestSleepSchema.nullable(), type: z.literal('last_sleep') }),
    z.object({ data: combinedChartDataSchema.nullable(), type: z.literal('combined_chart') }),
    z.object({ data: recordCardDataSchema.nullable(), type: z.literal('record_card') }),
    z.object({ data: activityTypeCardDataSchema.nullable(), type: z.literal('activity_type_card') }),
    z.object({ data: topListCardDataSchema.nullable(), type: z.literal('top_list_card') }),
    z.object({ data: placesCardDataSchema.nullable(), type: z.literal('places_card') }),
  ])
  .meta({ id: 'WidgetData' })

export type WidgetData = z.infer<typeof widgetDataSchema>

export type MetricCardData = z.infer<typeof metricCardDataSchema>
export type SparklineCardData = z.infer<typeof sparklineCardDataSchema>
export type TrendChartData = z.infer<typeof trendChartDataSchema>
export type BarChartData = z.infer<typeof barChartDataSchema>
export type CorrelationData = z.infer<typeof correlationDataSchema>
export type ActivitySummaryData = z.infer<typeof activitySummaryDataSchema>
export type HrZonesData = z.infer<typeof hrZonesDataSchema>
export type GoalProgressData = z.infer<typeof goalProgressDataSchema>
export type LastSleepData = z.infer<typeof latestSleepSchema>
export type CombinedChartLayerData = z.infer<typeof combinedChartLayerDataSchema>
export type CombinedChartData = z.infer<typeof combinedChartDataSchema>
export type RecordCardData = z.infer<typeof recordCardDataSchema>
export type ActivityTypeCardData = z.infer<typeof activityTypeCardDataSchema>
export type TopListCardData = z.infer<typeof topListCardDataSchema>
export type PlacesCardData = z.infer<typeof placesCardDataSchema>

export const widgetDataMapSchema = z.record(z.string(), widgetDataSchema).meta({ id: 'WidgetDataMap' })

export type WidgetDataMap = z.infer<typeof widgetDataMapSchema>

export const periodWindowSchema = z
  .object({
    end: z.string().meta({ description: 'End instant, exclusive (ISO 8601)' }),
    start: z.string().meta({ description: 'Start instant, inclusive (ISO 8601)' }),
  })
  .meta({ description: "A calendar period's bounds in the owner's timezone", id: 'PeriodWindow' })

export type PeriodWindow = z.infer<typeof periodWindowSchema>

const periodFields = {
  period: periodKeySchema
    .nullable()
    .optional()
    .meta({ description: 'The calendar period shown; null for a rolling dashboard' }),
  window: periodWindowSchema
    .nullable()
    .optional()
    .meta({ description: "The shown period's bounds; null for a rolling dashboard" }),
}

export const dashboardDataResponseSchema = baseResponseSchema
  .extend({
    ...periodFields,
    widget_data: widgetDataMapSchema.optional().meta({ description: 'Resolved data per widget id' }),
  })
  .meta({ id: 'DashboardDataResponse' })

export type DashboardDataResponse = z.infer<typeof dashboardDataResponseSchema>

export const publicDashboardListItemSchema = z
  .object({
    name: sharedDashboardNameSchema,
    share_url: z.string().meta({ description: 'Absolute URL of the shared dashboard' }),
    slug: z.string().meta({ description: 'URL-safe public slug' }),
  })
  .meta({ id: 'PublicDashboardListItem' })

export type PublicDashboardListItem = z.infer<typeof publicDashboardListItemSchema>

/**
 * A public challenge as listed on a user's public profile. The window and spec
 * let a reader (the challenge discovery of a following instance, a profile page)
 * tell an ongoing challenge from an ended one without fetching each; they are
 * optional only because instances from before 2026-09 list name + link alone.
 */
export const publicChallengeListItemSchema = publicDashboardListItemSchema
  .extend({
    end_ts: z.string().optional().meta({ description: 'End instant, exclusive (ISO 8601)' }),
    spec: challengeSpecSchema.optional(),
    start_ts: z.string().optional().meta({ description: 'Start instant, inclusive (ISO 8601)' }),
    timezone: z.string().optional().meta({ description: 'IANA timezone the date range was chosen in' }),
  })
  .meta({ id: 'PublicChallengeListItem' })

export type PublicChallengeListItem = z.infer<typeof publicChallengeListItemSchema>

/**
 * Response for a user's public profile page. Payload fields are optional so
 * error/not-found responses (which carry only `success`/`error`) type-check.
 */
export const publicProfileResponseSchema = baseResponseSchema
  .extend({
    challenges: z
      .array(publicChallengeListItemSchema)
      .optional()
      .meta({ description: 'Public challenges hosted by this user' }),
    dashboards: z
      .array(publicDashboardListItemSchema)
      .optional()
      .meta({ description: 'Public shared dashboards' }),
    display_name: z
      .string()
      .nullable()
      .optional()
      .meta({ description: 'The name the user shows on their profile and posts; null when none is set' }),
    exercises: z
      .array(publicExerciseListItemSchema)
      .optional()
      .meta({ description: 'Public shared exercises' }),
    has_articles: z
      .boolean()
      .optional()
      .meta({ description: 'Whether the user has any public articles (drives the Blog link)' }),
    profile_url: z.string().optional().meta({ description: 'Absolute URL of the public profile' }),
    username: z.string().optional().meta({ description: 'The profile username' }),
  })
  .meta({ id: 'PublicProfileResponse' })

export type PublicProfileResponse = z.infer<typeof publicProfileResponseSchema>

/**
 * Response for viewing a single public/unlisted shared dashboard. Payload
 * fields are optional so error/not-found responses type-check.
 */
export const publicSharedDashboardResponseSchema = baseResponseSchema
  .extend({
    config: dashboardConfigSchema.optional().meta({ description: 'Sanitized dashboard configuration' }),
    name: sharedDashboardNameSchema.optional(),
    ...periodFields,
    period_from: periodKeySchema
      .optional()
      .meta({ description: 'With period_lock browsable: the earliest period a visitor may ask for' }),
    period_lock: periodLockSchema
      .optional()
      .meta({ description: 'On a period dashboard: whether a visitor may step between periods (browsable)' }),
    profile_url: z.string().optional().meta({ description: 'Absolute URL of the owner public profile' }),
    share_url: z.string().optional().meta({ description: 'Absolute URL of this shared dashboard' }),
    type: z.literal('dashboard').optional().meta({ description: 'Resource type discriminator' }),
    widget_data: widgetDataMapSchema.optional().meta({ description: 'Resolved data per widget id' }),
  })
  .meta({ id: 'PublicSharedDashboardResponse' })

export type PublicSharedDashboardResponse = z.infer<typeof publicSharedDashboardResponseSchema>

export const publicDashboardQuerySchema = z
  .object({
    period: periodKeySchema.optional().meta({
      description:
        'The finished period to show; honoured only when the dashboard is browsable, from its period_from on',
    }),
  })
  .meta({ id: 'PublicDashboardQuery' })

export type PublicDashboardQuery = z.infer<typeof publicDashboardQuerySchema>
