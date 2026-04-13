/**
 * Trend schemas for time-weighted averages of activity types and metrics.
 *
 * Uses Exponential Moving Average (EMA) with configurable half-life to give
 * more weight to recent data while still smoothing over a configurable period.
 */

import { z } from 'zod'

import { baseResponseSchema } from './common.ts'

/**
 * Source type for trend calculation.
 */
export const trendSourceTypeSchema = z
  .enum(['tag', 'metric', 'productivity_category', 'activity_type'])
  .meta({
    description: "Type of data source for trend calculation. 'tag' is a deprecated alias for 'activity_type'.",
    example: 'activity_type',
    id: 'TrendSourceType',
  })

export type TrendSourceType = z.infer<typeof trendSourceTypeSchema>

/**
 * Display period for normalizing trend values.
 */
export const trendDisplayPeriodSchema = z.enum(['daily', 'weekly', 'monthly']).meta({
  description: 'Period for displaying trend value',
  example: 'monthly',
  id: 'TrendDisplayPeriod',
})

export type TrendDisplayPeriod = z.infer<typeof trendDisplayPeriodSchema>

/**
 * Multipliers for converting daily rate to display period.
 */
export const displayPeriodMultipliers: Record<TrendDisplayPeriod, number> = {
  daily: 1,
  monthly: 30,
  weekly: 7,
}

/**
 * Half-life presets for common use cases.
 */
export const halfLifePresets = {
  /** 7 days - responds to changes within a week */
  quick: 7,
  /** 15 days - balanced, good default */
  responsive: 15,
  /** 30 days - smooths out short-term variation */
  stable: 30,
} as const

/**
 * Schema for querying a trend value.
 */
export const getTrendQuerySchema = z
  .object({
    aggregation: z
      .enum(['count', 'sum', 'mean'])
      .default('count')
      .meta({ description: 'Aggregation method: count for activity types, mean for metrics' }),
    display_period: trendDisplayPeriodSchema
      .default('monthly')
      .meta({ description: 'Period to normalize the rate to (daily, weekly, monthly)' }),
    half_life_days: z
      .number()
      .positive()
      .default(15)
      .meta({ description: 'EMA half-life in days. Common values: 7 (quick), 15 (responsive), 30 (stable)' }),
    lookback_days: z
      .number()
      .positive()
      .default(90)
      .meta({ description: 'How many days of historical data to include' }),
    pattern: z.string().meta({ description: 'For activity types: regex pattern to match. For metrics: metric name.' }),
    source_type: trendSourceTypeSchema,
    activity_type_id: z
      .string()
      .uuid()
      .optional()
      .meta({ description: 'Activity type definition ID (alternative to pattern for activity type trends)' }),
    /** @deprecated Use activity_type_id instead */
    tag_definition_id: z
      .string()
      .uuid()
      .optional()
      .meta({ description: 'Deprecated: use activity_type_id instead' }),
    breakdown_fields: z.array(z.string()).optional().meta({
      description:
        'Data fields to break down by (for activity_type source). Produces per-series EMA histories.',
    }),
  })
  .meta({ id: 'GetTrendQuery' })

export type GetTrendQuery = z.infer<typeof getTrendQuerySchema>

/**
 * A single data point in the trend history.
 */
export const trendHistoryPointSchema = z
  .object({
    date: z.string().meta({ description: 'Date in YYYY-MM-DD format' }),
    value: z.number().meta({ description: 'Trend value for this date' }),
  })
  .meta({ id: 'TrendHistoryPoint' })

export type TrendHistoryPoint = z.infer<typeof trendHistoryPointSchema>

/**
 * Result of a trend query.
 */
export const trendResultSchema = z
  .object({
    aggregation: z.enum(['count', 'sum', 'mean']).meta({ description: 'Aggregation method used' }),
    current_value: z.number().meta({ description: 'Current trend value' }),
    display_period: trendDisplayPeriodSchema.meta({ description: 'Period the value is normalized to' }),
    display_unit: z.string().meta({ description: 'Human-readable unit (e.g., "per month")' }),
    half_life_days: z.number().meta({ description: 'Half-life used for calculation' }),
    history: z.array(trendHistoryPointSchema).meta({ description: 'Historical trend values' }),
    breakdown_series: z
      .array(z.string())
      .optional()
      .meta({ description: 'Distinct series names when breakdown is used' }),
    breakdown_histories: z
      .record(z.string(), z.array(trendHistoryPointSchema))
      .optional()
      .meta({ description: 'Per-series EMA trend histories keyed by series name' }),
    lookback_days: z.number().meta({ description: 'Days of data included' }),
    pattern: z.string().meta({ description: 'Pattern used for matching' }),
    source_type: trendSourceTypeSchema.meta({ description: 'Source type queried' }),
  })
  .meta({ id: 'TrendResult' })

export type TrendResult = z.infer<typeof trendResultSchema>

/**
 * Response schema for trend query.
 */
export const trendResponseSchema = baseResponseSchema
  .extend({
    data: trendResultSchema.optional(),
  })
  .meta({ id: 'TrendResponse' })

export type TrendResponse = z.infer<typeof trendResponseSchema>

/**
 * Query parameters for GET /trends endpoint.
 * Numeric fields are strings here (as Express passes them) and parsed in the handler.
 */
export const trendQuerySchema = z
  .object({
    aggregation: z.enum(['count', 'sum', 'mean']).optional(),
    display_period: trendDisplayPeriodSchema.optional(),
    half_life_days: z.string().optional().meta({ description: 'EMA half-life in days', example: '15' }),
    lookback_days: z.string().optional().meta({ description: 'Days of historical data', example: '90' }),
    pattern: z
      .string()
      .optional()
      .meta({ description: 'Pattern (required unless activity_type_id is provided)' }),
    source_type: trendSourceTypeSchema,
    activity_type_id: z
      .string()
      .uuid()
      .optional()
      .meta({ description: 'Activity type definition ID (alternative to pattern)' }),
    /** @deprecated Use activity_type_id instead */
    tag_definition_id: z
      .string()
      .uuid()
      .optional()
      .meta({ description: 'Deprecated: use activity_type_id instead' }),
    breakdown_fields: z
      .string()
      .optional()
      .meta({ description: 'Comma-separated data fields to break down by' }),
  })
  .meta({ id: 'TrendQuery' })

export type TrendQuery = z.infer<typeof trendQuerySchema>
