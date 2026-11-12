import { z } from 'zod'

import { activityMeasureSchema, recordMeasures } from './activity-measures.ts'
import { baseResponseSchema, dataFieldPathSchema } from './common.ts'
import { mediaPlaySourceSchema } from './media.ts'
import { trendMeasureShape, trendMissingDaysSchema } from './trends.ts'

export const builtinDashboardMetrics = [
  'hrv_7day',
  'hrv_30day',
  'rhr_7day',
  'rhr_30day',
  'sleep_score',
  'readiness_score',
  'resilience_score',
  'steps',
  'zone2_weekly',
  'weight',
  'body_fat',
  'hrv_sleep',
  'heart_rate',
  'hrv_rmssd',
  'resting_heart_rate',
  'hr_zone_2_sec',
  'spo2',
  'vo2_max',
  'calories_active',
  'calories_total',
  'distance',
  'floors_climbed',
  'cardiovascular_age',
  'stress_level',
  'body_battery',
  'training_readiness',
  'intensity_minutes',
  'respiratory_rate',
] as const

export type BuiltinDashboardMetric = (typeof builtinDashboardMetrics)[number]

/**
 * Days a metric card summarises. HR zone metrics come back from the period
 * summary as one total for the whole window rather than a daily average, so
 * `zone2_weekly` asks for exactly the week it shows.
 */
export const metricCardLookbackDays = (metric: string): number => (metric === 'zone2_weekly' ? 7 : 30)

/** Any non-empty string, so custom metrics work too. */
export const dashboardMetricSchema = z.string().min(1).meta({
  description: 'Metric name (built-in or custom)',
})

export type DashboardMetric = z.infer<typeof dashboardMetricSchema>

export const metricCardConfigSchema = z
  .object({
    metric: dashboardMetricSchema.meta({ description: 'The metric to display' }),
    subtitle: z.string().optional().meta({ description: 'Optional subtitle text' }),
    title: z.string().min(1).meta({ description: 'Display title for the metric' }),
    trend_inverse: z.boolean().optional().meta({ description: 'If true, lower values are better' }),
    unit: z.string().optional().meta({ description: 'Unit label (e.g., "ms", "bpm")' }),
  })
  .meta({ id: 'MetricCardConfig' })

export type MetricCardConfig = z.infer<typeof metricCardConfigSchema>

export const sparklineCardConfigSchema = z
  .object({
    color: z.string().optional().meta({ description: 'Chart line color (CSS color)' }),
    lookback_days: z
      .number()
      .int()
      .positive()
      .optional()
      .meta({ description: 'Days of data to show in sparkline (default: 30)' }),
    metric: dashboardMetricSchema.meta({ description: 'The metric to display' }),
    title: z.string().optional().meta({ description: 'Display title for the metric' }),
  })
  .meta({ id: 'SparklineCardConfig' })

export type SparklineCardConfig = z.infer<typeof sparklineCardConfigSchema>

/** The earliest `since` a chart accepts: older dates only make the trend query walk decades of empty days. */
export const chartSinceMin = '1970-01-01'

const chartSinceSchema = z.iso
  .date()
  .refine((since) => since >= chartSinceMin, { message: `since must be ${chartSinceMin} or later` })
  .optional()
  .meta({
    description:
      "Fixed start date (YYYY-MM-DD, the owner's calendar day, 1970-01-01 or later): the chart covers this date up to today; a later date than today starts today. When set it wins over lookback_days",
  })

export const trendChartConfigSchema = z
  .object({
    aggregation: z.enum(['count', 'sum', 'mean']).optional().meta({ description: 'Aggregation method' }),
    breakdown_fields: z
      .array(z.string())
      .optional()
      .meta({ description: 'Categorical data fields to break the series down by' }),
    masked_breakdown_fields: z.array(z.string()).optional().meta({
      description:
        'Subset of breakdown_fields whose values are masked (shown as A, B, C…) to public viewers of a shared board',
    }),
    display_period: z
      .enum(['daily', 'weekly', 'monthly'])
      .optional()
      .meta({ description: 'Display period for rate' }),
    half_life_days: z.number().int().positive().optional().meta({ description: 'EMA half-life in days' }),
    lookback_days: z.number().int().positive().optional().meta({ description: 'Days of data to analyze' }),
    missing_days: trendMissingDaysSchema.optional(),
    pattern: z.string().min(1).meta({ description: 'Tag pattern (regex) or metric name' }),
    since: chartSinceSchema,
    source_type: z.enum(['tag', 'metric', 'activity_type']).meta({ description: 'Data source type' }),
    tag_definition_id: z
      .string()
      .uuid()
      .optional()
      .meta({ description: 'Tag definition ID (alternative to pattern)' }),
    title: z.string().optional().meta({ description: 'Chart title' }),
    ...trendMeasureShape,
  })
  .meta({ id: 'TrendChartConfig' })

export const barChartConfigSchema = z
  .object({
    aggregation: z
      .enum(['count', 'sum', 'mean', 'max'])
      .optional()
      .meta({ description: 'Aggregation method' }),
    filter_field: dataFieldPathSchema
      .optional()
      .meta({ description: 'With measure: item path whose items are measured (sets.exercise)' }),
    filter_value: z.string().optional().meta({ description: 'With filter_field: the item value to keep' }),
    measure: activityMeasureSchema.optional().meta({
      description: 'For activity_type sources: chart this list-item measure instead of duration or count',
    }),
    breakdown_fields: z
      .array(z.string())
      .optional()
      .meta({ description: 'Categorical data fields to break the series down by' }),
    masked_breakdown_fields: z.array(z.string()).optional().meta({
      description:
        'Subset of breakdown_fields whose values are masked (shown as A, B, C…) to public viewers of a shared board',
    }),
    bucket_size: z
      .enum(['1m', '5m', '15m', '1h', '1d', '1w', '1M'])
      .meta({ description: 'Time bucket size' }),
    lookback_days: z.number().int().positive().meta({ description: 'Days of data to display' }),
    pattern: z.string().min(1).optional().meta({ description: 'Tag pattern (regex) or metric name' }),
    since: chartSinceSchema,
    source_type: z
      .enum(['tag', 'metric', 'productivity_category', 'activity_type'])
      .meta({ description: 'Data source type' }),
    tag_definition_id: z
      .string()
      .uuid()
      .optional()
      .meta({ description: 'Tag definition ID (alternative to pattern)' }),
    title: z.string().optional().meta({ description: 'Chart title' }),
  })
  .meta({ id: 'BarChartConfig' })

export type BarChartConfig = z.infer<typeof barChartConfigSchema>

export type TrendChartConfig = z.infer<typeof trendChartConfigSchema>

const widgetOnlyFields = {
  breakdown_fields: true,
  lookback_days: true,
  masked_breakdown_fields: true,
  since: true,
  title: true,
} as const

export const combinedChartBarsLayerSchema = barChartConfigSchema
  .omit(widgetOnlyFields)
  .extend({ kind: z.literal('bars') })
  .meta({ description: 'Bars of a bar chart source', id: 'CombinedChartBarsLayer' })

export const combinedChartTrendLayerSchema = trendChartConfigSchema
  .omit(widgetOnlyFields)
  .extend({
    color: z.string().optional().meta({ description: 'Line color (CSS color)' }),
    kind: z.literal('trend'),
  })
  .meta({ description: 'A trend line of a trend chart source', id: 'CombinedChartTrendLayer' })

export const combinedChartLayerSchema = z
  .discriminatedUnion('kind', [combinedChartBarsLayerSchema, combinedChartTrendLayerSchema])
  .meta({
    description: 'One layer of a combined chart: a chart source without its own title, range or breakdown',
    id: 'CombinedChartLayer',
  })

export type CombinedChartLayer = z.infer<typeof combinedChartLayerSchema>

export const combinedChartConfigSchema = z
  .object({
    layers: z.array(combinedChartLayerSchema).min(1).max(4).meta({
      description:
        'The layers, drawn in this order over one time axis. For now exactly one bars layer and one to three trend layers; the rule may be relaxed as more kinds are supported',
    }),
    lookback_days: z
      .number()
      .int()
      .positive()
      .meta({ description: 'Days of data shown, shared by every layer' }),
    title: z.string().optional().meta({ description: 'Chart title' }),
  })
  .refine(
    (c) => {
      const bars = c.layers.filter((l) => l.kind === 'bars').length
      const trends = c.layers.filter((l) => l.kind === 'trend').length
      return bars === 1 && trends >= 1 && trends <= 3
    },
    { message: 'layers must be exactly one bars layer and one to three trend layers', path: ['layers'] },
  )
  .meta({
    description: 'Bars and trend lines drawn together over one time axis',
    id: 'CombinedChartConfig',
  })

export type CombinedChartConfig = z.infer<typeof combinedChartConfigSchema>

export const recordCardConfigSchema = z
  .object({
    filter_field: dataFieldPathSchema
      .optional()
      .meta({ description: 'With filter_value: item path whose items are measured (sets.exercise)' }),
    filter_value: z.string().optional().meta({ description: 'With filter_field: the item value to keep' }),
    lookback_days: z
      .number()
      .int()
      .positive()
      .optional()
      .meta({ description: 'Only sessions in the last this many days; all time when absent' }),
    measure: z.enum(recordMeasures).meta({ description: 'The record measure shown' }),
    pattern: z.string().min(1).meta({ description: 'Activity type name' }),
    source_type: z.enum(['activity_type']).meta({ description: 'Data source type' }),
    title: z.string().optional().meta({ description: 'Card title' }),
  })
  .refine((c) => (c.filter_field === undefined) === (c.filter_value === undefined), {
    message: 'filter_field and filter_value must be given together',
    path: ['filter_value'],
  })
  .meta({
    description: 'The best value of an activity measure, with the date and the set that reached it',
    id: 'RecordCardConfig',
  })

export type RecordCardConfig = z.infer<typeof recordCardConfigSchema>

export const activityTypeCardConfigSchema = z
  .object({
    filter_field: dataFieldPathSchema.optional().meta({
      description: 'With filter_value: data field or item path (sets.exercise) the sessions must match',
    }),
    filter_value: z.string().optional().meta({ description: 'With filter_field: the value to keep' }),
    lookback_days: z.number().int().positive().optional().meta({
      description: 'Days rolled up on a rolling dashboard (default: 30); a period dashboard uses its period',
    }),
    pattern: z.string().min(1).meta({ description: 'Activity type name; its subtypes are included' }),
    speed_display: z.enum(['pace', 'speed']).optional().meta({
      description:
        'With distance: pace (min/km) or speed (km/h); default pace for running, walking and hiking types, else speed',
    }),
    title: z.string().optional().meta({ description: 'Card title (default: the activity type name)' }),
  })
  .refine((c) => (c.filter_field === undefined) === (c.filter_value === undefined), {
    message: 'filter_field and filter_value must be given together',
    path: ['filter_value'],
  })
  .meta({
    description:
      'Roll-up of one activity type: sessions, time, distance and pace or speed; for sleep the average and best night and the stages',
    id: 'ActivityTypeCardConfig',
  })

export type ActivityTypeCardConfig = z.infer<typeof activityTypeCardConfigSchema>

export const topListSourceSchema = z
  .enum(['media_artist', 'media_album', 'media_track', 'screentime_app', 'place'])
  .meta({
    description:
      'What a top list ranks: music plays by artist, album or track, screen time by app, or visits by place',
    id: 'TopListSource',
  })

export type TopListSource = z.infer<typeof topListSourceSchema>

export const topListCardConfigSchema = z
  .object({
    limit: z.number().int().min(1).max(10).default(3).meta({ description: 'Entries listed (default 3)' }),
    lookback_days: z.number().int().positive().optional().meta({
      description: 'Days covered on a rolling dashboard (default: 30); a period dashboard uses its period',
    }),
    media_source: mediaPlaySourceSchema
      .optional()
      .meta({ description: 'With a media_* source: only plays from lastfm or mpris; all plays when absent' }),
    source: topListSourceSchema,
    title: z
      .string()
      .optional()
      .meta({ description: 'Card title (default: "Top artists", "Top apps", ...)' }),
  })
  .meta({
    description:
      "One source's total over the window with the change against the previous period, then its top entries",
    id: 'TopListCardConfig',
  })

export type TopListCardConfig = z.infer<typeof topListCardConfigSchema>

export const placesCardConfigSchema = z
  .object({
    home_location: z.string().min(1).optional().meta({
      description: 'The place that counts as home, matched case-insensitively (default "Home")',
    }),
    lookback_days: z.number().int().positive().optional().meta({
      description: 'Days covered on a rolling dashboard (default: 30); a period dashboard uses its period',
    }),
    title: z.string().optional().meta({ description: 'Card title (default: "Places")' }),
  })
  .meta({
    description: 'Nights at home and away, distinct places and the most visited places',
    id: 'PlacesCardConfig',
  })

export type PlacesCardConfig = z.infer<typeof placesCardConfigSchema>

export const correlationConfigSchema = z
  .object({
    activity: z.string().min(1).meta({ description: 'Activity or tag to analyze' }),
    activity_type: z
      .enum(['productivity_category', 'productivity_app', 'location', 'tag', 'activity_type'])
      .meta({ description: 'Type of activity' }),
    period_days: z.number().int().positive().optional().meta({ description: 'Days of data to analyze' }),
    title: z.string().optional().meta({ description: 'Widget title' }),
    window_minutes: z
      .number()
      .int()
      .positive()
      .optional()
      .meta({ description: 'Minutes before/after to analyze' }),
  })
  .meta({ id: 'CorrelationConfig' })

export type CorrelationConfig = z.infer<typeof correlationConfigSchema>

export const activitySummaryConfigSchema = z
  .object({
    lookback_days: z
      .number()
      .int()
      .positive()
      .optional()
      .meta({ description: 'Days of activities to summarize (default: 7)' }),
    show_meditation: z.boolean().optional().meta({ description: 'Show meditation count (default: true)' }),
    show_sleep: z.boolean().optional().meta({ description: 'Show average sleep hours (default: true)' }),
    show_workouts: z
      .boolean()
      .optional()
      .meta({ description: 'Show workout count and duration (default: true)' }),
  })
  .meta({ id: 'ActivitySummaryConfig' })

export type ActivitySummaryConfig = z.infer<typeof activitySummaryConfigSchema>

export const quickLinkConfigSchema = z
  .object({
    href: z.string().min(1).meta({ description: 'Target URL path' }),
    icon: z.string().optional().meta({
      description:
        'Icon name (e.g. timeline, sleep, correlations, goals, places, trends, settings, hr-zones)',
    }),
    label: z.string().min(1).meta({ description: 'Link text' }),
  })
  .meta({ id: 'QuickLinkConfig' })

export type QuickLinkConfig = z.infer<typeof quickLinkConfigSchema>

export const hrZonesConfigSchema = z
  .object({
    lookback_days: z
      .number()
      .int()
      .positive()
      .optional()
      .meta({ description: 'Days of data to show (default: 7)' }),
    show_targets: z.boolean().optional().meta({ description: 'Show target percentages (default: true)' }),
  })
  .meta({ id: 'HrZonesConfig' })

export type HrZonesConfig = z.infer<typeof hrZonesConfigSchema>

export const goalProgressConfigSchema = z
  .object({
    compact: z.boolean().optional().meta({ description: 'Hide losing-tomorrow info (default: false)' }),
  })
  .meta({ id: 'GoalProgressConfig' })

export type GoalProgressConfig = z.infer<typeof goalProgressConfigSchema>

export const lastSleepConfigSchema = z
  .object({
    title: z.string().optional().meta({ description: 'Widget title (default: "Last night")' }),
  })
  .meta({ id: 'LastSleepConfig' })

export type LastSleepConfig = z.infer<typeof lastSleepConfigSchema>

export const widgetTypeSchema = z.enum([
  'metric_card',
  'sparkline_card',
  'trend_chart',
  'bar_chart',
  'correlation',
  'activity_summary',
  'quick_link',
  'hr_zones',
  'goal_progress',
  'last_sleep',
  'combined_chart',
  'record_card',
  'activity_type_card',
  'top_list_card',
  'places_card',
])

export type WidgetType = z.infer<typeof widgetTypeSchema>

export const dashboardWidgetSchema = z.discriminatedUnion('type', [
  z.object({
    config: metricCardConfigSchema,
    id: z.string().min(1).meta({ description: 'Unique widget ID' }),
    type: z.literal('metric_card'),
  }),
  z.object({
    config: sparklineCardConfigSchema,
    id: z.string().min(1).meta({ description: 'Unique widget ID' }),
    type: z.literal('sparkline_card'),
  }),
  z.object({
    config: trendChartConfigSchema,
    id: z.string().min(1).meta({ description: 'Unique widget ID' }),
    type: z.literal('trend_chart'),
  }),
  z.object({
    config: barChartConfigSchema,
    id: z.string().min(1).meta({ description: 'Unique widget ID' }),
    type: z.literal('bar_chart'),
  }),
  z.object({
    config: correlationConfigSchema,
    id: z.string().min(1).meta({ description: 'Unique widget ID' }),
    type: z.literal('correlation'),
  }),
  z.object({
    config: activitySummaryConfigSchema,
    id: z.string().min(1).meta({ description: 'Unique widget ID' }),
    type: z.literal('activity_summary'),
  }),
  z.object({
    config: quickLinkConfigSchema,
    id: z.string().min(1).meta({ description: 'Unique widget ID' }),
    type: z.literal('quick_link'),
  }),
  z.object({
    config: hrZonesConfigSchema,
    id: z.string().min(1).meta({ description: 'Unique widget ID' }),
    type: z.literal('hr_zones'),
  }),
  z.object({
    config: goalProgressConfigSchema,
    id: z.string().min(1).meta({ description: 'Unique widget ID' }),
    type: z.literal('goal_progress'),
  }),
  z.object({
    config: lastSleepConfigSchema,
    id: z.string().min(1).meta({ description: 'Unique widget ID' }),
    type: z.literal('last_sleep'),
  }),
  z.object({
    config: combinedChartConfigSchema,
    id: z.string().min(1).meta({ description: 'Unique widget ID' }),
    type: z.literal('combined_chart'),
  }),
  z.object({
    config: recordCardConfigSchema,
    id: z.string().min(1).meta({ description: 'Unique widget ID' }),
    type: z.literal('record_card'),
  }),
  z.object({
    config: activityTypeCardConfigSchema,
    id: z.string().min(1).meta({ description: 'Unique widget ID' }),
    type: z.literal('activity_type_card'),
  }),
  z.object({
    config: topListCardConfigSchema,
    id: z.string().min(1).meta({ description: 'Unique widget ID' }),
    type: z.literal('top_list_card'),
  }),
  z.object({
    config: placesCardConfigSchema,
    id: z.string().min(1).meta({ description: 'Unique widget ID' }),
    type: z.literal('places_card'),
  }),
])

export type DashboardWidget = z.infer<typeof dashboardWidgetSchema>

export const sectionTypeSchema = z.enum(['metrics', 'charts', 'links'])

export type SectionType = z.infer<typeof sectionTypeSchema>

export const dashboardSectionSchema = z
  .object({
    collapsed: z.boolean().optional().meta({ description: 'Whether section is collapsed' }),
    description: z
      .string()
      .optional()
      .meta({ description: 'Optional intro text rendered above the section widgets' }),
    id: z.string().min(1).meta({ description: 'Unique section ID' }),
    title: z.string().min(1).meta({ description: 'Section title' }),
    type: sectionTypeSchema.meta({ description: 'Section type for layout' }),
    widgets: z.array(dashboardWidgetSchema).meta({ description: 'Widgets in this section' }),
  })
  .meta({ id: 'DashboardSection' })

export type DashboardSection = z.infer<typeof dashboardSectionSchema>

export const periodGranularitySchema = z.enum(['week', 'month', 'year']).meta({
  description: 'Calendar period kind: ISO week (Monday start), calendar month or calendar year',
  id: 'PeriodGranularity',
})

export type PeriodGranularity = z.infer<typeof periodGranularitySchema>

export const periodKeyPattern = /^\d{4}(-(0[1-9]|1[0-2])|-W(0[1-9]|[1-4]\d|5[0-3]))?$/

export const periodKeySchema = z.string().regex(periodKeyPattern).meta({
  description: 'A calendar period: 2026-10 (month), 2026-W44 (ISO week) or 2026 (year)',
  example: '2026-10',
  id: 'PeriodKey',
})

export type PeriodKey = z.infer<typeof periodKeySchema>

export const dashboardPeriodSchema = z
  .object({
    granularity: periodGranularitySchema,
  })
  .meta({
    description:
      'Makes the dashboard a calendar-period dashboard: every widget shows one finished period, and widget lookbacks are ignored',
    id: 'DashboardPeriod',
  })

export type DashboardPeriod = z.infer<typeof dashboardPeriodSchema>

export const dashboardConfigSchema = z
  .object({
    description: z.string().optional().meta({
      description:
        'Optional author-provided description (plain text). Feeds the shared-page meta description / link preview.',
    }),
    period: dashboardPeriodSchema.optional(),
    sections: z.array(dashboardSectionSchema).meta({ description: 'Dashboard sections' }),
    version: z.literal(1).meta({ description: 'Config version for future migrations' }),
  })
  .meta({ id: 'DashboardConfig' })

export type DashboardConfig = z.infer<typeof dashboardConfigSchema>

export const dashboardResponseSchema = baseResponseSchema
  .extend({
    dashboard: dashboardConfigSchema.meta({ description: 'Dashboard configuration' }),
  })
  .meta({ id: 'DashboardResponse' })

export type DashboardResponse = z.infer<typeof dashboardResponseSchema>

export const dashboardDataQuerySchema = z
  .object({
    period: periodKeySchema.optional().meta({
      description:
        'The finished period to show on a period dashboard (2026-10, 2026-W44 or 2026); the latest finished one when absent. Ignored by a rolling dashboard',
    }),
  })
  .meta({ id: 'DashboardDataQuery' })

export type DashboardDataQuery = z.infer<typeof dashboardDataQuerySchema>

export const updateDashboardInputSchema = dashboardConfigSchema.meta({ id: 'UpdateDashboardInput' })

export type UpdateDashboardInput = z.infer<typeof updateDashboardInputSchema>

export const defaultDashboardConfig: DashboardConfig = {
  sections: [
    {
      id: 'baseline',
      title: 'Your Baseline',
      type: 'metrics',
      widgets: [
        {
          config: {
            metric: 'hrv_7day',
            subtitle: 'Heart Rate Variability',
            title: 'HRV (7-day)',
            unit: 'ms',
          },
          id: 'hrv-7d',
          type: 'metric_card',
        },
        {
          config: { metric: 'hrv_30day', subtitle: 'Long-term average', title: 'HRV (30-day)', unit: 'ms' },
          id: 'hrv-30d',
          type: 'metric_card',
        },
        {
          config: {
            metric: 'rhr_7day',
            subtitle: 'Lower is generally better',
            title: 'Resting HR (7-day)',
            trend_inverse: true,
            unit: 'bpm',
          },
          id: 'rhr-7d',
          type: 'metric_card',
        },
        {
          config: {
            metric: 'rhr_30day',
            subtitle: 'Long-term average',
            title: 'Resting HR (30-day)',
            unit: 'bpm',
          },
          id: 'rhr-30d',
          type: 'metric_card',
        },
      ],
    },
    {
      id: 'summary',
      title: '30-Day Summary',
      type: 'metrics',
      widgets: [
        { config: {}, id: 'last-sleep', type: 'last_sleep' },
        {
          config: { color: '#3b82f6', lookback_days: 30, metric: 'sleep_score' },
          id: 'sleep',
          type: 'sparkline_card',
        },
        {
          config: { metric: 'readiness_score', title: 'Readiness Score' },
          id: 'readiness',
          type: 'metric_card',
        },
        {
          config: { metric: 'steps', title: 'Daily Steps' },
          id: 'steps',
          type: 'metric_card',
        },
        {
          config: {
            metric: 'zone2_weekly',
            subtitle: 'Target: 150-200 min/week',
            title: 'Zone 2 (Weekly)',
            unit: 'min',
          },
          id: 'zone2',
          type: 'metric_card',
        },
      ],
    },
    {
      id: 'activity',
      title: 'Activity',
      type: 'charts',
      widgets: [
        {
          config: { lookback_days: 7 },
          id: 'activity-summary',
          type: 'activity_summary',
        },
        {
          config: { lookback_days: 7, show_targets: true },
          id: 'hr-zones-widget',
          type: 'hr_zones',
        },
      ],
    },
    {
      id: 'links',
      title: 'Explore',
      type: 'links',
      widgets: [
        {
          config: { href: '/timeline', icon: 'timeline', label: 'Timeline' },
          id: 'link-timeline',
          type: 'quick_link',
        },
        { config: { href: '/sleep', icon: 'sleep', label: 'Sleep' }, id: 'link-sleep', type: 'quick_link' },
        {
          config: { href: '/correlations', icon: 'correlations', label: 'Correlations' },
          id: 'link-correlations',
          type: 'quick_link',
        },
        { config: { href: '/goals', icon: 'goals', label: 'Goals' }, id: 'link-goals', type: 'quick_link' },
        {
          config: { href: '/places', icon: 'places', label: 'Places' },
          id: 'link-places',
          type: 'quick_link',
        },
      ],
    },
  ],
  version: 1,
}

export const dashboardPresetSchema = z.enum(['blank', 'home', 'month_in_data']).meta({
  description:
    'A starting point for a new dashboard: blank (no sections), home (a copy of your home dashboard) or month_in_data (a monthly period dashboard)',
  id: 'DashboardPreset',
})

export type DashboardPreset = z.infer<typeof dashboardPresetSchema>

const monthInDataConfig: DashboardConfig = {
  description: 'One finished month at a glance, compared with the month before.',
  period: { granularity: 'month' },
  sections: [
    {
      id: 'month-body',
      title: 'Body',
      type: 'metrics',
      widgets: [
        {
          config: { metric: 'sleep_score', title: 'Sleep score' },
          id: 'month-sleep-score',
          type: 'sparkline_card',
        },
        {
          config: { pattern: 'sleep', title: 'Sleep' },
          id: 'month-sleep',
          type: 'activity_type_card',
        },
        { config: { metric: 'steps', title: 'Steps per day' }, id: 'month-steps', type: 'metric_card' },
        { config: { metric: 'hrv_rmssd', title: 'HRV', unit: 'ms' }, id: 'month-hrv', type: 'metric_card' },
        {
          config: { metric: 'resting_heart_rate', title: 'Resting HR', trend_inverse: true, unit: 'bpm' },
          id: 'month-resting-hr',
          type: 'metric_card',
        },
        {
          config: { metric: 'weight', title: 'Weight', unit: 'kg' },
          id: 'month-weight',
          type: 'metric_card',
        },
        {
          config: { metric: 'body_fat', title: 'Body fat', unit: '%' },
          id: 'month-body-fat',
          type: 'metric_card',
        },
      ],
    },
    {
      id: 'month-training',
      title: 'Training',
      type: 'charts',
      widgets: [
        {
          config: { show_meditation: true, show_sleep: true, show_workouts: true },
          id: 'month-activity-summary',
          type: 'activity_summary',
        },
        { config: { show_targets: false }, id: 'month-hr-zones', type: 'hr_zones' },
        {
          config: { pattern: 'exercise', title: 'Workouts' },
          id: 'month-workouts',
          type: 'activity_type_card',
        },
        {
          config: {
            aggregation: 'count',
            bucket_size: '1w',
            lookback_days: 31,
            pattern: 'exercise',
            source_type: 'activity_type',
            title: 'Workouts per week',
          },
          id: 'month-workouts-per-week',
          type: 'bar_chart',
        },
      ],
    },
    {
      id: 'month-life',
      title: 'Life',
      type: 'metrics',
      widgets: [
        {
          config: { limit: 3, source: 'media_artist', title: 'Music' },
          id: 'month-music',
          type: 'top_list_card',
        },
        {
          config: { limit: 3, source: 'screentime_app', title: 'Screen time' },
          id: 'month-screen-time',
          type: 'top_list_card',
        },
        { config: { title: 'Places' }, id: 'month-places', type: 'places_card' },
      ],
    },
  ],
  version: 1,
}

/** The presets a client can build without the user's own settings; `home` is resolved server-side. */
export const dashboardPresetConfigs: Record<
  Exclude<DashboardPreset, 'home'>,
  { config: DashboardConfig; name: string }
> = {
  blank: { config: { sections: [], version: 1 }, name: 'New dashboard' },
  month_in_data: { config: monthInDataConfig, name: 'Month in data' },
}
