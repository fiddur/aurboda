/**
 * Trend schemas for time-weighted averages of tags and metrics.
 *
 * Uses Exponential Moving Average (EMA) with configurable half-life to give
 * more weight to recent data while still smoothing over a configurable period.
 */

import { z } from 'zod'
import { baseResponseSchema, metricTypeSchema } from './common.js'

/**
 * Source type for trend calculation.
 */
export const trendSourceTypeSchema = z.enum(['tag', 'metric']).meta({
  description: 'Type of data source for trend calculation',
  example: 'tag',
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
      .meta({ description: 'Aggregation method: count for tags, mean for metrics' }),
    displayPeriod: trendDisplayPeriodSchema
      .default('monthly')
      .meta({ description: 'Period to normalize the rate to (daily, weekly, monthly)' }),
    halfLifeDays: z
      .number()
      .positive()
      .default(15)
      .meta({ description: 'EMA half-life in days. Common values: 7 (quick), 15 (responsive), 30 (stable)' }),
    lookbackDays: z
      .number()
      .positive()
      .default(90)
      .meta({ description: 'How many days of historical data to include' }),
    pattern: z
      .string()
      .meta({ description: 'For tags: regex pattern to match. For metrics: metric name.' }),
    sourceType: trendSourceTypeSchema.meta({ description: 'Type of source: tag or metric' }),
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
    currentValue: z.number().meta({ description: 'Current trend value' }),
    displayPeriod: trendDisplayPeriodSchema.meta({ description: 'Period the value is normalized to' }),
    displayUnit: z.string().meta({ description: 'Human-readable unit (e.g., "per month")' }),
    halfLifeDays: z.number().meta({ description: 'Half-life used for calculation' }),
    history: z.array(trendHistoryPointSchema).meta({ description: 'Historical trend values' }),
    lookbackDays: z.number().meta({ description: 'Days of data included' }),
    pattern: z.string().meta({ description: 'Pattern used for matching' }),
    sourceType: trendSourceTypeSchema.meta({ description: 'Source type queried' }),
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
    pattern: z.string(),
    source_type: trendSourceTypeSchema,
  })
  .meta({ id: 'TrendQuery' })

export type TrendQuery = z.infer<typeof trendQuerySchema>
