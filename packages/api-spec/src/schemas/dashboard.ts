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
    title: z.string().min(1).meta({ description: 'Display title for the metric' }),
    subtitle: z.string().optional().meta({ description: 'Optional subtitle text' }),
    unit: z.string().optional().meta({ description: 'Unit label (e.g., "ms", "bpm")' }),
    trendInverse: z.boolean().optional().meta({ description: 'If true, lower values are better' }),
  })
  .meta({ id: 'MetricCardConfig' })

export type MetricCardConfig = z.infer<typeof metricCardConfigSchema>

/**
 * Sparkline card widget - displays value with a small chart.
 */
export const sparklineCardConfigSchema = z
  .object({
    metric: dashboardMetricSchema.meta({ description: 'The metric to display' }),
    title: z.string().optional().meta({ description: 'Display title for the metric' }),
    lookbackDays: z.number().int().positive().optional().meta({ description: 'Days of data to show in sparkline (default: 30)' }),
    color: z.string().optional().meta({ description: 'Chart line color (CSS color)' }),
  })
  .meta({ id: 'SparklineCardConfig' })

export type SparklineCardConfig = z.infer<typeof sparklineCardConfigSchema>

/**
 * Trend chart widget - displays EMA trend visualization.
 */
export const trendChartConfigSchema = z
  .object({
    sourceType: z.enum(['tag', 'metric']).meta({ description: 'Data source type' }),
    pattern: z.string().min(1).meta({ description: 'Tag pattern (regex) or metric name' }),
    title: z.string().optional().meta({ description: 'Chart title' }),
    halfLifeDays: z.number().int().positive().optional().meta({ description: 'EMA half-life in days' }),
    lookbackDays: z.number().int().positive().optional().meta({ description: 'Days of data to analyze' }),
    displayPeriod: z.enum(['daily', 'weekly', 'monthly']).optional().meta({ description: 'Display period for rate' }),
    aggregation: z.enum(['count', 'sum', 'mean']).optional().meta({ description: 'Aggregation method' }),
  })
  .meta({ id: 'TrendChartConfig' })

export type TrendChartConfig = z.infer<typeof trendChartConfigSchema>

/**
 * Correlation widget - displays activity impact on HRV/HR.
 */
export const correlationConfigSchema = z
  .object({
    activity: z.string().min(1).meta({ description: 'Activity or tag to analyze' }),
    activityType: z
      .enum(['productivity_category', 'productivity_app', 'location', 'tag', 'activity_type'])
      .meta({ description: 'Type of activity' }),
    title: z.string().optional().meta({ description: 'Widget title' }),
    periodDays: z.number().int().positive().optional().meta({ description: 'Days of data to analyze' }),
    windowMinutes: z.number().int().positive().optional().meta({ description: 'Minutes before/after to analyze' }),
  })
  .meta({ id: 'CorrelationConfig' })

export type CorrelationConfig = z.infer<typeof correlationConfigSchema>

/**
 * Activity summary widget - displays workout/sleep/meditation stats.
 */
export const activitySummaryConfigSchema = z
  .object({
    lookbackDays: z.number().int().positive().optional().meta({ description: 'Days of activities to summarize (default: 7)' }),
    showWorkouts: z.boolean().optional().meta({ description: 'Show workout count and duration (default: true)' }),
    showSleep: z.boolean().optional().meta({ description: 'Show average sleep hours (default: true)' }),
    showMeditation: z.boolean().optional().meta({ description: 'Show meditation count (default: true)' }),
  })
  .meta({ id: 'ActivitySummaryConfig' })

export type ActivitySummaryConfig = z.infer<typeof activitySummaryConfigSchema>

/**
 * Quick link widget - navigation card to other pages.
 */
export const quickLinkConfigSchema = z
  .object({
    href: z.string().min(1).meta({ description: 'Target URL path' }),
    label: z.string().min(1).meta({ description: 'Link text' }),
    icon: z
      .enum(['timeline', 'sleep', 'hr-zones', 'correlations', 'goals', 'places', 'trends', 'settings'])
      .optional()
      .meta({ description: 'Icon name' }),
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
    id: z.string().min(1).meta({ description: 'Unique widget ID' }),
    type: z.literal('metric_card'),
    config: metricCardConfigSchema,
  }),
  z.object({
    id: z.string().min(1).meta({ description: 'Unique widget ID' }),
    type: z.literal('sparkline_card'),
    config: sparklineCardConfigSchema,
  }),
  z.object({
    id: z.string().min(1).meta({ description: 'Unique widget ID' }),
    type: z.literal('trend_chart'),
    config: trendChartConfigSchema,
  }),
  z.object({
    id: z.string().min(1).meta({ description: 'Unique widget ID' }),
    type: z.literal('correlation'),
    config: correlationConfigSchema,
  }),
  z.object({
    id: z.string().min(1).meta({ description: 'Unique widget ID' }),
    type: z.literal('activity_summary'),
    config: activitySummaryConfigSchema,
  }),
  z.object({
    id: z.string().min(1).meta({ description: 'Unique widget ID' }),
    type: z.literal('quick_link'),
    config: quickLinkConfigSchema,
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
    id: z.string().min(1).meta({ description: 'Unique section ID' }),
    type: sectionTypeSchema.meta({ description: 'Section type for layout' }),
    title: z.string().min(1).meta({ description: 'Section title' }),
    collapsed: z.boolean().optional().meta({ description: 'Whether section is collapsed' }),
    widgets: z.array(dashboardWidgetSchema).meta({ description: 'Widgets in this section' }),
  })
  .meta({ id: 'DashboardSection' })

export type DashboardSection = z.infer<typeof dashboardSectionSchema>

/**
 * Dashboard configuration - the complete dashboard structure.
 */
export const dashboardConfigSchema = z
  .object({
    version: z.literal(1).meta({ description: 'Config version for future migrations' }),
    sections: z.array(dashboardSectionSchema).meta({ description: 'Dashboard sections' }),
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
  version: 1,
  sections: [
    {
      id: 'baseline',
      type: 'metrics',
      title: 'Your Baseline',
      widgets: [
        {
          id: 'hrv-7d',
          type: 'metric_card',
          config: { metric: 'hrv_7day', title: 'HRV (7-day)', unit: 'ms', subtitle: 'Heart Rate Variability' },
        },
        {
          id: 'hrv-30d',
          type: 'metric_card',
          config: { metric: 'hrv_30day', title: 'HRV (30-day)', unit: 'ms', subtitle: 'Long-term average' },
        },
        {
          id: 'rhr-7d',
          type: 'metric_card',
          config: {
            metric: 'rhr_7day',
            title: 'Resting HR (7-day)',
            unit: 'bpm',
            subtitle: 'Lower is generally better',
            trendInverse: true,
          },
        },
        {
          id: 'rhr-30d',
          type: 'metric_card',
          config: { metric: 'rhr_30day', title: 'Resting HR (30-day)', unit: 'bpm', subtitle: 'Long-term average' },
        },
      ],
    },
    {
      id: 'summary',
      type: 'metrics',
      title: '30-Day Summary',
      widgets: [
        {
          id: 'sleep',
          type: 'sparkline_card',
          config: { metric: 'sleep_score', lookbackDays: 30, color: '#3b82f6' },
        },
        {
          id: 'readiness',
          type: 'metric_card',
          config: { metric: 'readiness_score', title: 'Readiness Score' },
        },
        {
          id: 'steps',
          type: 'metric_card',
          config: { metric: 'steps', title: 'Daily Steps' },
        },
        {
          id: 'zone2',
          type: 'metric_card',
          config: { metric: 'zone2_weekly', title: 'Zone 2 (Weekly)', unit: 'min', subtitle: 'Target: 150-200 min/week' },
        },
      ],
    },
    {
      id: 'activity',
      type: 'charts',
      title: 'Activity',
      widgets: [
        {
          id: 'activity-summary',
          type: 'activity_summary',
          config: { lookbackDays: 7 },
        },
      ],
    },
    {
      id: 'links',
      type: 'links',
      title: 'Explore',
      widgets: [
        { id: 'link-timeline', type: 'quick_link', config: { href: '/timeline', label: 'Timeline', icon: 'timeline' } },
        { id: 'link-sleep', type: 'quick_link', config: { href: '/sleep', label: 'Sleep', icon: 'sleep' } },
        { id: 'link-hr-zones', type: 'quick_link', config: { href: '/hr-zones', label: 'HR Zones', icon: 'hr-zones' } },
        {
          id: 'link-correlations',
          type: 'quick_link',
          config: { href: '/correlations', label: 'Correlations', icon: 'correlations' },
        },
        { id: 'link-goals', type: 'quick_link', config: { href: '/goals', label: 'Goals', icon: 'goals' } },
        { id: 'link-places', type: 'quick_link', config: { href: '/places', label: 'Places', icon: 'places' } },
      ],
    },
  ],
}
