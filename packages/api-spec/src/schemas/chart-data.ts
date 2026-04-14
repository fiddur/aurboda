/**
 * Chart data schemas for bucketed aggregation of activity types, metrics,
 * productivity categories, and more.
 *
 * Supports daily, weekly, and monthly bucketing with count/sum/mean aggregation.
 */

import { z } from 'zod'

import { baseResponseSchema } from './common.ts'

/**
 * Source type for chart data queries.
 */
export const chartDataSourceTypeSchema = z
  .enum(['tag', 'metric', 'productivity_category', 'activity_type'])
  .meta({
    description: "Type of data source for chart data query. 'tag' is a deprecated alias for 'activity_type'.",
    example: 'activity_type',
    id: 'ChartDataSourceType',
  })

export type ChartDataSourceType = z.infer<typeof chartDataSourceTypeSchema>

/**
 * Bucket size for chart data aggregation.
 */
export const chartDataBucketSizeSchema = z.enum(['1m', '5m', '15m', '1h', '1d', '1w', '1M']).meta({
  description:
    'Bucket size for aggregation: 1 minute, 5 minutes, 15 minutes, hourly, daily, weekly, or monthly',
  example: '1d',
  id: 'ChartDataBucketSize',
})

export type ChartDataBucketSize = z.infer<typeof chartDataBucketSizeSchema>

/**
 * Aggregation method for chart data.
 */
export const chartDataAggregationSchema = z.enum(['count', 'sum', 'mean']).meta({
  description: 'Aggregation method: count, sum, or mean',
  example: 'count',
  id: 'ChartDataAggregation',
})

export type ChartDataAggregation = z.infer<typeof chartDataAggregationSchema>

/**
 * Query schema for chart data endpoint (typed, for service layer).
 */
export const chartDataQuerySchema = z
  .object({
    aggregation: chartDataAggregationSchema.default('count').meta({ description: 'Aggregation method' }),
    bucket_size: chartDataBucketSizeSchema.default('1d').meta({ description: 'Bucket size for aggregation' }),
    end: z.iso.datetime().meta({ description: 'End of time range (ISO 8601)' }),
    pattern: z.string().optional().meta({
      description: 'Pattern to match (regex for activity types, metric name for metrics, category path)',
    }),
    source_type: chartDataSourceTypeSchema.meta({ description: 'Type of data source' }),
    start: z.iso.datetime().meta({ description: 'Start of time range (ISO 8601)' }),
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
    breakdown_fields: z.array(z.string()).optional().meta({
      description:
        'Data fields to break down by (for activity_type source). Multiple fields produce compound series keys.',
    }),
  })
  .meta({ id: 'ChartDataQuery', description: 'Query parameters for bucketed chart data' })

export type ChartDataQuery = z.infer<typeof chartDataQuerySchema>

/**
 * HTTP query schema for Express query params (all strings).
 */
export const chartDataHttpQuerySchema = z
  .object({
    aggregation: z.enum(['count', 'sum', 'mean']).optional(),
    breakdown_fields: z
      .string()
      .optional()
      .meta({ description: 'Comma-separated data fields to break down by' }),
    bucket_size: z.enum(['1m', '5m', '15m', '1h', '1d', '1w', '1M']).optional(),
    end: z.string().meta({ description: 'End of time range (ISO 8601 string)' }),
    pattern: z.string().optional().meta({ description: 'Pattern to match' }),
    source_type: chartDataSourceTypeSchema,
    start: z.string().meta({ description: 'Start of time range (ISO 8601 string)' }),
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
  })
  .meta({ id: 'ChartDataHttpQuery', description: 'HTTP query parameters for chart data endpoint' })

export type ChartDataHttpQuery = z.infer<typeof chartDataHttpQuerySchema>

/**
 * A single bucket in the chart data response.
 */
export const chartDataBucketSchema = z
  .object({
    bucket_start: z.string().meta({ description: 'Start of the bucket (ISO 8601 datetime)' }),
    value: z.number().meta({ description: 'Aggregated value for this bucket' }),
  })
  .meta({ id: 'ChartDataBucket', description: 'A single data bucket with start time and aggregated value' })

export type ChartDataBucket = z.infer<typeof chartDataBucketSchema>

/**
 * A breakdown bucket — one bucket with multiple series (keyed by field value).
 */
export const chartDataBreakdownBucketSchema = z
  .object({
    bucket_start: z.string().meta({ description: 'Start of the bucket (ISO 8601 datetime)' }),
    series: z.record(z.string(), z.number()).meta({ description: 'Map of field value to aggregated value' }),
  })
  .meta({ id: 'ChartDataBreakdownBucket', description: 'A bucket with breakdown by data field value' })

export type ChartDataBreakdownBucket = z.infer<typeof chartDataBreakdownBucketSchema>

/**
 * Response schema for chart data endpoint.
 */
export const chartDataResponseSchema = baseResponseSchema
  .extend({
    data: z
      .object({
        breakdown_fields: z
          .array(z.string())
          .optional()
          .meta({ description: 'Fields used for breakdown, if any' }),
        breakdown_series: z
          .array(z.string())
          .optional()
          .meta({ description: 'Distinct field values in breakdown' }),
        buckets: z.array(z.union([chartDataBucketSchema, chartDataBreakdownBucketSchema])),
      })
      .optional(),
  })
  .meta({ id: 'ChartDataResponse', description: 'Response containing bucketed chart data' })

export type ChartDataResponse = z.infer<typeof chartDataResponseSchema>
