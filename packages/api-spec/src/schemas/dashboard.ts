/**
 * Dashboard configuration schemas for customizable widgets.
 */

import { z } from 'zod'
import { baseResponseSchema } from './common.js'

// =============================================================================
// Widget Configuration Schemas
// =============================================================================

/**
 * Metric types available for metric widgets.
 */
export const dashboardMetricSchema = z.enum([
  // Baseline metrics
  'hrv_7day',
  'hrv_30day',
  'rhr_7day',
  'rhr_30day',
  // Period summary metrics
  'sleep_score',
  'readiness_score',
  'steps',
  'zone2_weekly',
  'weight',
  'body_fat',
  // Raw metrics
  'hrv_rmssd',
  'resting_heart_rate',
  'hr_zone_2_sec',
])

export type DashboardMetric = z.infer<typeof dashboardMetricSchema>

/**
 * Metric card widget - displays a single value with optional trend.
 */
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

/**
 * Sparkline card widget - displays value with a small chart.
 */
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

/**
 * Trend chart widget - displays EMA trend visualization.
 */
export const trendChartConfigSchema = z
  .object({
    aggregation: z.enum(['count', 'sum', 'mean']).optional().meta({ description: 'Aggregation method' }),
    display_period: z
      .enum(['daily', 'weekly', 'monthly'])
      .optional()
      .meta({ description: 'Display period for rate' }),
    half_life_days: z.number().int().positive().optional().meta({ description: 'EMA half-life in days' }),
    lookback_days: z.number().int().positive().optional().meta({ description: 'Days of data to analyze' }),
    pattern: z.string().min(1).meta({ description: 'Tag pattern (regex) or metric name' }),
    source_type: z.enum(['tag', 'metric']).meta({ description: 'Data source type' }),
    title: z.string().optional().meta({ description: 'Chart title' }),
  })
  .meta({ id: 'TrendChartConfig' })

export type TrendChartConfig = z.infer<typeof trendChartConfigSchema>

/**
 * Correlation widget - displays activity impact on HRV/HR.
 */
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

/**
 * Activity summary widget - displays workout/sleep/meditation stats.
 */
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

/**
 * Quick link widget - navigation card to other pages.
 */
export const quickLinkConfigSchema = z
  .object({
    href: z.string().min(1).meta({ description: 'Target URL path' }),
    icon: z
      .enum(['timeline', 'sleep', 'hr-zones', 'correlations', 'goals', 'places', 'trends', 'settings'])
      .optional()
      .meta({ description: 'Icon name' }),
    label: z.string().min(1).meta({ description: 'Link text' }),
  })
  .meta({ id: 'QuickLinkConfig' })

export type QuickLinkConfig = z.infer<typeof quickLinkConfigSchema>

// =============================================================================
// Widget Type Discriminated Union
// =============================================================================

/**
 * Widget types enum.
 */
export const widgetTypeSchema = z.enum([
  'metric_card',
  'sparkline_card',
  'trend_chart',
  'correlation',
  'activity_summary',
  'quick_link',
])

export type WidgetType = z.infer<typeof widgetTypeSchema>

/**
 * Dashboard widget - discriminated union based on type.
 */
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
])

export type DashboardWidget = z.infer<typeof dashboardWidgetSchema>

// =============================================================================
// Section and Config Schemas
// =============================================================================

/**
 * Section types for organizing widgets.
 */
export const sectionTypeSchema = z.enum(['metrics', 'charts', 'links'])

export type SectionType = z.infer<typeof sectionTypeSchema>

/**
 * Dashboard section - a group of widgets.
 */
export const dashboardSectionSchema = z
  .object({
    collapsed: z.boolean().optional().meta({ description: 'Whether section is collapsed' }),
    id: z.string().min(1).meta({ description: 'Unique section ID' }),
    title: z.string().min(1).meta({ description: 'Section title' }),
    type: sectionTypeSchema.meta({ description: 'Section type for layout' }),
    widgets: z.array(dashboardWidgetSchema).meta({ description: 'Widgets in this section' }),
  })
  .meta({ id: 'DashboardSection' })

export type DashboardSection = z.infer<typeof dashboardSectionSchema>

/**
 * Dashboard configuration - the complete dashboard structure.
 */
export const dashboardConfigSchema = z
  .object({
    sections: z.array(dashboardSectionSchema).meta({ description: 'Dashboard sections' }),
    version: z.literal(1).meta({ description: 'Config version for future migrations' }),
  })
  .meta({ id: 'DashboardConfig' })

export type DashboardConfig = z.infer<typeof dashboardConfigSchema>

// =============================================================================
// API Request/Response Schemas
// =============================================================================

/**
 * Dashboard response schema.
 */
export const dashboardResponseSchema = baseResponseSchema
  .extend({
    dashboard: dashboardConfigSchema.meta({ description: 'Dashboard configuration' }),
  })
  .meta({ id: 'DashboardResponse' })

export type DashboardResponse = z.infer<typeof dashboardResponseSchema>

/**
 * Update dashboard input schema.
 */
export const updateDashboardInputSchema = dashboardConfigSchema.meta({ id: 'UpdateDashboardInput' })

export type UpdateDashboardInput = z.infer<typeof updateDashboardInputSchema>

// =============================================================================
// Default Dashboard Configuration
// =============================================================================

/**
 * Default dashboard configuration matching current Dashboard page layout.
 */
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
          config: { href: '/hr-zones', icon: 'hr-zones', label: 'HR Zones' },
          id: 'link-hr-zones',
          type: 'quick_link',
        },
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
