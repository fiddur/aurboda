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
} from './common.ts'

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
    source: z
      .string()
      .optional()
      .meta({ description: 'Data source (e.g., "manual", "oura", "health_connect")' }),
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
export const addMetricResponseSchema = baseResponseSchema
  .extend({
    entity_id: z.string().optional().meta({
      description: 'Composite entity ID for the created metric point (format: time|metric|source)',
    }),
  })
  .meta({ id: 'AddMetricResponse' })

export type AddMetricResponse = z.infer<typeof addMetricResponseSchema>

// ============================================================================
// Bulk Metric Insert
// ============================================================================

/**
 * Single item within a bulk metric insert request.
 */
export const bulkMetricItemSchema = z
  .object({
    metric: metricNameSchema,
    source: z.string().min(1).max(50).optional().meta({ description: 'Data source (defaults to "aurboda")' }),
    time: iso8601DateTimeSchema.meta({ description: 'Measurement time (required for bulk inserts)' }),
    value: metricValueSchema.meta({ example: 36.03 }),
  })
  .meta({ id: 'BulkMetricItem' })

export type BulkMetricItem = z.infer<typeof bulkMetricItemSchema>

/**
 * Bulk metric insert request body.
 * Accepts up to 10,000 metric data points per request.
 */
export const bulkMetricsBodySchema = z
  .object({
    data: z
      .array(bulkMetricItemSchema)
      .min(1)
      .max(10_000)
      .meta({ description: 'Array of metric data points (max 10,000 per request)' }),
    source: z
      .string()
      .min(1)
      .max(50)
      .optional()
      .meta({ description: 'Default data source for all items (defaults to "aurboda")' }),
  })
  .meta({
    description: 'Bulk insert metric data points for efficient batch imports.',
    id: 'BulkMetricsBody',
  })

export type BulkMetricsBody = z.infer<typeof bulkMetricsBodySchema>

/**
 * Per-item error in bulk insert response.
 */
export const bulkMetricErrorSchema = z
  .object({
    error: z.string().meta({ description: 'Error message' }),
    index: z.number().int().meta({ description: 'Zero-based index of the failed item' }),
  })
  .meta({ id: 'BulkMetricError' })

export type BulkMetricError = z.infer<typeof bulkMetricErrorSchema>

/**
 * Bulk metric insert response.
 */
export const bulkMetricsResponseSchema = baseResponseSchema
  .extend({
    errors: z.array(bulkMetricErrorSchema).optional().meta({ description: 'Per-item validation errors' }),
    inserted: z.number().int().optional().meta({ description: 'Number of successfully inserted items' }),
  })
  .meta({ id: 'BulkMetricsResponse' })

export type BulkMetricsResponse = z.infer<typeof bulkMetricsResponseSchema>

// ============================================================================
// Custom Metric Management
// ============================================================================

/**
 * Add custom metric request body.
 */
export const addCustomMetricBodySchema = customMetricDefinitionSchema.meta({ id: 'AddCustomMetricBody' })

export type AddCustomMetricBody = z.infer<typeof addCustomMetricBodySchema>

/**
 * Update custom metric request body.
 * All fields are optional; null clears minValue/maxValue.
 */
export const updateCustomMetricBodySchema = z
  .object({
    description: z.string().optional().meta({ description: 'Human-readable description' }),
    include_in_daily_summary: z.boolean().optional().meta({
      description:
        'When true, surface this metric in get_daily_summary under metrics_today and metrics_latest.',
    }),
    max_value: z
      .number()
      .nullable()
      .optional()
      .meta({ description: 'Maximum allowed value (null to clear)' }),
    min_value: z
      .number()
      .nullable()
      .optional()
      .meta({ description: 'Minimum allowed value (null to clear)' }),
    unit: z
      .string()
      .min(1)
      .max(20)
      .optional()
      .meta({ description: 'Unit of measurement (e.g., "score", "mg")' }),
  })
  .meta({ id: 'UpdateCustomMetricBody' })

export type UpdateCustomMetricBody = z.infer<typeof updateCustomMetricBodySchema>

/**
 * Delete metric query schema for single measurement deletion.
 */
export const deleteMetricQuerySchema = z
  .object({
    source: z.string().describe('Data source of the measurement'),
    time: iso8601DateTimeSchema,
  })
  .meta({ id: 'DeleteMetricQuery' })

export type DeleteMetricQuery = z.infer<typeof deleteMetricQuerySchema>

/**
 * Delete metric response.
 */
export const deleteMetricResponseSchema = baseResponseSchema
  .extend({
    deleted: z.boolean().meta({ description: 'Whether the measurement was deleted' }),
    metric: z.string().optional().meta({ description: 'Metric name' }),
    source: z.string().optional().meta({ description: 'Data source' }),
    time: iso8601DateTimeSchema.optional().meta({ description: 'Measurement time' }),
  })
  .meta({ id: 'DeleteMetricResponse' })

export type DeleteMetricResponse = z.infer<typeof deleteMetricResponseSchema>

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

// =============================================================================
// Bucketed Metrics Query
// =============================================================================

/**
 * Bucket size for time-based aggregation.
 * Format: {number}{unit} where unit is s (seconds), m (minutes), h (hours), d (days), w (weeks), M (months).
 * Examples: '10s', '5m', '1h', '1d', '1w', '1M'
 */
export const bucketSizeSchema = z
  .string()
  .regex(/^\d+[smhdwM]$/, 'Must be {number}{unit} where unit is s, m, h, d, w, or M')
  .meta({
    description:
      'Bucket size: {number}{unit} where unit is s (seconds), m (minutes), h (hours), d (days), w (weeks), M (months)',
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
    sum: z
      .number()
      .optional()
      .meta({ description: 'Sum of values in bucket (present for cumulative metrics)' }),
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
 * If metrics is omitted, returns all metrics with data in the time range.
 * Use exclude to skip specific metrics when fetching all.
 */
export const queryMetricsBucketedQuerySchema = timeRangeQuerySchema
  .extend({
    bucket: bucketSizeSchema,
    exclude: z.string().optional().meta({
      description: 'Comma-separated list of metrics to exclude (useful when fetching all)',
      example: 'training_impulse,activity_impulse',
    }),
    metrics: z.string().optional().meta({
      description: 'Comma-separated list of metrics (omit to fetch all metrics with data in the range)',
      example: 'heart_rate,hrv_rmssd',
    }),
    tz: z
      .string()
      .optional()
      .meta({
        description:
          'IANA timezone for bucket alignment (e.g. "Europe/Stockholm"). ' +
          'Daily+ buckets align to local midnight. Defaults to UTC.',
        example: 'Europe/Stockholm',
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

// =============================================================================
// Calorie Recalculation
// =============================================================================

/**
 * Recalculate calories request body.
 * Computes calorie burn from HR data for the given time range.
 */
export const recalculateCaloriesBodySchema = z
  .object({
    end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
    start: iso8601DateTimeSchema.meta({ description: 'Start date/time' }),
  })
  .meta({
    description: 'Recalculate calories burned from HR data for a time range.',
    id: 'RecalculateCaloriesBody',
  })

export type RecalculateCaloriesBody = z.infer<typeof recalculateCaloriesBodySchema>

/**
 * Recalculate calories response.
 */
export const recalculateCaloriesResponseSchema = baseResponseSchema
  .extend({
    points_computed: z
      .number()
      .int()
      .optional()
      .meta({ description: 'Total per-minute calorie points computed' }),
    points_stored: z
      .number()
      .int()
      .optional()
      .meta({ description: 'New points stored (excluding already-computed)' }),
    skipped_reason: z.string().optional().meta({ description: 'Reason computation was skipped, if any' }),
    vo2_max_source: z
      .enum(['measured', 'fallback'])
      .optional()
      .meta({ description: 'Whether measured VO2 max was used or age/sex fallback' }),
  })
  .meta({ id: 'RecalculateCaloriesResponse' })

export type RecalculateCaloriesResponse = z.infer<typeof recalculateCaloriesResponseSchema>

// =============================================================================
// Latest Metric Value
// =============================================================================

/**
 * Latest metric query — returns the most recent value for a metric regardless of age.
 * Useful for lab data that may be months old (e.g., "what was last VO2 max?").
 */
export const latestMetricQuerySchema = z
  .object({
    metric: metricNameSchema,
  })
  .meta({
    description: 'Query the most recent value for a metric regardless of age',
    id: 'LatestMetricQuery',
  })

export type LatestMetricQuery = z.infer<typeof latestMetricQuerySchema>

/**
 * Latest metric response.
 */
export const latestMetricResponseSchema = baseResponseSchema
  .extend({
    metric: metricNameSchema.optional(),
    source: z.string().optional().meta({ description: 'Data source of the latest value' }),
    time: iso8601DateTimeSchema.optional().meta({ description: 'Timestamp of the latest value' }),
    unit: z.string().optional().meta({ description: 'Unit of measurement' }),
    value: z.number().optional().meta({ description: 'The most recent value' }),
  })
  .meta({ id: 'LatestMetricResponse' })

export type LatestMetricResponse = z.infer<typeof latestMetricResponseSchema>

// =============================================================================
// Merge Custom Metric
// =============================================================================

/**
 * Merge a custom metric into another metric (built-in or custom).
 * All time_series data is reassigned; the source definition is deleted.
 */
export const mergeCustomMetricBodySchema = z
  .object({
    source: metricNameSchema.meta({ description: 'Custom metric to merge away' }),
    target: metricNameSchema.meta({ description: 'Target metric to merge into (built-in or custom)' }),
  })
  .meta({ id: 'MergeCustomMetricBody' })

export type MergeCustomMetricBody = z.infer<typeof mergeCustomMetricBodySchema>

/**
 * Merge custom metric response.
 */
export const mergeCustomMetricResponseSchema = baseResponseSchema
  .extend({
    rows_reassigned: z
      .number()
      .int()
      .optional()
      .meta({ description: 'Number of time_series rows moved to the target metric' }),
    rows_skipped: z
      .number()
      .int()
      .optional()
      .meta({ description: 'Number of rows skipped due to duplicate (time, source) conflicts' }),
  })
  .meta({ id: 'MergeCustomMetricResponse' })

export type MergeCustomMetricResponse = z.infer<typeof mergeCustomMetricResponseSchema>
