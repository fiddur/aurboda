import type { HrZoneSecs, HrZoneThresholds } from '@aurboda/api-spec'

import format from 'pg-format'

import type { BucketedMetricData, DailyMetricAggregate, MetricStats, TimeSeriesPoint } from './types.ts'

import { MAX_GAP_SECONDS, SINGLE_SAMPLE_SECONDS } from '../hr-zone-constants.ts'
import {
  aurbodaOnlyMetrics,
  aurbodaOnlySources,
  cumulativeMetrics,
  cumulativeSources,
  type MetricType,
  metricUnits,
} from '../schema.ts'
import { query, withUserTransaction } from './connection.ts'
import { querySplitByCumulative } from './cumulative-query.ts'
import { parseMetricType } from './row-mappers.ts'

/**
 * Get the source filter for a single metric: aurboda-only, cumulative sources,
 * or all sources (null). Reads of cumulative/derived metrics are restricted to
 * these sources, so a write from any other source would be unqueryable — write
 * paths reuse this to reject such writes (see #802).
 */
export const getSourceFilter = (metric: string): string[] | null => {
  if (aurbodaOnlyMetrics.includes(metric as MetricType)) return aurbodaOnlySources
  if (cumulativeMetrics.includes(metric as MetricType)) return cumulativeSources
  return null
}

export const insertTimeSeries = async (user: string, points: TimeSeriesPoint[]) => {
  if (points.length === 0) return

  // Deduplicate points by (time, metric, source) to avoid PostgreSQL ON CONFLICT error
  // when the same key appears multiple times in a single INSERT
  const deduped = new Map<string, TimeSeriesPoint>()
  for (const p of points) {
    const key = `${p.time.toISOString()}|${p.metric}|${p.source}`
    deduped.set(key, p) // Last value wins
  }

  const values = Array.from(deduped.values()).map((p) => [
    p.time,
    p.metric,
    p.value,
    p.unit ?? metricUnits[p.metric as MetricType],
    p.source,
  ])

  // `updated_at` defaults to NOW() on insert and moves only when a re-sent
  // point actually changes the value, so it answers "when did this number last
  // change" rather than "when was it last written".
  await query(
    user,
    format(
      `INSERT INTO time_series (time, metric, value, unit, source)
       VALUES %L
       ON CONFLICT (time, metric, source) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = CASE
           WHEN time_series.value IS DISTINCT FROM EXCLUDED.value THEN NOW()
           ELSE time_series.updated_at
         END
       WHERE time_series.deleted_at IS NULL`,
      values,
    ),
  )
}

export const getTimeSeries = async (
  user: string,
  metric: string,
  start: Date,
  end: Date,
): Promise<[Date, number][]> => {
  const sources = getSourceFilter(metric)

  const result = await query(
    user,
    sources
      ? `SELECT time, value FROM time_series
       WHERE metric = $1 AND time >= $2 AND time <= $3 AND deleted_at IS NULL
         AND source = ANY($4)
       ORDER BY time`
      : `SELECT time, value FROM time_series
       WHERE metric = $1 AND time >= $2 AND time <= $3 AND deleted_at IS NULL
       ORDER BY time`,
    sources ? [metric, start, end, sources] : [metric, start, end],
  )

  return result.rows.map((row) => [new Date(row.time), row.value])
}

export const getTimeSeriesWithSource = async (
  user: string,
  metric: string,
  start: Date,
  end: Date,
): Promise<{ time: Date; value: number; source: string }[]> => {
  const sources = getSourceFilter(metric)

  const result = await query(
    user,
    sources
      ? `SELECT time, value, source FROM time_series
       WHERE metric = $1 AND time >= $2 AND time <= $3 AND deleted_at IS NULL
         AND source = ANY($4)
       ORDER BY time`
      : `SELECT time, value, source FROM time_series
       WHERE metric = $1 AND time >= $2 AND time <= $3 AND deleted_at IS NULL
       ORDER BY time`,
    sources ? [metric, start, end, sources] : [metric, start, end],
  )

  return result.rows.map((row) => ({ source: row.source, time: new Date(row.time), value: row.value }))
}

/** Get time series data for a specific metric and source, bypassing the cumulative source filter. */
export const getTimeSeriesBySource = async (
  user: string,
  metric: string,
  source: string,
  start: Date,
  end: Date,
): Promise<[Date, number][]> => {
  const result = await query(
    user,
    `SELECT time, value FROM time_series
     WHERE metric = $1 AND source = $2 AND time >= $3 AND time <= $4 AND deleted_at IS NULL
     ORDER BY time`,
    [metric, source, start, end],
  )
  return result.rows.map((row) => [new Date(row.time), row.value])
}

/**
 * Get the sum of a metric across ALL sources for a date range.
 * This is a last-resort fallback for cumulative metrics when no aggregate data exists.
 * Note: may double-count if multiple apps contributed to Health Connect.
 */
export const getRawDailySum = async (
  user: string,
  metric: string,
  start: Date,
  end: Date,
): Promise<number> => {
  const result = await query(
    user,
    `SELECT COALESCE(SUM(value), 0) as total FROM time_series
     WHERE metric = $1 AND time >= $2 AND time <= $3 AND deleted_at IS NULL`,
    [metric, start, end],
  )
  return Number(result.rows[0].total)
}

export interface TimeSeriesEntry {
  metric: string
  time: Date
  value: number
  unit: string
  source: string
}

/** Supports built-in and custom metric names. */
export const getTimeSeriesEntriesMultiMetric = async (
  user: string,
  metrics: string[],
  start: Date,
  end: Date,
): Promise<TimeSeriesEntry[]> => {
  if (metrics.length === 0) return []

  const result = await query(
    user,
    `SELECT time, metric, value, unit, source FROM time_series
     WHERE metric = ANY($1) AND time >= $2 AND time <= $3 AND deleted_at IS NULL
     ORDER BY metric, time`,
    [metrics, start, end],
  )

  return result.rows.map((row) => ({
    metric: row.metric as string,
    source: row.source as string,
    time: new Date(row.time),
    unit: row.unit as string,
    value: row.value as number,
  }))
}

/**
 * Get the latest (most recent, regardless of age) value for each metric.
 * Returns one entry per metric that has any data; metrics with no data are absent.
 */
export const getLatestMetricValuesMulti = async (
  user: string,
  metrics: string[],
): Promise<Map<string, { time: Date; value: number; unit: string; source: string }>> => {
  const map = new Map<string, { time: Date; value: number; unit: string; source: string }>()
  if (metrics.length === 0) return map

  const result = await query(
    user,
    `SELECT DISTINCT ON (metric) metric, time, value, unit, source
     FROM time_series
     WHERE metric = ANY($1) AND deleted_at IS NULL
     ORDER BY metric, time DESC`,
    [metrics],
  )

  for (const row of result.rows) {
    map.set(row.metric as string, {
      source: row.source as string,
      time: new Date(row.time),
      unit: row.unit as string,
      value: row.value as number,
    })
  }
  return map
}

export const getTimeSeriesMultiMetric = async (
  user: string,
  metrics: MetricType[],
  start: Date,
  end: Date,
): Promise<Partial<Record<MetricType, [Date, number][]>>> => {
  if (metrics.length === 0) return {}

  const rows = await querySplitByCumulative<{ metric: string; time: Date; value: number }>({
    cumulativeExtraParams: [cumulativeSources],
    mapRow: (row) => ({ metric: row.metric as string, time: new Date(row.time), value: row.value as number }),
    metrics,
    params: [start, end],
    queryFn: (sql, params) => query(user, sql, params),
    sqlCumulative: `SELECT time, metric, value FROM time_series
       WHERE metric = ANY($1) AND time >= $2 AND time <= $3 AND deleted_at IS NULL
         AND source = ANY($4)
       ORDER BY metric, time`,
    sqlNonCumulative: `SELECT time, metric, value FROM time_series
       WHERE metric = ANY($1) AND time >= $2 AND time <= $3 AND deleted_at IS NULL
       ORDER BY metric, time`,
  })

  const data: Partial<Record<MetricType, [Date, number][]>> = {}
  for (const row of rows) {
    const metric = row.metric as MetricType
    const list = data[metric] ?? []
    list.push([row.time, row.value])
    data[metric] = list
  }
  return data
}

export const getTimeSeriesStats = async (
  user: string,
  metrics: string[],
  start: Date,
  end: Date,
): Promise<MetricStats[]> => {
  if (metrics.length === 0) return []

  const statsSql = (sourceFilter: string) => `SELECT
         metric,
         COUNT(*)::integer as count,
         MIN(value) as min,
         MAX(value) as max,
         AVG(value) as avg,
         STDDEV_POP(value) as stddev,
         MAX(unit) as unit
       FROM time_series
       WHERE metric = ANY($1) AND time >= $2 AND time <= $3 AND deleted_at IS NULL${sourceFilter}
       GROUP BY metric
       ORDER BY metric`

  const mapRow = (row: { [key: string]: unknown }): MetricStats => ({
    avg: row.avg !== null ? Number(row.avg) : 0,
    count: row.count as number,
    max: row.max !== null ? Number(row.max) : 0,
    metric: row.metric as string,
    min: row.min !== null ? Number(row.min) : 0,
    stddev: row.stddev !== null ? Number(row.stddev) : 0,
    unit: row.unit as string,
  })

  const results = await querySplitByCumulative<MetricStats>({
    cumulativeExtraParams: [cumulativeSources],
    mapRow,
    metrics,
    params: [start, end],
    queryFn: (sql, params) => query(user, sql, params),
    sqlCumulative: statsSql(`\n         AND source = ANY($4)`),
    sqlNonCumulative: statsSql(''),
  })

  return results.sort((a, b) => a.metric.localeCompare(b.metric))
}

export const getDailyAggregates = async (
  user: string,
  metrics: string[],
  start: Date,
  end: Date,
): Promise<DailyMetricAggregate[]> => {
  if (metrics.length === 0) return []

  const dailySql = (sourceFilter: string) => `SELECT
         DATE(time) as date,
         metric,
         AVG(value) as avg,
         SUM(value) as sum
       FROM time_series
       WHERE metric = ANY($1) AND time >= $2 AND time <= $3 AND deleted_at IS NULL${sourceFilter}
       GROUP BY DATE(time), metric
       ORDER BY metric, date`

  const mapRow = (row: { [key: string]: unknown }): DailyMetricAggregate => ({
    avg: Number(row.avg),
    date: (row.date as Date).toISOString().split('T')[0],
    metric: row.metric as string,
    sum: Number(row.sum),
  })

  const results = await querySplitByCumulative<DailyMetricAggregate>({
    cumulativeExtraParams: [cumulativeSources],
    mapRow,
    metrics,
    params: [start, end],
    queryFn: (sql, params) => query(user, sql, params),
    sqlCumulative: dailySql(`\n         AND source = ANY($4)`),
    sqlNonCumulative: dailySql(''),
  })

  return results.sort((a, b) => {
    const metricCmp = a.metric.localeCompare(b.metric)
    if (metricCmp !== 0) return metricCmp
    return a.date.localeCompare(b.date)
  })
}

/** Get the min and max time for a metric (across all sources). Returns null if no data exists. */
export const getMetricTimeRange = async (
  user: string,
  metric: string,
): Promise<{ min: Date; max: Date } | null> => {
  const result = await query(
    user,
    `SELECT MIN(time) as min_time, MAX(time) as max_time FROM time_series WHERE metric = $1 AND deleted_at IS NULL`,
    [metric],
  )
  if (result.rows.length === 0 || result.rows[0].min_time === null) return null
  return { max: new Date(result.rows[0].max_time), min: new Date(result.rows[0].min_time) }
}

export const deleteTimeSeriesPoint = async (
  user: string,
  metric: string,
  time: Date,
  source: string,
): Promise<boolean> => {
  const result = await query(
    user,
    `UPDATE time_series SET deleted_at = NOW() WHERE metric = $1 AND time = $2 AND source = $3 AND deleted_at IS NULL`,
    [metric, time, source],
  )
  return (result.rowCount ?? 0) > 0
}

export const deleteTimeSeriesMetric = async (user: string, metric: string): Promise<number> => {
  const result = await query(
    user,
    `UPDATE time_series SET deleted_at = NOW() WHERE metric = $1 AND source IN ('manual', 'aurboda', 'aurboda_gap_fill') AND deleted_at IS NULL`,
    [metric],
  )
  return result.rowCount ?? 0
}

/**
 * Hard-delete time_series rows in [start, end) for a given (metric, source).
 *
 * Used by "wipe and rewrite" rebuild paths (e.g. calorie recompute, training-
 * load rebuild) where the caller will immediately re-insert fresh rows. We
 * cannot soft-delete here: `insertTimeSeries`' ON CONFLICT clause has a
 * `WHERE deleted_at IS NULL` filter (to preserve user-initiated tombstones
 * against background re-syncs), which means a soft-deleted row would block
 * the re-insert from writing the new value — the row stays invisible.
 * A real DELETE removes the row so the subsequent INSERT lands cleanly.
 *
 * For single-row user-initiated deletes (e.g. `deleteMetric`), keep using
 * soft-delete: that path's intent is to preserve the tombstone.
 */
export const deleteTimeSeriesBySource = async (
  user: string,
  metric: string,
  source: string,
  start: Date,
  end: Date,
): Promise<number> => {
  const result = await query(
    user,
    `DELETE FROM time_series WHERE metric = $1 AND source = $2 AND time >= $3 AND time < $4`,
    [metric, source, start, end],
  )
  return result.rowCount ?? 0
}

export const getTimeSeriesBucketed = async (
  user: string,
  metrics: MetricType[],
  start: Date,
  end: Date,
  interval: string,
  tz: string = 'UTC',
): Promise<BucketedMetricData[]> => {
  if (metrics.length === 0) return []

  // For timezone-aware bucketing, convert timestamps to local time before binning,
  // then convert back. This ensures daily buckets align to local midnight (and
  // handles DST correctly — spring-forward days are 23h, fall-back days are 25h).
  const bucketedSql = (sourceFilter: string) => `SELECT
       date_bin($4::interval, time AT TIME ZONE $5, ($2 AT TIME ZONE $5)::timestamp) AT TIME ZONE $5 as bucket_start,
       metric,
       AVG(value) as avg,
       MIN(value) as min,
       MAX(value) as max,
       SUM(value) as sum,
       COUNT(*)::integer as count,
       MIN(time) as first_time,
       MAX(time) as last_time
     FROM time_series
     WHERE metric = ANY($1) AND time >= $2 AND time < $3 AND deleted_at IS NULL${sourceFilter}
     GROUP BY bucket_start, metric
     ORDER BY bucket_start, metric`

  const mapRow = (row: { [key: string]: unknown }): BucketedMetricData => ({
    avg: row.avg !== null ? Number(row.avg) : 0,
    bucket_start: new Date(row.bucket_start as string),
    count: row.count as number,
    first_time: new Date(row.first_time as string),
    last_time: new Date(row.last_time as string),
    max: row.max !== null ? Number(row.max) : 0,
    metric: parseMetricType(row.metric as string),
    min: row.min !== null ? Number(row.min) : 0,
    sum: row.sum !== null ? Number(row.sum) : 0,
  })

  const results = await querySplitByCumulative<BucketedMetricData>({
    cumulativeExtraParams: [cumulativeSources],
    mapRow,
    metrics,
    params: [start, end, interval, tz],
    queryFn: (sql, params) => query(user, sql, params),
    sqlCumulative: bucketedSql(`\n     AND source = ANY($6)`),
    sqlNonCumulative: bucketedSql(''),
  })

  return results.sort((a, b) => a.bucket_start.getTime() - b.bucket_start.getTime())
}

export const getDistinctMetrics = async (user: string, start: Date, end: Date): Promise<string[]> => {
  const result = await query(
    user,
    'SELECT DISTINCT metric FROM time_series WHERE time >= $1 AND time < $2 AND deleted_at IS NULL',
    [start, end],
  )
  return result.rows.map((row) => row.metric as string).sort()
}

/** Most recent value of `metric` in `[since, now]`, or undefined when there is none. */
export const getLatestTimeSeriesValue = async (
  user: string,
  metric: string,
  since: Date,
): Promise<number | undefined> => {
  const sources = getSourceFilter(metric)
  const params: unknown[] = [metric, since, new Date()]
  if (sources) params.push(sources)

  const result = await query(
    user,
    `SELECT value FROM time_series
     WHERE metric = $1 AND time >= $2 AND time <= $3 AND deleted_at IS NULL${sources ? ' AND source = ANY($4)' : ''}
     ORDER BY time DESC
     LIMIT 1`,
    params,
  )
  return result.rows.length > 0 ? (result.rows[0].value as number) : undefined
}

/**
 * The `time_series` rows inside each window of a preceding `unnest(…) AS w(…, s, e, …)`, as `ts`.
 * Written as a plain range join, the planner can't see how narrow the windows are: it estimates a
 * sizeable share of the table per window and picks one scan over every sample of the metric, each
 * checked against every window (seconds on a year of heart rate, even for two windows). The lateral
 * subquery makes it an index range scan per window; OFFSET 0 keeps it from being flattened back
 * into the join.
 */
const samplesPerWindow = (conditions: string): string =>
  `CROSS JOIN LATERAL (
         SELECT time, source, value
           FROM time_series
          WHERE ${conditions}
         OFFSET 0
       ) ts`

/**
 * Runs a `samplesPerWindow` query with JIT off. The planner still overestimates each window
 * (it assumes a fixed share of the table), and the inflated cost switches JIT compilation on, which
 * for these short index range scans takes longer than the query itself.
 */
const queryWindowSamples = (user: string, sql: string, params: unknown[]) =>
  withUserTransaction(user, async (tx) => {
    await query(tx, 'SET LOCAL jit = off')
    return query(tx, sql, params)
  })

/**
 * Per-window equivalent of `getTimeSeriesBucketed(user, [metric], w.start, w.end, interval)`'s
 * `[bucket_start, avg]` series (UTC bins anchored at each window's start), in one query.
 * The result is index-aligned with `windows`.
 */
export const getTimeSeriesBucketedAvgForWindows = async (
  user: string,
  metric: string,
  windows: { start: Date; end: Date }[],
  interval: string,
): Promise<[Date, number][][]> => {
  if (windows.length === 0) return []

  const sources = getSourceFilter(metric)
  const params: unknown[] = [windows.map((w) => w.start), windows.map((w) => w.end), metric, interval]
  if (sources) params.push(sources)

  const result = await queryWindowSamples(
    user,
    `SELECT w.i::int AS i,
            date_bin($4::interval, ts.time AT TIME ZONE 'UTC', (w.s AT TIME ZONE 'UTC')::timestamp)
              AT TIME ZONE 'UTC' AS bucket_start,
            AVG(ts.value) AS avg
       FROM unnest($1::timestamptz[], $2::timestamptz[]) WITH ORDINALITY AS w(s, e, i)
       ${samplesPerWindow(`metric = $3 AND time >= w.s AND time < w.e AND deleted_at IS NULL${sources ? ' AND source = ANY($5)' : ''}`)}
      GROUP BY w.i, bucket_start
      ORDER BY w.i, bucket_start`,
    params,
  )

  const series: [Date, number][][] = windows.map(() => [])
  for (const row of result.rows) {
    series[(row.i as number) - 1].push([new Date(row.bucket_start as string), Number(row.avg)])
  }
  return series
}

export type HrZoneBucket = 'none' | '1m' | '5m' | '15m' | '1h' | '1d' | '1w' | '1M'

/** Fixed-width bins count from 2000-01-01Z; calendar units truncate in UTC whatever the session TimeZone. */
const hrZoneBucketExprs: Record<HrZoneBucket, string> = {
  '15m': "date_bin('15 minutes', time, '2000-01-01T00:00:00Z'::timestamptz)",
  '1M': "date_trunc('month', time, 'UTC')",
  '1d': "date_trunc('day', time, 'UTC')",
  '1h': "date_trunc('hour', time, 'UTC')",
  '1m': "date_bin('1 minute', time, '2000-01-01T00:00:00Z'::timestamptz)",
  '1w': "date_trunc('week', time, 'UTC')",
  '5m': "date_bin('5 minutes', time, '2000-01-01T00:00:00Z'::timestamptz)",
  none: 'NULL::timestamptz',
}

/**
 * Zone seconds per `b` over a preceding `hr(b, time, source, value)` CTE, the SQL counterpart of
 * `computeHrZoneSecs`: each sample counts the gap to the next one (capped at MAX_GAP_SECONDS, $3),
 * the last one the mean of those gaps, a lone sample SINGLE_SAMPLE_SECONDS ($4). $5–$9 are the
 * zone 1–5 thresholds. LEAST ignores NULLs, so the last sample's missing gap has to stay NULL
 * explicitly for AVG to skip it.
 */
const HR_ZONE_SECS_BY_B = `s AS (
       SELECT b, value,
              CASE WHEN lead(time) OVER w IS NULL THEN NULL
                   ELSE LEAST(EXTRACT(EPOCH FROM (lead(time) OVER w - time))::float8, $3::float8)
              END AS gap
         FROM hr
       WINDOW w AS (PARTITION BY b ORDER BY time, source)
     ), g AS (
       SELECT b, COALESCE(gap, AVG(gap) OVER (PARTITION BY b), $4::float8) AS secs,
              CASE WHEN value >= $9 THEN 5
                   WHEN value >= $8 THEN 4
                   WHEN value >= $7 THEN 3
                   WHEN value >= $6 THEN 2
                   WHEN value >= $5 THEN 1
                   ELSE 0
              END AS zone
         FROM s
     )
     SELECT b, COUNT(*)::int AS sample_count,
            COALESCE(SUM(secs) FILTER (WHERE zone = 0), 0) AS z0,
            COALESCE(SUM(secs) FILTER (WHERE zone = 1), 0) AS z1,
            COALESCE(SUM(secs) FILTER (WHERE zone = 2), 0) AS z2,
            COALESCE(SUM(secs) FILTER (WHERE zone = 3), 0) AS z3,
            COALESCE(SUM(secs) FILTER (WHERE zone = 4), 0) AS z4,
            COALESCE(SUM(secs) FILTER (WHERE zone = 5), 0) AS z5
       FROM g
      GROUP BY b
      ORDER BY b`

const hrZoneParams = (zones: HrZoneThresholds): unknown[] => [
  MAX_GAP_SECONDS,
  SINGLE_SAMPLE_SECONDS,
  zones[1],
  zones[2],
  zones[3],
  zones[4],
  zones[5],
]

const zoneSecsFromRow = (row: Record<string, unknown>): HrZoneSecs => ({
  0: Number(row.z0),
  1: Number(row.z1),
  2: Number(row.z2),
  3: Number(row.z3),
  4: Number(row.z4),
  5: Number(row.z5),
})

/**
 * `computeHrZoneSecs` over the heart_rate samples in `[start, end]`, per bucket. Buckets without
 * samples are absent, so an empty range returns `[]` for every bucket size including 'none'.
 */
export const getHrZoneSecs = async (
  user: string,
  start: Date,
  end: Date,
  zones: HrZoneThresholds,
  bucket: HrZoneBucket = 'none',
): Promise<{ bucket_start: Date | null; sample_count: number; secs: HrZoneSecs }[]> => {
  const sources = getSourceFilter('heart_rate')
  const params: unknown[] = [start, end, ...hrZoneParams(zones)]
  if (sources) params.push(sources)

  const result = await query(
    user,
    `WITH hr AS (
       SELECT ${hrZoneBucketExprs[bucket]} AS b, time, source, value
         FROM time_series
        WHERE metric = 'heart_rate' AND time >= $1 AND time <= $2 AND deleted_at IS NULL${sources ? ' AND source = ANY($10)' : ''}
     ), ${HR_ZONE_SECS_BY_B}`,
    params,
  )

  return result.rows.map((row) => ({
    bucket_start: row.b === null ? null : new Date(row.b as string),
    sample_count: row.sample_count as number,
    secs: zoneSecsFromRow(row),
  }))
}

/**
 * `getHrZoneSecs(user, w.start, w.end, zones)` for every window in one query, index-aligned with
 * `windows`; undefined where a window has no samples.
 */
export const getHrZoneSecsForWindows = async (
  user: string,
  windows: { start: Date; end: Date }[],
  zones: HrZoneThresholds,
): Promise<(HrZoneSecs | undefined)[]> => {
  if (windows.length === 0) return []

  const sources = getSourceFilter('heart_rate')
  const params: unknown[] = [windows.map((w) => w.start), windows.map((w) => w.end), ...hrZoneParams(zones)]
  if (sources) params.push(sources)

  const result = await queryWindowSamples(
    user,
    `WITH hr AS (
       SELECT w.i AS b, ts.time, ts.source, ts.value
         FROM unnest($1::timestamptz[], $2::timestamptz[]) WITH ORDINALITY AS w(s, e, i)
         ${samplesPerWindow(`metric = 'heart_rate' AND time >= w.s AND time <= w.e AND deleted_at IS NULL${sources ? ' AND source = ANY($10)' : ''}`)}
     ), ${HR_ZONE_SECS_BY_B}`,
    params,
  )

  const secs: (HrZoneSecs | undefined)[] = windows.map(() => undefined)
  for (const row of result.rows) secs[Number(row.b) - 1] = zoneSecsFromRow(row)
  return secs
}

export interface ValueDistributionRow {
  min: number
  q1: number
  median: number
  q3: number
  max: number
  avg: number
  sample_count: number
}

/**
 * Five-number summary and mean of the positive `metric` samples in each keyed `[start, end]`
 * window. Windows sharing a key are pooled, and a sample inside several of them counts once.
 * Quartiles interpolate linearly, like the web's `fiveNumberSummary`. Keys without samples are
 * absent from the result.
 */
export const getTimeSeriesDistributions = async (
  user: string,
  metric: string,
  windows: { key: string; start: Date; end: Date }[],
): Promise<Map<string, ValueDistributionRow>> => {
  if (windows.length === 0) return new Map()

  const sources = getSourceFilter(metric)
  const params: unknown[] = [
    windows.map((w) => w.key),
    windows.map((w) => w.start),
    windows.map((w) => w.end),
    metric,
  ]
  if (sources) params.push(sources)

  const result = await queryWindowSamples(
    user,
    `WITH samples AS (
       SELECT DISTINCT w.k, ts.time, ts.source, ts.value
         FROM unnest($1::text[], $2::timestamptz[], $3::timestamptz[]) AS w(k, s, e)
         ${samplesPerWindow(`metric = $4 AND time >= w.s AND time <= w.e AND deleted_at IS NULL AND value > 0${sources ? ' AND source = ANY($5)' : ''}`)}
     )
     SELECT k, COUNT(*)::int AS sample_count, MIN(value) AS min, MAX(value) AS max, AVG(value) AS avg,
            percentile_cont(ARRAY[0.25, 0.5, 0.75]) WITHIN GROUP (ORDER BY value) AS q
       FROM samples
      GROUP BY k`,
    params,
  )

  return new Map(
    result.rows.map((row) => {
      const [q1, median, q3] = (row.q as number[]).map(Number)
      return [
        row.k as string,
        {
          avg: Number(row.avg),
          max: Number(row.max),
          median: median!,
          min: Number(row.min),
          q1: q1!,
          q3: q3!,
          sample_count: row.sample_count as number,
        },
      ]
    }),
  )
}
