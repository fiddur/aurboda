import type {
  ActivityMeasure,
  ActivityMeasures,
  ChartDataAggregation,
  ChartDataBreakdownBucket,
  ChartDataBucket,
  ChartDataSourceType,
} from '@aurboda/api-spec'

import { buildBucketExpr } from '../db/bucket-expr.ts'
import { expandActivityTypes, getBucketStarts, getHrZoneSecs, getSourceFilter, query } from '../db/index.ts'
import { parseFieldPath } from './activity-measures.ts'
import {
  type MeasuredActivity,
  type MeasureFilter,
  measureFilter,
  measuresByItemValue,
  queryMeasuredActivities,
} from './queries/activity-measure-series.ts'
import { categoryPathMatchSql } from './screentime-sql.ts'
import { getEffectiveHrZones } from './settings.ts'

export { buildBucketExpr }

export interface ChartDataInput {
  activity_type_id?: string
  aggregation: ChartDataAggregation
  breakdown_fields?: string[]
  bucket_size: '1m' | '5m' | '15m' | '1M' | '1d' | '1h' | '1w'
  end: string
  /** An item path and value whose items the measure is taken over (or a scalar field filtering sessions). */
  filter_field?: string
  filter_value?: string
  /** With an activity_type source: aggregate this list-item measure per bucket instead of duration or count. */
  measure?: ActivityMeasure
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

const metricAggFns: Record<ChartDataAggregation, string> = {
  count: 'COUNT(*)',
  max: 'MAX(value)',
  mean: 'AVG(value)',
  sum: 'SUM(value)',
}

const hoursExpr =
  "EXTRACT(EPOCH FROM (COALESCE(end_time, start_time + interval '1 hour') - start_time)) / 3600.0"

/** Activity-type buckets are hours, except count; mean has always meant the summed hours. */
const activityValueExprs: Record<ChartDataAggregation, string> = {
  count: 'count(*)',
  max: `MAX(${hoursExpr})`,
  mean: `SUM(${hoursExpr})`,
  sum: `SUM(${hoursExpr})`,
}

const queryMetricBuckets = async (
  user: string,
  metric: string,
  start: string,
  end: string,
  bucketSize: string,
  tz: string,
  aggregation: ChartDataAggregation,
): Promise<ChartDataBucket[]> => {
  const aggFn = metricAggFns[aggregation]
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
  aggregation: ChartDataAggregation = 'sum',
): Promise<ChartDataBucket[]> => {
  const types = await expandActivityTypes(user, [pattern])
  const bucket = buildBucketExpr(bucketSize, 'start_time', 1, tz)
  const valueExpr = activityValueExprs[aggregation]
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
  aggregation: ChartDataAggregation = 'sum',
): Promise<{ buckets: ChartDataBreakdownBucket[]; series: string[] }> => {
  // Sanitize all field names
  for (const field of fields) {
    if (!/^[a-z][a-z0-9_]*$/.test(field)) return { buckets: [], series: [] }
  }

  const types = await expandActivityTypes(user, [activityType])
  const bucket = buildBucketExpr(bucketSize, 'start_time', 1, tz)
  const valueExpr = activityValueExprs[aggregation]

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

const aggregateValues = (values: number[], aggregation: ChartDataAggregation): number => {
  if (aggregation === 'count') return values.length
  if (aggregation === 'max') return Math.max(...values)
  const sum = values.reduce((acc, v) => acc + v, 0)
  return aggregation === 'mean' ? sum / values.length : sum
}

interface SeriesValue {
  /** Series identity: item values compare normalised. */
  key: string
  name: string
  value: number
}

/** One field's part of a series: an item value carries the measures over its items. */
interface SeriesPart {
  key: string
  name: string
  measures?: ActivityMeasures
}

/** One activity's contributions per breakdown series: the cross product of its fields' values. */
const seriesValues = (
  m: MeasuredActivity,
  fields: string[],
  measure: ActivityMeasure,
  filter: MeasureFilter | undefined,
): SeriesValue[] => {
  const partsPerField = fields.map((field): SeriesPart[] => {
    if (parseFieldPath(field).key === undefined) {
      const name = String(m.activity.data?.[field] ?? '(none)')
      return [{ key: `field:${name}`, name }]
    }
    return measuresByItemValue(m.activity, field, filter).map((g) => ({
      key: `item:${g.normalized}`,
      measures: g.measures,
      name: g.value,
    }))
  })
  const combos = partsPerField.reduce<SeriesPart[][]>(
    (acc, parts) => acc.flatMap((combo) => parts.map((p) => [...combo, p])),
    [[]],
  )
  return combos.flatMap((combo) => {
    const value = (combo.findLast((p) => p.measures)?.measures ?? m.measures)[measure]
    if (value === undefined) return []
    return [
      { key: combo.map((p) => p.key).join('\u0000'), name: combo.map((p) => p.name).join(' / '), value },
    ]
  })
}

/**
 * Charts a list-item measure of an activity type's sessions: each session's measure (over the
 * filtered items when filtered) aggregated per bucket, buckets bucketed by the same SQL as the other
 * sources. With breakdown fields, an item path gives one series per item value (spelled as in the
 * latest session) and a scalar field one per field value.
 */
const queryMeasureChart = async (
  user: string,
  input: ChartDataInput & { measure: ActivityMeasure; pattern: string },
  tz: string,
): Promise<{ buckets: (ChartDataBucket | ChartDataBreakdownBucket)[]; series?: string[] }> => {
  const { aggregation, measure } = input
  const filter = measureFilter(input.filter_field, input.filter_value)
  const fields = input.breakdown_fields?.length ? input.breakdown_fields : undefined
  const measured = await queryMeasuredActivities(
    user,
    input.pattern,
    new Date(input.start),
    new Date(input.end),
    filter,
  )
  const bucketStarts = await getBucketStarts(
    user,
    measured.flatMap((m) => m.activity.id ?? []),
    input.bucket_size,
    tz,
  )

  const names = new Map<string, string>()
  const byBucket = new Map<number, Map<string, number[]>>()
  for (const m of measured) {
    const bucketStart = m.activity.id === undefined ? undefined : bucketStarts.get(m.activity.id)
    if (!bucketStart) continue
    const contributions = fields
      ? seriesValues(m, fields, measure, filter)
      : m.measures[measure] === undefined
        ? []
        : [{ key: '', name: '', value: m.measures[measure] }]
    if (contributions.length === 0) continue
    const series = byBucket.get(bucketStart.getTime()) ?? new Map<string, number[]>()
    for (const { key, name, value } of contributions) {
      names.set(key, name)
      series.set(key, [...(series.get(key) ?? []), value])
    }
    byBucket.set(bucketStart.getTime(), series)
  }

  const ordered = [...byBucket.entries()].toSorted(([a], [b]) => a - b)
  if (!fields) {
    return {
      buckets: ordered.map(([time, series]) => ({
        bucket_start: new Date(time).toISOString(),
        value: aggregateValues(series.get('') ?? [], aggregation),
      })),
    }
  }
  return {
    buckets: ordered.map(([time, series]) => ({
      bucket_start: new Date(time).toISOString(),
      series: Object.fromEntries(
        [...series].map(([key, values]) => [names.get(key) ?? key, aggregateValues(values, aggregation)]),
      ),
    })),
    series: [...new Set(names.values())].toSorted(),
  }
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
  aggregation: ChartDataAggregation,
): Promise<ChartDataBucket[]> => {
  const metric = pattern === 'zone2_weekly' ? 'hr_zone_2_sec' : pattern
  if (!metric) return []
  if (/^hr_zone_[0-5]_sec$/.test(metric)) return queryHrZoneBuckets(user, metric, start, end, bucketSize, tz)
  return queryMetricBuckets(user, metric, start, end, bucketSize, tz, aggregation)
}

export interface ChartDataResult {
  buckets: (ChartDataBucket | ChartDataBreakdownBucket)[]
  breakdown_fields?: string[]
  breakdown_series?: string[]
}

/** An activity type's buckets: a list-item measure, a breakdown by fields, or plain duration or count. */
const queryActivityTypeChart = async (
  user: string,
  input: ChartDataInput,
  pattern: string,
  tz: string,
): Promise<ChartDataResult> => {
  const { aggregation, breakdown_fields, bucket_size, end, measure, start } = input

  if (measure) {
    const result = await queryMeasureChart(user, { ...input, measure, pattern }, tz)
    return result.series
      ? { breakdown_fields, breakdown_series: result.series, buckets: result.buckets }
      : { buckets: result.buckets }
  }

  if (breakdown_fields && breakdown_fields.length > 0) {
    const result = await queryActivityTypeBreakdown(
      user,
      pattern,
      breakdown_fields,
      start,
      end,
      bucket_size,
      tz,
      aggregation,
    )
    return { breakdown_fields, breakdown_series: result.series, buckets: result.buckets }
  }

  return { buckets: await queryActivityTypeBuckets(user, pattern, start, end, bucket_size, tz, aggregation) }
}

export const getChartData = async (user: string, input: ChartDataInput): Promise<ChartDataResult> => {
  const { activity_type_id, aggregation, bucket_size, end, pattern, source_type, start, tag_definition_id } =
    input
  const tz = input.tz ?? 'UTC'

  if (source_type === 'activity_type') {
    return pattern ? queryActivityTypeChart(user, input, pattern, tz) : { buckets: [] }
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

    default:
      buckets = []
  }

  return { buckets }
}
