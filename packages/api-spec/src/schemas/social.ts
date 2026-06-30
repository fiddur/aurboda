/**
 * Social / sharing schemas.
 *
 * A *shared dashboard* is a named, independently-editable copy of a
 * `DashboardConfig` that a user publishes under their public namespace
 * (`<public-base>/u/<username>/<slug>`). Each share is either **public**
 * (listed on the user's public profile) or **unlisted** (reachable only via the
 * unguessable slug).
 *
 * The federation key is a user's full public base URL, not `user@host`, so an
 * instance may be served over http or under a sub-path of another site. Public
 * responses therefore carry absolute `profile_url` / `share_url` strings rather
 * than a bare host.
 */

import { z } from 'zod'

import { chartDataBucketSchema } from './chart-data.ts'
import { baseResponseSchema } from './common.ts'
import { dashboardConfigSchema } from './dashboard.ts'
import { goalProgressSchema } from './goals.ts'
import { trendHistoryPointSchema } from './trends.ts'

// =============================================================================
// Shared dashboard (owner-facing CRUD)
// =============================================================================

/** Display name for a shared dashboard. */
export const sharedDashboardNameSchema = z
  .string()
  .min(1)
  .max(120)
  .meta({ description: 'Display name for the shared dashboard' })

/**
 * A shared dashboard as seen by its owner (includes the editable config and the
 * absolute share URL).
 */
export const sharedDashboardSchema = z
  .object({
    config: dashboardConfigSchema.meta({ description: 'The dashboard configuration' }),
    created_at: z.string().meta({ description: 'Creation timestamp (ISO 8601)' }),
    id: z.string().uuid().meta({ description: 'Shared dashboard ID' }),
    is_public: z.boolean().meta({ description: 'If true, listed on the public profile' }),
    name: sharedDashboardNameSchema,
    share_url: z.string().meta({ description: 'Absolute URL of the shared dashboard' }),
    slug: z.string().meta({ description: 'URL-safe public slug' }),
    updated_at: z.string().meta({ description: 'Last update timestamp (ISO 8601)' }),
  })
  .meta({ id: 'SharedDashboard' })

export type SharedDashboard = z.infer<typeof sharedDashboardSchema>

/** Body for creating a shared dashboard. */
export const createSharedDashboardBodySchema = z
  .object({
    config: dashboardConfigSchema.meta({ description: 'The dashboard configuration to publish' }),
    is_public: z.boolean().default(false).meta({ description: 'Whether to list it on the public profile' }),
    name: sharedDashboardNameSchema,
  })
  .meta({ id: 'CreateSharedDashboardBody' })

export type CreateSharedDashboardBody = z.infer<typeof createSharedDashboardBodySchema>

/** Body for updating a shared dashboard (all fields optional). */
export const updateSharedDashboardBodySchema = z
  .object({
    config: dashboardConfigSchema.optional().meta({ description: 'Replacement dashboard configuration' }),
    is_public: z.boolean().optional().meta({ description: 'Whether to list it on the public profile' }),
    name: sharedDashboardNameSchema.optional(),
  })
  .meta({ id: 'UpdateSharedDashboardBody' })

export type UpdateSharedDashboardBody = z.infer<typeof updateSharedDashboardBodySchema>

/** Response wrapping a single shared dashboard. */
export const sharedDashboardResponseSchema = baseResponseSchema
  .extend({ dashboard: sharedDashboardSchema.optional() })
  .meta({ id: 'SharedDashboardResponse' })

export type SharedDashboardResponse = z.infer<typeof sharedDashboardResponseSchema>

/** Response wrapping the owner's list of shared dashboards. */
export const sharedDashboardsResponseSchema = baseResponseSchema
  .extend({ dashboards: z.array(sharedDashboardSchema) })
  .meta({ id: 'SharedDashboardsResponse' })

export type SharedDashboardsResponse = z.infer<typeof sharedDashboardsResponseSchema>

// =============================================================================
// Per-widget data payloads (public viewer — minimal projection)
// =============================================================================

/** A single point of a metric time series. */
export const metricSeriesPointSchema = z
  .object({
    time: z.string().meta({ description: 'Timestamp (ISO 8601)' }),
    value: z.number().meta({ description: 'Metric value' }),
  })
  .meta({ id: 'MetricSeriesPoint' })

export const metricCardDataSchema = z
  .object({
    count: z.number().nullable().meta({ description: 'Number of contributing days, if applicable' }),
    max: z.number().nullable().meta({ description: 'Period max, if applicable' }),
    trend_percent: z.number().nullable().meta({ description: 'Trend vs previous period (percent)' }),
    value: z.number().nullable().meta({ description: 'Headline value' }),
  })
  .meta({ id: 'MetricCardData' })

export const sparklineCardDataSchema = z
  .object({
    series: z.array(metricSeriesPointSchema).meta({ description: 'Sparkline time series' }),
    trend_percent: z.number().nullable().meta({ description: 'Trend vs previous period (percent)' }),
    value: z.number().nullable().meta({ description: 'Headline value' }),
  })
  .meta({ id: 'SparklineCardData' })

export const trendChartDataSchema = z
  .object({
    current_value: z.number().meta({ description: 'Current trend value' }),
    history: z.array(trendHistoryPointSchema).meta({ description: 'Historical trend values' }),
  })
  .meta({ id: 'TrendChartData' })

export const barChartDataSchema = z
  .object({
    buckets: z.array(chartDataBucketSchema).meta({ description: 'Bucketed chart values' }),
  })
  .meta({ id: 'BarChartData' })

export const correlationDataSchema = z
  .object({
    hrv_after30: z.number().nullable().meta({ description: 'Mean HRV 30 min after the activity' }),
    hrv_before30: z.number().nullable().meta({ description: 'Mean HRV 30 min before the activity' }),
    hrv_during: z.number().nullable().meta({ description: 'Mean HRV during the activity' }),
    occurrences: z.number().meta({ description: 'Number of occurrences analyzed' }),
  })
  .meta({ id: 'CorrelationData' })

export const activitySummaryItemSchema = z
  .object({
    activity_type: z.string().meta({ description: 'Activity type' }),
    end_time: z.string().optional().meta({ description: 'End time (ISO 8601)' }),
    start_time: z.string().meta({ description: 'Start time (ISO 8601)' }),
  })
  .meta({ id: 'ActivitySummaryItem' })

export const activitySummaryDataSchema = z
  .object({
    activities: z.array(activitySummaryItemSchema).meta({ description: 'Activities in the window' }),
  })
  .meta({ id: 'ActivitySummaryData' })

export const hrZoneDatumSchema = z
  .object({
    avg_seconds: z.number().nullable().meta({ description: 'Average seconds per day in this zone' }),
    metric: z.string().meta({ description: 'HR zone metric name (e.g. hr_zone_2_sec)' }),
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
  ])
  .meta({ id: 'WidgetData' })

export type WidgetData = z.infer<typeof widgetDataSchema>

/** Map of widget id → resolved widget data. */
export const widgetDataMapSchema = z
  .record(z.string(), widgetDataSchema)
  .meta({ id: 'WidgetDataMap' })

export type WidgetDataMap = z.infer<typeof widgetDataMapSchema>

// =============================================================================
// Public profile + public dashboard (unauthenticated viewer)
// =============================================================================

/** A public dashboard as listed on a user's public profile. */
export const publicDashboardListItemSchema = z
  .object({
    name: sharedDashboardNameSchema,
    share_url: z.string().meta({ description: 'Absolute URL of the shared dashboard' }),
    slug: z.string().meta({ description: 'URL-safe public slug' }),
  })
  .meta({ id: 'PublicDashboardListItem' })

export type PublicDashboardListItem = z.infer<typeof publicDashboardListItemSchema>

/**
 * Response for a user's public profile page. Payload fields are optional so
 * error/not-found responses (which carry only `success`/`error`) type-check.
 */
export const publicProfileResponseSchema = baseResponseSchema
  .extend({
    dashboards: z
      .array(publicDashboardListItemSchema)
      .optional()
      .meta({ description: 'Public shared dashboards' }),
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
    profile_url: z.string().optional().meta({ description: 'Absolute URL of the owner public profile' }),
    share_url: z.string().optional().meta({ description: 'Absolute URL of this shared dashboard' }),
    widget_data: widgetDataMapSchema.optional().meta({ description: 'Resolved data per widget id' }),
  })
  .meta({ id: 'PublicSharedDashboardResponse' })

export type PublicSharedDashboardResponse = z.infer<typeof publicSharedDashboardResponseSchema>
