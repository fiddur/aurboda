/**
 * Metrics query schemas.
 */

import { z } from 'zod'
import { iso8601DateTimeSchema, metricTypeSchema } from './common.js'

/**
 * Metric data point schema.
 */
export const metricDataPointSchema = z
  .object({
    time: iso8601DateTimeSchema,
    value: z.number().meta({ description: 'Metric value' }),
  })
  .meta({ id: 'MetricDataPoint' })

export type MetricDataPoint = z.infer<typeof metricDataPointSchema>

/**
 * Query metrics response schema.
 */
export const queryMetricsResponseSchema = z
  .object({
    count: z.number().int().optional().meta({ description: 'Number of data points' }),
    data: z.array(metricDataPointSchema).optional(),
    error: z.string().optional(),
    metric: metricTypeSchema.optional(),
    success: z.boolean(),
    unit: z.string().optional().meta({ description: 'Unit of measurement', example: 'bpm' }),
  })
  .meta({ id: 'QueryMetricsResponse' })

export type QueryMetricsResponse = z.infer<typeof queryMetricsResponseSchema>

/**
 * Query metrics request params.
 */
export const queryMetricsParamsSchema = z
  .object({
    metric: metricTypeSchema,
  })
  .meta({ id: 'QueryMetricsParams' })

export type QueryMetricsParams = z.infer<typeof queryMetricsParamsSchema>

/**
 * Query metrics request query.
 */
export const queryMetricsQuerySchema = z
  .object({
    end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
    start: iso8601DateTimeSchema.meta({ description: 'Start date/time' }),
  })
  .meta({ id: 'QueryMetricsQuery' })

export type QueryMetricsQuery = z.infer<typeof queryMetricsQuerySchema>

/**
 * Add metric request body.
 */
export const addMetricBodySchema = z
  .object({
    metric: metricTypeSchema,
    time: iso8601DateTimeSchema.optional().meta({
      description: 'Measurement time (defaults to current time)',
    }),
    value: z.number().meta({ description: 'Metric value', example: 72 }),
  })
  .meta({ id: 'AddMetricBody' })

export type AddMetricBody = z.infer<typeof addMetricBodySchema>

/**
 * Add metric response.
 */
export const addMetricResponseSchema = z
  .object({
    error: z.string().optional(),
    success: z.boolean(),
  })
  .meta({ id: 'AddMetricResponse' })

export type AddMetricResponse = z.infer<typeof addMetricResponseSchema>
