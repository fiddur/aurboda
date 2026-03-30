/**
 * Chart data schemas for bucketed aggregation of tags, metrics,
 * productivity categories, and activity types.
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
    description: 'Type of data source for chart data query',
    example: 'tag',
    id: 'ChartDataSourceType',
  })

export type ChartDataSourceType = z.infer<typeof chartDataSourceTypeSchema>

/**
 * Bucket size for chart data aggregation.
 */
export const chartDataBucketSizeSchema = z.enum(['15m', '1h', '1d', '1w', '1M']).meta({
  description: 'Bucket size for aggregation: 15 minutes, hourly, daily, weekly, or monthly',
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
    pattern: z
      .string()
      .optional()
      .meta({ description: 'Pattern to match (regex for tags, metric name for metrics, category path)' }),
    source_type: chartDataSourceTypeSchema.meta({ description: 'Type of data source' }),
    start: z.iso.datetime().meta({ description: 'Start of time range (ISO 8601)' }),
    tag_definition_id: z
      .string()
      .uuid()
      .optional()
      .meta({ description: 'Tag definition ID (alternative to pattern for tags)' }),
  })
  .meta({ id: 'ChartDataQuery', description: 'Query parameters for bucketed chart data' })

export type ChartDataQuery = z.infer<typeof chartDataQuerySchema>

/**
 * HTTP query schema for Express query params (all strings).
 */
export const chartDataHttpQuerySchema = z
  .object({
    aggregation: z.enum(['count', 'sum', 'mean']).optional(),
    bucket_size: z.enum(['15m', '1h', '1d', '1w', '1M']).optional(),
    end: z.string().meta({ description: 'End of time range (ISO 8601 string)' }),
    pattern: z.string().optional().meta({ description: 'Pattern to match' }),
    source_type: chartDataSourceTypeSchema,
    start: z.string().meta({ description: 'Start of time range (ISO 8601 string)' }),
    tag_definition_id: z
      .string()
      .uuid()
      .optional()
      .meta({ description: 'Tag definition ID (alternative to pattern for tags)' }),
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
 * Response schema for chart data endpoint.
 */
export const chartDataResponseSchema = baseResponseSchema
  .extend({
    data: z
      .object({
        buckets: z.array(chartDataBucketSchema),
      })
      .optional(),
  })
  .meta({ id: 'ChartDataResponse', description: 'Response containing bucketed chart data' })

export type ChartDataResponse = z.infer<typeof chartDataResponseSchema>
