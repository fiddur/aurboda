import type { ChartDataBreakdownBucket, ChartDataBucket, ChartDataSourceType } from '@aurboda/api-spec'

import { expandActivityTypes, getHrZoneSecs, getSourceFilter, query } from '../db/index.ts'
import { categoryPathMatchSql } from './screentime-sql.ts'
import { getEffectiveHrZones } from './settings.ts'

/** Map bucket_size parameter to PostgreSQL date_trunc interval name (day and above). */
const bucketToTrunc: Record<string, string> = {
  '1M': 'month',
  '1d': 'day',
  '1w': 'week',
}

/**
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
  const p = bucket.params.length
  const params: unknown[] = [...bucket.params, metric, start, end]

  // Cumulative/derived metrics (steps, distance, calories, …) are stored from
  // multiple sources (raw per-minute + deduplicated daily aggregates + …), so
  // summing across all sources multiply-counts them. Restrict to the trusted
  // source(s) — the same rule the metric/period-summary read paths use — so the
  // chart (and challenges, which share this path) matches the real totals.
  const sourceFilter = getSourceFilter(metric)
  let sourceClause = ''
  if (sourceFilter !== null) {
    params.push(sourceFilter)
    sourceClause = ` AND source = ANY($${params.length})`
  }

  const result = await query(
    user,
    `SELECT ${bucket.expr} AS bucket_start,
            ${aggFn} AS value
       FROM time_series
      WHERE metric = $${p + 1}
        AND time BETWEEN $${p + 2} AND $${p + 3}
        AND deleted_at IS NULL${sourceClause}
      GROUP BY 1
      ORDER BY 1`,
    params,
  )
  return result.rows.map((row) => ({
    bucket_start: row.bucket_start.toISOString(),
    value: Number(row.value),
  }))
}

/**
 * Bucketed seconds-in-zone for an `hr_zone_<n>_sec` metric. HR-zone metrics are
 * not stored — they're computed from heart-rate samples + the user's effective
 * zones (same as the period summary / HR-zones widget), per bucket in SQL.
 */
const queryHrZoneBuckets = async (
  user: string,
  metric: string,
  start: string,
  end: string,
  bucketSize: ChartDataInput['bucket_size'],
): Promise<ChartDataBucket[]> => {
  const zoneIndex = Number.parseInt(metric.replace('hr_zone_', '').replace('_sec', ''), 10) as
    | 0
    | 1
    | 2
    | 3
    | 4
    | 5
  const { zones } = await getEffectiveHrZones(user)
  const rows = await getHrZoneSecs(user, new Date(start), new Date(end), zones, bucketSize)
  return rows.map((row) => ({
    bucket_start: (row.bucket_start as Date).toISOString(),
    value: row.secs[zoneIndex],
  }))
}

/**
 * Sums screentime span hours from `activities`, walking the category hierarchy
 * by path prefix (categoryPath='Work' matches 'Work', 'Work > Programming').
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
      WHERE deleted_at IS NULL
        AND superseded_by IS NULL
        AND end_time IS NOT NULL
        AND ${categoryPathMatchSql(bucket.params.length + 1)}
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
 * Route a metric-source query: HR-zone metrics are computed from heart-rate data,
 * `zone2_weekly` is a dashboard alias for zone-2 seconds, everything else is a
 * stored time-series metric.
 */
const queryMetricSource = async (
  user: string,
  pattern: string | undefined,
  start: string,
  end: string,
  bucketSize: ChartDataInput['bucket_size'],
  aggregation: 'count' | 'mean' | 'sum',
): Promise<ChartDataBucket[]> => {
  const metric = pattern === 'zone2_weekly' ? 'hr_zone_2_sec' : pattern
  if (!metric) return []
  if (/^hr_zone_[0-5]_sec$/.test(metric)) return queryHrZoneBuckets(user, metric, start, end, bucketSize)
  return queryMetricBuckets(user, metric, start, end, bucketSize, aggregation)
}

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
      buckets = await queryMetricSource(user, pattern, start, end, bucket_size, aggregation)
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
