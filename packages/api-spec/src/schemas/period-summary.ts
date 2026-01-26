/**
 * Period summary schemas.
 */

import { z } from 'zod'
import { iso8601DateTimeSchema, metricTypeSchema } from './common.js'

/**
 * Outlier schema.
 */
export const outlierSchema = z
  .object({
    type: z.enum(['high', 'low']).meta({ description: 'Outlier type' }),
    value: z.number().meta({ description: 'Outlier value' }),
  })
  .meta({ id: 'Outlier' })

export type Outlier = z.infer<typeof outlierSchema>

/**
 * Period metric stats schema.
 */
export const periodMetricStatsSchema = z
  .object({
    metric: metricTypeSchema,
    unit: z.string().meta({ description: 'Unit of measurement' }),
    count: z.number().int().meta({ description: 'Number of data points' }),
    min: z.number().meta({ description: 'Minimum value' }),
    max: z.number().meta({ description: 'Maximum value' }),
    avg: z.number().meta({ description: 'Average value' }),
    stddev: z.number().meta({ description: 'Standard deviation' }),
    trendPerDay: z.number().nullable().meta({
      description: 'Daily trend (slope of linear regression)',
    }),
    changeFromPreviousPeriodPercent: z.number().nullable().meta({
      description: 'Percent change from previous period',
    }),
    completenessPercent: z.number().meta({
      description: 'Data completeness (days with data / total days)',
    }),
    outliers: z.array(outlierSchema).optional().meta({
      description: 'Values more than 2 stddev from mean',
    }),
  })
  .meta({ id: 'PeriodMetricStats' })

export type PeriodMetricStats = z.infer<typeof periodMetricStatsSchema>

/**
 * Period summary result schema.
 */
export const periodSummaryResultSchema = z
  .object({
    start: iso8601DateTimeSchema,
    end: iso8601DateTimeSchema,
    periodDays: z.number().int().meta({ description: 'Number of days in period' }),
    metrics: z.array(periodMetricStatsSchema),
  })
  .meta({ id: 'PeriodSummaryResult' })

export type PeriodSummaryResult = z.infer<typeof periodSummaryResultSchema>

/**
 * Period summary response schema (API wrapper).
 */
export const periodSummaryResponseSchema = z
  .object({
    success: z.boolean(),
    start: iso8601DateTimeSchema.optional(),
    end: iso8601DateTimeSchema.optional(),
    periodDays: z.number().int().optional(),
    metrics: z.array(periodMetricStatsSchema).optional(),
    error: z.string().optional(),
  })
  .meta({ id: 'PeriodSummaryResponse' })

export type PeriodSummaryResponse = z.infer<typeof periodSummaryResponseSchema>

/**
 * Period summary query schema.
 */
export const periodSummaryQuerySchema = z
  .object({
    start: iso8601DateTimeSchema.meta({ description: 'Start date/time' }),
    end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
    metrics: z.string().meta({
      description: 'Comma-separated list of metrics',
      example: 'heart_rate,steps,sleep_score',
    }),
  })
  .meta({ id: 'PeriodSummaryQuery' })

export type PeriodSummaryQuery = z.infer<typeof periodSummaryQuerySchema>
