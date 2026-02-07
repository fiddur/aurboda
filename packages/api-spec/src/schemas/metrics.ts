/**
 * Metrics query schemas.
 */

import { z } from 'zod'
import {
  baseResponseSchema,
  iso8601DateTimeSchema,
  metricTypeSchema,
  timeRangeQuerySchema,
} from './common.js'

// Shared metric value field
const metricValueSchema = z.number().meta({ description: 'Metric value' })

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
    metric: metricTypeSchema.optional(),
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
 */
export const addMetricBodySchema = z
  .object({
    metric: metricTypeSchema,
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

// =============================================================================
// Bucketed Metrics Query
// =============================================================================

/**
 * Valid bucket sizes for aggregated queries.
 */
export const bucketSizeSchema = z.enum(['5m', '15m', '30m', '1h', '1d']).meta({
  description: 'Bucket size for aggregation',
  example: '15m',
  id: 'BucketSize',
})

export type BucketSize = z.infer<typeof bucketSizeSchema>

/**
 * Statistics for a single metric within a bucket.
 */
export const bucketMetricStatsSchema = z
  .object({
    avg: z.number().meta({ description: 'Average value in bucket' }),
    count: z.number().int().meta({ description: 'Number of data points' }),
    max: z.number().meta({ description: 'Maximum value in bucket' }),
    min: z.number().meta({ description: 'Minimum value in bucket' }),
  })
  .meta({ id: 'BucketMetricStats' })

export type BucketMetricStats = z.infer<typeof bucketMetricStatsSchema>

/**
 * A single time bucket with aggregated metrics.
 * Note: Not all metrics will have data in every bucket, so only present metrics are included.
 */
export const metricBucketSchema = z
  .object({
    end: iso8601DateTimeSchema.meta({ description: 'Bucket end time' }),
    metrics: z.record(z.string(), bucketMetricStatsSchema).meta({
      description: 'Aggregated stats per metric (only metrics with data in this bucket are included)',
    }),
    start: iso8601DateTimeSchema.meta({ description: 'Bucket start time' }),
  })
  .meta({ id: 'MetricBucket' })

export type MetricBucket = z.infer<typeof metricBucketSchema>

/**
 * Query bucketed metrics request query.
 */
export const queryMetricsBucketedQuerySchema = timeRangeQuerySchema
  .extend({
    bucket: bucketSizeSchema.meta({ description: 'Bucket size: "5m", "15m", "30m", "1h", or "1d"' }),
    metrics: z.string().meta({
      description: 'Comma-separated list of metrics',
      example: 'heart_rate,hrv_rmssd',
    }),
  })
  .meta({ id: 'QueryMetricsBucketedQuery' })

export type QueryMetricsBucketedQuery = z.infer<typeof queryMetricsBucketedQuerySchema>

/**
 * Query bucketed metrics response.
 */
export const queryMetricsBucketedResponseSchema = baseResponseSchema
  .extend({
    bucket: bucketSizeSchema.optional(),
    buckets: z.array(metricBucketSchema).optional(),
    end: iso8601DateTimeSchema.optional(),
    start: iso8601DateTimeSchema.optional(),
  })
  .meta({ id: 'QueryMetricsBucketedResponse' })

export type QueryMetricsBucketedResponse = z.infer<typeof queryMetricsBucketedResponseSchema>
