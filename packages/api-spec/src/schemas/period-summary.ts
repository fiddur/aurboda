/**
 * Period summary schemas.
 */

import { z } from 'zod'
import {
  baseResponseSchema,
  iso8601DateTimeSchema,
  metricTypeSchema,
  timeRangeQuerySchema,
} from './common.js'

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
    avg: z.number().meta({ description: 'Average value' }),
    changeFromPreviousPeriodPercent: z.number().nullable().meta({
      description: 'Percent change from previous period',
    }),
    completenessPercent: z.number().meta({
      description: 'Data completeness (days with data / total days)',
    }),
    count: z.number().int().meta({ description: 'Number of data points' }),
    max: z.number().meta({ description: 'Maximum value' }),
    metric: metricTypeSchema,
    min: z.number().meta({ description: 'Minimum value' }),
    outliers: z.array(outlierSchema).optional().meta({
      description: 'Values more than 2 stddev from mean',
    }),
    stddev: z.number().meta({ description: 'Standard deviation' }),
    trendPerDay: z.number().nullable().meta({
      description: 'Daily trend (slope of linear regression)',
    }),
    unit: z.string().meta({ description: 'Unit of measurement' }),
  })
  .meta({ id: 'PeriodMetricStats' })

export type PeriodMetricStats = z.infer<typeof periodMetricStatsSchema>

/**
 * Period summary result schema.
 */
export const periodSummaryResultSchema = z
  .object({
    end: iso8601DateTimeSchema,
    metrics: z.array(periodMetricStatsSchema),
    periodDays: z.number().int().meta({ description: 'Number of days in period' }),
    start: iso8601DateTimeSchema,
  })
  .meta({ id: 'PeriodSummaryResult' })

export type PeriodSummaryResult = z.infer<typeof periodSummaryResultSchema>

/**
 * Period summary response schema (API wrapper).
 */
export const periodSummaryResponseSchema = baseResponseSchema
  .extend({
    end: iso8601DateTimeSchema.optional(),
    metrics: z.array(periodMetricStatsSchema).optional(),
    periodDays: z.number().int().optional(),
    start: iso8601DateTimeSchema.optional(),
  })
  .meta({ id: 'PeriodSummaryResponse' })

export type PeriodSummaryResponse = z.infer<typeof periodSummaryResponseSchema>

/**
 * Period summary query schema.
 */
export const periodSummaryQuerySchema = timeRangeQuerySchema
  .extend({
    metrics: z.string().meta({
      description: 'Comma-separated list of metrics',
      example: 'heart_rate,steps,sleep_score',
    }),
  })
  .meta({ id: 'PeriodSummaryQuery' })

export type PeriodSummaryQuery = z.infer<typeof periodSummaryQuerySchema>
