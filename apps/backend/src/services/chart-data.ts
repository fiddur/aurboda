/**
 * Chart data service — bucketed aggregation of tags, metrics,
 * productivity categories, and activity types.
 *
 * Returns time-bucketed data for bar chart visualizations.
 */

import type { ChartDataBucket, ChartDataSourceType } from '@aurboda/api-spec'

import { query } from '../db/index.ts'

/** Map bucket_size parameter to PostgreSQL date_trunc interval name. */
const bucketToTrunc: Record<string, string> = {
  '1M': 'month',
  '1d': 'day',
  '1w': 'week',
}

export interface ChartDataInput {
  aggregation: 'count' | 'mean' | 'sum'
  bucket_size: '1M' | '1d' | '1w'
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
  truncInterval: string,
): Promise<ChartDataBucket[]> => {
  const result = await query(
    user,
    `SELECT date_trunc($1, start_time AT TIME ZONE 'UTC') AS bucket_start,
            count(*) AS value
       FROM tags
      WHERE tag_definition_id = $2
        AND deleted_at IS NULL
        AND start_time BETWEEN $3 AND $4
      GROUP BY 1
      ORDER BY 1`,
    [truncInterval, tagDefinitionId, start, end],
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
  truncInterval: string,
): Promise<ChartDataBucket[]> => {
  const result = await query(
    user,
    `SELECT date_trunc($1, start_time AT TIME ZONE 'UTC') AS bucket_start,
            count(*) AS value
       FROM tags
      WHERE tag ~* $2
        AND deleted_at IS NULL
        AND start_time BETWEEN $3 AND $4
      GROUP BY 1
      ORDER BY 1`,
    [truncInterval, pattern, start, end],
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
  truncInterval: string,
  aggregation: 'count' | 'mean' | 'sum',
): Promise<ChartDataBucket[]> => {
  const aggFn = aggregation === 'mean' ? 'AVG(value)' : aggregation === 'sum' ? 'SUM(value)' : 'COUNT(*)'
  const result = await query(
    user,
    `SELECT date_trunc($1, time AT TIME ZONE 'UTC') AS bucket_start,
            ${aggFn} AS value
       FROM time_series
      WHERE metric = $2
        AND time BETWEEN $3 AND $4
      GROUP BY 1
      ORDER BY 1`,
    [truncInterval, metric, start, end],
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
  truncInterval: string,
): Promise<ChartDataBucket[]> => {
  const result = await query(
    user,
    `SELECT date_trunc($1, start_time AT TIME ZONE 'UTC') AS bucket_start,
            SUM(duration_sec) / 3600.0 AS value
       FROM productivity
      WHERE deleted_at IS NULL
        AND resolved_category IS NOT NULL
        AND array_to_string(resolved_category, ' > ') LIKE $2 || '%'
        AND start_time BETWEEN $3 AND $4
      GROUP BY 1
      ORDER BY 1`,
    [truncInterval, categoryPath, start, end],
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
  truncInterval: string,
): Promise<ChartDataBucket[]> => {
  const result = await query(
    user,
    `SELECT date_trunc($1, start_time AT TIME ZONE 'UTC') AS bucket_start,
            SUM(EXTRACT(EPOCH FROM (end_time - start_time))) / 3600.0 AS value
       FROM activities
      WHERE activity_type = 'exercise'
        AND deleted_at IS NULL
        AND (data->>'exerciseTypeName' = $2 OR data->>'exerciseType' = $2)
        AND start_time BETWEEN $3 AND $4
      GROUP BY 1
      ORDER BY 1`,
    [truncInterval, pattern, start, end],
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
  const truncInterval = bucketToTrunc[bucket_size] ?? 'day'

  switch (source_type) {
    case 'tag':
      if (tag_definition_id) {
        return queryTagsByDefinition(user, tag_definition_id, start, end, truncInterval)
      }
      if (!pattern) return []
      return queryTagsByPattern(user, pattern, start, end, truncInterval)

    case 'metric':
      if (!pattern) return []
      return queryMetricBuckets(user, pattern, start, end, truncInterval, aggregation)

    case 'productivity_category':
      if (!pattern) return []
      return queryProductivityCategoryBuckets(user, pattern, start, end, truncInterval)

    case 'activity_type':
      if (!pattern) return []
      return queryActivityTypeBuckets(user, pattern, start, end, truncInterval)
  }
}
