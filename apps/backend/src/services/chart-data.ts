import type { ChartDataBreakdownBucket, ChartDataBucket, ChartDataSourceType } from '@aurboda/api-spec'

import { expandActivityTypes, getHrZoneSecs, getSourceFilter, query } from '../db/index.ts'
import { categoryPathMatchSql } from './screentime-sql.ts'
import { getEffectiveHrZones } from './settings.ts'

const truncUnits: Record<string, string> = {
  '1M': 'month',
  '1d': 'day',
  '1h': 'hour',
  '1w': 'week',
}

/**
 * Bucket starts come back as timestamptz. Calendar units and hours truncate in `tz` (PG's
 * three-argument `date_trunc`, which handles DST and half-hour offsets). Sub-hour bins stay on a
 * UTC origin: every current offset is a whole number of quarter hours (+05:45 included), so they
 * already fall on local clock boundaries, and binning local wall time instead would fold the
 * repeated DST hour into one bin.
 *
 * `tz` is only ever a bind value: `params` fill `$<startIdx>`, `$<startIdx + 1>`, ….
 */
export const buildBucketExpr = (
  bucketSize: string,
  column: string,
  startIdx: number,
  tz = 'UTC',
): { expr: string; params: string[] } => {
  const binIntervals: Record<string, string> = {
    '1m': '1 minute',
    '5m': '5 minutes',
    '15m': '15 minutes',
  }
  if (binIntervals[bucketSize]) {
    return {
      expr: `date_bin($${startIdx}::interval, ${column}, '2000-01-01T00:00:00Z'::timestamptz)`,
      params: [binIntervals[bucketSize]],
    }
  }
  return {
    expr: `date_trunc($${startIdx}::text, ${column}, $${startIdx + 1}::text)`,
    params: [truncUnits[bucketSize] ?? 'day', tz],
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
  /** IANA zone the buckets align to; UTC when absent. */
  tz?: string
}

const queryActivitiesByType = async (
  user: string,
  activityType: string,
  start: string,
  end: string,
  bucketSize: string,
  tz: string,
): Promise<ChartDataBucket[]> => {
  const types = await expandActivityTypes(user, [activityType])
  const bucket = buildBucketExpr(bucketSize, 'start_time', 1, tz)
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
  tz: string,
): Promise<ChartDataBucket[]> => {
  const bucket = buildBucketExpr(bucketSize, 'start_time', 1, tz)
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
  tz: string,
  aggregation: 'count' | 'mean' | 'sum',
): Promise<ChartDataBucket[]> => {
  const aggFn = aggregation === 'mean' ? 'AVG(value)' : aggregation === 'sum' ? 'SUM(value)' : 'COUNT(*)'
  const bucket = buildBucketExpr(bucketSize, 'time', 1, tz)
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
  tz: string,
): Promise<ChartDataBucket[]> => {
  const zoneIndex = Number.parseInt(metric.replace('hr_zone_', '').replace('_sec', ''), 10) as
    | 0
    | 1
    | 2
    | 3
    | 4
    | 5
  const { zones } = await getEffectiveHrZones(user)
  const rows = await getHrZoneSecs(user, new Date(start), new Date(end), zones, bucketSize, tz)
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
  tz: string,
): Promise<ChartDataBucket[]> => {
  const bucket = buildBucketExpr(bucketSize, 'start_time', 1, tz)
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
  tz: string,
  aggregation = 'sum',
): Promise<ChartDataBucket[]> => {
  const types = await expandActivityTypes(user, [pattern])
  const bucket = buildBucketExpr(bucketSize, 'start_time', 1, tz)
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
  tz: string,
  aggregation = 'sum',
): Promise<{ buckets: ChartDataBreakdownBucket[]; series: string[] }> => {
  // Sanitize all field names
  for (const field of fields) {
    if (!/^[a-z][a-z0-9_]*$/.test(field)) return { buckets: [], series: [] }
  }

  const types = await expandActivityTypes(user, [activityType])
  const bucket = buildBucketExpr(bucketSize, 'start_time', 1, tz)
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
  tz: string,
  aggregation: 'count' | 'mean' | 'sum',
): Promise<ChartDataBucket[]> => {
  const metric = pattern === 'zone2_weekly' ? 'hr_zone_2_sec' : pattern
  if (!metric) return []
  if (/^hr_zone_[0-5]_sec$/.test(metric)) return queryHrZoneBuckets(user, metric, start, end, bucketSize, tz)
  return queryMetricBuckets(user, metric, start, end, bucketSize, tz, aggregation)
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
  const tz = input.tz ?? 'UTC'

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
      tz,
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
        buckets = await queryActivitiesByType(user, typeId, start, end, bucket_size, tz)
      } else if (pattern) {
        buckets = await queryActivitiesByTypePattern(user, pattern, start, end, bucket_size, tz)
      } else {
        buckets = []
      }
      break
    }

    case 'metric':
      buckets = await queryMetricSource(user, pattern, start, end, bucket_size, tz, aggregation)
      break

    case 'productivity_category':
      buckets = pattern
        ? await queryProductivityCategoryBuckets(user, pattern, start, end, bucket_size, tz)
        : []
      break

    case 'activity_type':
      buckets = pattern
        ? await queryActivityTypeBuckets(user, pattern, start, end, bucket_size, tz, aggregation)
        : []
      break

    default:
      buckets = []
  }

  return { buckets }
}
