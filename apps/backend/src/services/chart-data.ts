/**
 * Chart data service — bucketed aggregation of activity types, metrics,
 * and productivity categories.
 *
 * Returns time-bucketed data for bar chart visualizations.
 */

import type { ChartDataBreakdownBucket, ChartDataBucket, ChartDataSourceType } from '@aurboda/api-spec'

import { expandActivityTypes, query } from '../db/index.ts'

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
  const dateBinIntervals: Record<string, string> = {
    '1m': '1 minute',
    '5m': '5 minutes',
    '15m': '15 minutes',
  }
  if (dateBinIntervals[bucketSize]) {
    return {
      expr: `date_bin($${startIdx}::interval, ${column} AT TIME ZONE 'UTC', '2000-01-01'::timestamptz)`,
      params: [dateBinIntervals[bucketSize]],
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
  activity_type_id?: string
  aggregation: 'count' | 'mean' | 'sum'
  breakdown_fields?: string[]
  bucket_size: '1m' | '5m' | '15m' | '1M' | '1d' | '1h' | '1w'
  end: string
  pattern?: string
  source_type: ChartDataSourceType
  start: string
  /** @deprecated Use activity_type_id instead */
  tag_definition_id?: string
}

/** Query bucketed activity counts by activity_type name (formerly tag_definition_id). */
const queryActivitiesByType = async (
  user: string,
  activityType: string,
  start: string,
  end: string,
  bucketSize: string,
): Promise<ChartDataBucket[]> => {
  const types = await expandActivityTypes(user, [activityType])
  const bucket = buildBucketExpr(bucketSize, 'start_time', 1)
  const result = await query(
    user,
    `SELECT ${bucket.expr} AS bucket_start,
            count(*) AS value
       FROM activities
      WHERE activity_type = ANY($${bucket.params.length + 1})
        AND deleted_at IS NULL
        AND superseded_by IS NULL
        AND start_time BETWEEN $${bucket.params.length + 2} AND $${bucket.params.length + 3}
      GROUP BY 1
      ORDER BY 1`,
    [...bucket.params, types, start, end],
  )
  return result.rows.map((row) => ({
    bucket_start: row.bucket_start.toISOString(),
    value: Number(row.value),
  }))
}

/** Query bucketed activity counts by activity_type regex pattern. */
const queryActivitiesByTypePattern = async (
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
       FROM activities
      WHERE activity_type ~* $${bucket.params.length + 1}
        AND deleted_at IS NULL
        AND superseded_by IS NULL
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

/**
 * Query bucketed productivity category hours.
 *
 * Reads from the `activities` table (activity_type='screentime') so a
 * prefix match on data->>'category_path' walks the category hierarchy
 * (e.g. categoryPath='Work' matches 'Work', 'Work > Programming', etc.).
 * Activities are derived from productivity records during sync (#648) and
 * historical data is filled in by a one-shot backfill.
 */
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
            SUM(EXTRACT(EPOCH FROM (end_time - start_time))) / 3600.0 AS value
       FROM activities
      WHERE activity_type = 'screentime'
        AND deleted_at IS NULL
        AND superseded_by IS NULL
        AND end_time IS NOT NULL
        AND (
          data->>'category_path' = $${bucket.params.length + 1}
          OR starts_with(data->>'category_path', $${bucket.params.length + 1} || ' > ')
        )
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
  aggregation = 'sum',
): Promise<ChartDataBucket[]> => {
  const types = await expandActivityTypes(user, [pattern])
  const bucket = buildBucketExpr(bucketSize, 'start_time', 1)
  const valueExpr =
    aggregation === 'count'
      ? 'count(*)'
      : "SUM(EXTRACT(EPOCH FROM (COALESCE(end_time, start_time + interval '1 hour') - start_time))) / 3600.0"
  const result = await query(
    user,
    `SELECT ${bucket.expr} AS bucket_start,
            ${valueExpr} AS value
       FROM activities
      WHERE activity_type = ANY($${bucket.params.length + 1})
        AND deleted_at IS NULL
        AND superseded_by IS NULL
        AND start_time BETWEEN $${bucket.params.length + 2} AND $${bucket.params.length + 3}
      GROUP BY 1
      ORDER BY 1`,
    [...bucket.params, types, start, end],
  )
  return result.rows.map((row) => ({
    bucket_start: row.bucket_start.toISOString(),
    value: Number(row.value),
  }))
}

/**
 * Query activity type data broken down by one or more data fields.
 * Multiple fields produce compound series keys like "spanda / external_monitor".
 */
const queryActivityTypeBreakdown = async (
  user: string,
  activityType: string,
  fields: string[],
  start: string,
  end: string,
  bucketSize: string,
  aggregation = 'sum',
): Promise<{ buckets: ChartDataBreakdownBucket[]; series: string[] }> => {
  // Sanitize all field names
  for (const field of fields) {
    if (!/^[a-z][a-z0-9_]*$/.test(field)) return { buckets: [], series: [] }
  }

  const types = await expandActivityTypes(user, [activityType])
  const bucket = buildBucketExpr(bucketSize, 'start_time', 1)
  const valueExpr =
    aggregation === 'count'
      ? 'count(*)'
      : "SUM(EXTRACT(EPOCH FROM (COALESCE(end_time, start_time + interval '1 hour') - start_time))) / 3600.0"

  // Build SELECT and GROUP BY for each breakdown field
  const fieldSelects = fields.map((f, i) => `COALESCE(data->>'${f}', '(none)') AS field_${i}`)
  const fieldGroupBys = fields.map((_, i) => `field_${i}`)

  const result = await query(
    user,
    `SELECT ${bucket.expr} AS bucket_start,
            ${fieldSelects.join(', ')},
            ${valueExpr} AS value
       FROM activities
      WHERE activity_type = ANY($${bucket.params.length + 1})
        AND deleted_at IS NULL
        AND superseded_by IS NULL
        AND start_time BETWEEN $${bucket.params.length + 2} AND $${bucket.params.length + 3}
      GROUP BY 1, ${fieldGroupBys.join(', ')}
      ORDER BY 1`,
    [...bucket.params, types, start, end],
  )

  // Pivot rows into breakdown buckets with compound series keys
  const seriesSet = new Set<string>()
  const bucketMap = new Map<string, Record<string, number>>()
  for (const row of result.rows) {
    const bucketStart = (row.bucket_start as Date).toISOString()
    const keyParts = fields.map((_, i) => row[`field_${i}`] as string)
    const seriesKey = keyParts.join(' / ')
    const value = Number(row.value)
    seriesSet.add(seriesKey)
    const existing = bucketMap.get(bucketStart) ?? {}
    existing[seriesKey] = value
    bucketMap.set(bucketStart, existing)
  }

  const series = [...seriesSet].sort()
  const buckets: ChartDataBreakdownBucket[] = [...bucketMap.entries()].map(([bucketStart, seriesData]) => ({
    bucket_start: bucketStart,
    series: seriesData,
  }))

  return { buckets, series }
}

/**
 * Get bucketed chart data for the given source type and parameters.
 */
export const getChartData = async (
  user: string,
  input: ChartDataInput,
): Promise<{
  buckets: (ChartDataBucket | ChartDataBreakdownBucket)[]
  breakdown_fields?: string[]
  breakdown_series?: string[]
}> => {
  const { activity_type_id, aggregation, bucket_size, end, pattern, source_type, start, tag_definition_id } =
    input

  // Breakdown mode for activity types
  if (
    source_type === 'activity_type' &&
    pattern &&
    input.breakdown_fields &&
    input.breakdown_fields.length > 0
  ) {
    const result = await queryActivityTypeBreakdown(
      user,
      pattern,
      input.breakdown_fields,
      start,
      end,
      bucket_size,
      aggregation,
    )
    return {
      breakdown_fields: input.breakdown_fields,
      breakdown_series: result.series,
      buckets: result.buckets,
    }
  }

  let buckets: ChartDataBucket[]

  switch (source_type) {
    case 'tag': {
      // 'tag' is a backward-compat alias for activity_type count
      const typeId = activity_type_id ?? tag_definition_id
      if (typeId) {
        buckets = await queryActivitiesByType(user, typeId, start, end, bucket_size)
      } else if (pattern) {
        buckets = await queryActivitiesByTypePattern(user, pattern, start, end, bucket_size)
      } else {
        buckets = []
      }
      break
    }

    case 'metric':
      buckets = pattern ? await queryMetricBuckets(user, pattern, start, end, bucket_size, aggregation) : []
      break

    case 'productivity_category':
      buckets = pattern ? await queryProductivityCategoryBuckets(user, pattern, start, end, bucket_size) : []
      break

    case 'activity_type':
      buckets = pattern
        ? await queryActivityTypeBuckets(user, pattern, start, end, bucket_size, aggregation)
        : []
      break

    default:
      buckets = []
  }

  return { buckets }
}
