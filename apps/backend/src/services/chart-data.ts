/**
 * Chart data service — bucketed aggregation of tags, metrics,
 * productivity categories, and activity types.
 *
 * Returns time-bucketed data for bar chart visualizations.
 */

import type { ChartDataBucket, ChartDataSourceType } from '@aurboda/api-spec'

import { query } from '../db/index.ts'

/** Map bucket_size parameter to PostgreSQL date_trunc interval name (day and above). */
const bucketToTrunc: Record<string, string> = {
  '1M': 'month',
  '1d': 'day',
  '1w': 'week',
}

/**
 * Build a SQL expression for bucketing a timestamp column.
 *
 * For sub-day buckets (15m, 1h) we use PG 14+ `date_bin` which requires an
 * origin timestamp.  For day/week/month we keep the simpler `date_trunc`.
 *
 * Returns `{ expr, params }` where `expr` is the SQL fragment with positional
 * placeholders starting at `$<startIdx>` and `params` are the corresponding
 * bind values.
 */
export const buildBucketExpr = (
  bucketSize: string,
  column: string,
  startIdx: number,
): { expr: string; params: string[] } => {
  if (bucketSize === '15m') {
    return {
      expr: `date_bin($${startIdx}::interval, ${column} AT TIME ZONE 'UTC', '2000-01-01'::timestamptz)`,
      params: ['15 minutes'],
    }
  }
  if (bucketSize === '1h') {
    return {
      expr: `date_trunc($${startIdx}, ${column} AT TIME ZONE 'UTC')`,
      params: ['hour'],
    }
  }
  const truncInterval = bucketToTrunc[bucketSize] ?? 'day'
  return {
    expr: `date_trunc($${startIdx}, ${column} AT TIME ZONE 'UTC')`,
    params: [truncInterval],
  }
}

export interface ChartDataInput {
  aggregation: 'count' | 'mean' | 'sum'
  bucket_size: '15m' | '1M' | '1d' | '1h' | '1w'
  end: string
  pattern?: string
  source_type: ChartDataSourceType
  start: string
  tag_definition_id?: string
}

/** Query bucketed tag counts by tag_definition_id. */
const queryTagsByDefinition = async (
  user: string,
  tagDefinitionId: string,
  start: string,
  end: string,
  bucketSize: string,
): Promise<ChartDataBucket[]> => {
  const bucket = buildBucketExpr(bucketSize, 'start_time', 1)
  const result = await query(
    user,
    `SELECT ${bucket.expr} AS bucket_start,
            count(*) AS value
       FROM tags
      WHERE tag_definition_id = $${bucket.params.length + 1}
        AND deleted_at IS NULL
        AND start_time BETWEEN $${bucket.params.length + 2} AND $${bucket.params.length + 3}
      GROUP BY 1
      ORDER BY 1`,
    [...bucket.params, tagDefinitionId, start, end],
  )
  return result.rows.map((row) => ({
    bucket_start: row.bucket_start.toISOString(),
    value: Number(row.value),
  }))
}

/** Query bucketed tag counts by regex pattern. */
const queryTagsByPattern = async (
  user: string,
  pattern: string,
  start: string,
  end: string,
  bucketSize: string,
): Promise<ChartDataBucket[]> => {
  const bucket = buildBucketExpr(bucketSize, 'start_time', 1)
  const result = await query(
    user,
    `SELECT ${bucket.expr} AS bucket_start,
            count(*) AS value
       FROM tags
      WHERE tag ~* $${bucket.params.length + 1}
        AND deleted_at IS NULL
        AND start_time BETWEEN $${bucket.params.length + 2} AND $${bucket.params.length + 3}
      GROUP BY 1
      ORDER BY 1`,
    [...bucket.params, pattern, start, end],
  )
  return result.rows.map((row) => ({
    bucket_start: row.bucket_start.toISOString(),
    value: Number(row.value),
  }))
}

/** Query bucketed metric data with the specified aggregation. */
const queryMetricBuckets = async (
  user: string,
  metric: string,
  start: string,
  end: string,
  bucketSize: string,
  aggregation: 'count' | 'mean' | 'sum',
): Promise<ChartDataBucket[]> => {
  const aggFn = aggregation === 'mean' ? 'AVG(value)' : aggregation === 'sum' ? 'SUM(value)' : 'COUNT(*)'
  const bucket = buildBucketExpr(bucketSize, 'time', 1)
  const result = await query(
    user,
    `SELECT ${bucket.expr} AS bucket_start,
            ${aggFn} AS value
       FROM time_series
      WHERE metric = $${bucket.params.length + 1}
        AND time BETWEEN $${bucket.params.length + 2} AND $${bucket.params.length + 3}
      GROUP BY 1
      ORDER BY 1`,
    [...bucket.params, metric, start, end],
  )
  return result.rows.map((row) => ({
    bucket_start: row.bucket_start.toISOString(),
    value: Number(row.value),
  }))
}

/** Query bucketed productivity category hours. */
const queryProductivityCategoryBuckets = async (
  user: string,
  categoryPath: string,
  start: string,
  end: string,
  bucketSize: string,
): Promise<ChartDataBucket[]> => {
  const bucket = buildBucketExpr(bucketSize, 'start_time', 1)
  const result = await query(
    user,
    `SELECT ${bucket.expr} AS bucket_start,
            SUM(duration_sec) / 3600.0 AS value
       FROM productivity
      WHERE deleted_at IS NULL
        AND resolved_category IS NOT NULL
        AND array_to_string(resolved_category, ' > ') LIKE $${bucket.params.length + 1} || '%'
        AND start_time BETWEEN $${bucket.params.length + 2} AND $${bucket.params.length + 3}
      GROUP BY 1
      ORDER BY 1`,
    [...bucket.params, categoryPath, start, end],
  )
  return result.rows.map((row) => ({
    bucket_start: row.bucket_start.toISOString(),
    value: Number(row.value),
  }))
}

/** Query bucketed activity type hours. */
const queryActivityTypeBuckets = async (
  user: string,
  pattern: string,
  start: string,
  end: string,
  bucketSize: string,
): Promise<ChartDataBucket[]> => {
  const bucket = buildBucketExpr(bucketSize, 'start_time', 1)
  const result = await query(
    user,
    `SELECT ${bucket.expr} AS bucket_start,
            SUM(EXTRACT(EPOCH FROM (end_time - start_time))) / 3600.0 AS value
       FROM activities
      WHERE activity_type = 'exercise'
        AND deleted_at IS NULL
        AND (data->>'exerciseTypeName' = $${bucket.params.length + 1} OR data->>'exerciseType' = $${bucket.params.length + 1})
        AND start_time BETWEEN $${bucket.params.length + 2} AND $${bucket.params.length + 3}
      GROUP BY 1
      ORDER BY 1`,
    [...bucket.params, pattern, start, end],
  )
  return result.rows.map((row) => ({
    bucket_start: row.bucket_start.toISOString(),
    value: Number(row.value),
  }))
}

/**
 * Get bucketed chart data for the given source type and parameters.
 */
export const getChartData = async (user: string, input: ChartDataInput): Promise<ChartDataBucket[]> => {
  const { aggregation, bucket_size, end, pattern, source_type, start, tag_definition_id } = input

  switch (source_type) {
    case 'tag':
      if (tag_definition_id) {
        return queryTagsByDefinition(user, tag_definition_id, start, end, bucket_size)
      }
      if (!pattern) return []
      return queryTagsByPattern(user, pattern, start, end, bucket_size)

    case 'metric':
      if (!pattern) return []
      return queryMetricBuckets(user, pattern, start, end, bucket_size, aggregation)

    case 'productivity_category':
      if (!pattern) return []
      return queryProductivityCategoryBuckets(user, pattern, start, end, bucket_size)

    case 'activity_type':
      if (!pattern) return []
      return queryActivityTypeBuckets(user, pattern, start, end, bucket_size)
  }
}
