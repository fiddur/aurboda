/**
 * Metrics query schemas.
 */

import { z } from 'zod'
import {
  baseResponseSchema,
  customMetricDefinitionSchema,
  iso8601DateTimeSchema,
  metricTypeSchema,
  timeRangeQuerySchema,
} from './common.js'

// Shared metric value field
const metricValueSchema = z.number().meta({ description: 'Metric value' })

/**
 * Metric name field that accepts both built-in and custom metric names.
 * Validation against the user's custom metrics is done at the service layer.
 */
const metricNameSchema = z.string().min(1).max(50).meta({
  description: 'Metric name (built-in or custom)',
  example: 'heart_rate',
})

/**
 * Metric data point schema.
 */
export const metricDataPointSchema = z
  .object({
    time: iso8601DateTimeSchema,
    value: metricValueSchema,
  })
  .meta({ id: 'MetricDataPoint' })

export type MetricDataPoint = z.infer<typeof metricDataPointSchema>

/**
 * Query metrics response schema.
 */
export const queryMetricsResponseSchema = baseResponseSchema
  .extend({
    count: z.number().int().optional().meta({ description: 'Number of data points' }),
    data: z.array(metricDataPointSchema).optional(),
    metric: metricNameSchema.optional(),
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
export const queryMetricsQuerySchema = timeRangeQuerySchema.meta({ id: 'QueryMetricsQuery' })

export type QueryMetricsQuery = z.infer<typeof queryMetricsQuerySchema>

/**
 * Add metric request body.
 * Accepts both built-in and custom metric names (validated at service layer).
 */
export const addMetricBodySchema = z
  .object({
    metric: metricNameSchema,
    time: iso8601DateTimeSchema.optional().meta({
      description: 'Measurement time (defaults to current time)',
    }),
    value: metricValueSchema.meta({ example: 72 }),
  })
  .meta({ id: 'AddMetricBody' })

export type AddMetricBody = z.infer<typeof addMetricBodySchema>

/**
 * Add metric response.
 */
export const addMetricResponseSchema = baseResponseSchema.meta({ id: 'AddMetricResponse' })

export type AddMetricResponse = z.infer<typeof addMetricResponseSchema>

// ============================================================================
// Custom Metric Management
// ============================================================================

/**
 * Add custom metric request body.
 */
export const addCustomMetricBodySchema = customMetricDefinitionSchema.meta({ id: 'AddCustomMetricBody' })

export type AddCustomMetricBody = z.infer<typeof addCustomMetricBodySchema>

/**
 * Custom metric response.
 */
export const customMetricResponseSchema = baseResponseSchema
  .extend({
    data: customMetricDefinitionSchema.optional(),
  })
  .meta({ id: 'CustomMetricResponse' })

export type CustomMetricResponse = z.infer<typeof customMetricResponseSchema>

/**
 * List custom metrics response.
 */
export const customMetricsListResponseSchema = baseResponseSchema
  .extend({
    data: z.array(customMetricDefinitionSchema).optional(),
  })
  .meta({ id: 'CustomMetricsListResponse' })

export type CustomMetricsListResponse = z.infer<typeof customMetricsListResponseSchema>
