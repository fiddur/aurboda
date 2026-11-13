/**
 * Chart data schemas for bucketed aggregation of activity types, metrics,
 * productivity categories, and more.
 *
 * Supports daily, weekly, and monthly bucketing with count/sum/mean aggregation.
 */

import { z } from 'zod'

import { activityMeasureSchema, isSummedActivityMeasure } from './activity-measures.ts'
import { baseResponseSchema, dataFieldPathSchema } from './common.ts'
import { ianaTimezoneSchema } from './timezone.ts'

export const chartDataSourceTypeSchema = z
  .enum(['tag', 'metric', 'productivity_category', 'activity_type'])
  .meta({
    description:
      "Type of data source for chart data query. 'tag' is a deprecated alias for 'activity_type'. 'productivity_category' selects screentime by category path (pattern 'Work > Programming', sub-categories included); each screentime category is also an activity type (its activity_type_name), usable with 'activity_type'.",
    example: 'activity_type',
    id: 'ChartDataSourceType',
  })

export type ChartDataSourceType = z.infer<typeof chartDataSourceTypeSchema>

export const chartDataBucketSizeSchema = z.enum(['1m', '5m', '15m', '1h', '1d', '1w', '1M']).meta({
  description:
    'Bucket size for aggregation: 1 minute, 5 minutes, 15 minutes, hourly, daily, weekly, or monthly',
  example: '1d',
  id: 'ChartDataBucketSize',
})

export type ChartDataBucketSize = z.infer<typeof chartDataBucketSizeSchema>

export const chartDataAggregationSchema = z.enum(['count', 'sum', 'mean', 'max']).meta({
  description: 'Aggregation method: count, sum, mean or max',
  example: 'count',
  id: 'ChartDataAggregation',
})

export type ChartDataAggregation = z.infer<typeof chartDataAggregationSchema>

const chartDataTzSchema = ianaTimezoneSchema.optional().meta({
  description:
    'IANA timezone for bucket alignment (e.g. "Europe/Stockholm"). Daily, weekly and monthly buckets ' +
    'start at local midnight, local Monday and the local 1st; hourly buckets at the local hour. ' +
    'Defaults to UTC.',
  example: 'Europe/Stockholm',
})

/**
 * For an activity type with list items (strength sets): chart a measure over its sessions instead of
 * their duration or count, optionally only the items of one value (one exercise).
 */
const chartMeasureShape = {
  filter_field: dataFieldPathSchema.optional().meta({
    description: 'With measure: an item path (sets.exercise) whose items the measure is taken over',
  }),
  filter_value: z.string().optional().meta({
    description: 'With filter_field: the item value to keep (compared trimmed, case-insensitively)',
  }),
  measure: activityMeasureSchema.optional().meta({
    description:
      "For activity_type sources: aggregate this measure of each session's list items per bucket instead of duration or count — e.g. measure=e1rm with aggregation=max for the highest estimated one-rep max per week",
  }),
}

export const ITEM_BREAKDOWN_NEEDS_MEASURE = 'breaking down by an item path needs a measure'

export const itemBreakdownWithoutMeasure = (
  breakdownFields: string[] | undefined,
  measure: unknown,
): boolean => !measure && (breakdownFields ?? []).some((field) => field.includes('.'))

export const MUSCLE_GROUP_SUFFIX = '.muscle_group'

/** The item path (`sets.exercise`) when `field` is a muscle-group breakdown, `<list>.<item>.muscle_group`. */
export const muscleGroupBreakdownPath = (field: string): string | undefined => {
  if (!field.endsWith(MUSCLE_GROUP_SUFFIX)) return undefined
  const segments = field.split('.')
  return segments.length === 3 && segments.every(Boolean) ? segments.slice(0, 2).join('.') : undefined
}

export const MUSCLE_GROUP_BREAKDOWN_NEEDS_SUMMED_MEASURE =
  'a muscle-group breakdown needs measure set_count, volume or total_reps'

export const muscleGroupBreakdownWithoutSummedMeasure = (
  breakdownFields: string[] | undefined,
  measure: unknown,
): boolean =>
  (breakdownFields ?? []).some((field) => muscleGroupBreakdownPath(field) !== undefined) &&
  !isSummedActivityMeasure(measure)

export const MUSCLE_GROUP_BREAKDOWN_WITH_ITEM_PATH =
  'a muscle-group breakdown cannot be combined with another item path'

export const muscleGroupBreakdownWithItemPath = (breakdownFields: string[] | undefined): boolean => {
  const fields = breakdownFields ?? []
  return (
    fields.some((field) => muscleGroupBreakdownPath(field) !== undefined) &&
    fields.filter((field) => field.includes('.')).length > 1
  )
}

/** The first rule a chart query's breakdown breaks, as its message. */
export const chartBreakdownError = (
  breakdownFields: string[] | undefined,
  measure: unknown,
): string | undefined => {
  if (itemBreakdownWithoutMeasure(breakdownFields, measure)) return ITEM_BREAKDOWN_NEEDS_MEASURE
  if (muscleGroupBreakdownWithoutSummedMeasure(breakdownFields, measure)) {
    return MUSCLE_GROUP_BREAKDOWN_NEEDS_SUMMED_MEASURE
  }
  if (muscleGroupBreakdownWithItemPath(breakdownFields)) return MUSCLE_GROUP_BREAKDOWN_WITH_ITEM_PATH
  return undefined
}

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
        'Data fields to break down by (for activity_type source). Multiple fields produce compound series keys. With a measure, an item path such as sets.exercise gives one series per exercise. With measure set_count, volume or total_reps, sets.exercise.muscle_group gives one series per muscle group, each set counted by the exercise\'s recruitment weight (bench press: 1 set for the chest, 0.5 for the shoulders); exercises not in the catalogue fall under "Not in the catalogue". It combines with scalar fields, not with another item path.',
    }),
    ...chartMeasureShape,
    tz: chartDataTzSchema,
  })
  .refine((query) => !itemBreakdownWithoutMeasure(query.breakdown_fields, query.measure), {
    message: ITEM_BREAKDOWN_NEEDS_MEASURE,
    path: ['breakdown_fields'],
  })
  .refine((query) => !muscleGroupBreakdownWithoutSummedMeasure(query.breakdown_fields, query.measure), {
    message: MUSCLE_GROUP_BREAKDOWN_NEEDS_SUMMED_MEASURE,
    path: ['breakdown_fields'],
  })
  .refine((query) => !muscleGroupBreakdownWithItemPath(query.breakdown_fields), {
    message: MUSCLE_GROUP_BREAKDOWN_WITH_ITEM_PATH,
    path: ['breakdown_fields'],
  })
  .meta({ id: 'ChartDataQuery', description: 'Query parameters for bucketed chart data' })

export type ChartDataQuery = z.infer<typeof chartDataQuerySchema>

/**
 * HTTP query schema for Express query params (all strings).
 */
export const chartDataHttpQuerySchema = z
  .object({
    aggregation: chartDataAggregationSchema.optional(),
    breakdown_fields: z.string().optional().meta({
      description:
        'Comma-separated data fields (or item paths) to break down by. With measure set_count, volume or total_reps, sets.exercise.muscle_group gives one series per muscle group, each set counted by the exercise\'s recruitment weight; exercises not in the catalogue fall under "Not in the catalogue".',
    }),
    ...chartMeasureShape,
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
    tz: chartDataTzSchema,
  })
  .meta({ id: 'ChartDataHttpQuery', description: 'HTTP query parameters for chart data endpoint' })

export type ChartDataHttpQuery = z.infer<typeof chartDataHttpQuerySchema>

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
