/**
 * Time series data CRUD, bucketed aggregation, and statistics.
 */
import format from 'pg-format'
import { cumulativeMetrics, cumulativeSources, type MetricType, metricUnits } from '../schema'
import { query } from './connection'
import { querySplitByCumulative } from './cumulative-query'
import { parseMetricType } from './row-mappers'
import type { BucketedMetricData, DailyMetricAggregate, MetricStats, TimeSeriesPoint } from './types'

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

  await query(
    user,
    format(
      `INSERT INTO time_series (time, metric, value, unit, source)
       VALUES %L
       ON CONFLICT (time, metric, source) DO UPDATE SET value = EXCLUDED.value`,
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
  // For cumulative metrics (steps, distance, etc.), only use aggregate source
  // to avoid mixing raw readings with deduplicated daily totals
  const isCumulative = cumulativeMetrics.includes(metric as MetricType)

  const result = await query(
    user,
    isCumulative ?
      `SELECT time, value FROM time_series
       WHERE metric = $1 AND time >= $2 AND time <= $3
         AND source = ANY($4)
       ORDER BY time`
    : `SELECT time, value FROM time_series
       WHERE metric = $1 AND time >= $2 AND time <= $3
       ORDER BY time`,
    isCumulative ? [metric, start, end, cumulativeSources] : [metric, start, end],
  )

  return result.rows.map((row) => [new Date(row.time), row.value])
}

/** Like getTimeSeries but also returns the source field for each data point. */
export const getTimeSeriesWithSource = async (
  user: string,
  metric: string,
  start: Date,
  end: Date,
): Promise<{ time: Date; value: number; source: string }[]> => {
  const isCumulative = cumulativeMetrics.includes(metric as MetricType)

  const result = await query(
    user,
    isCumulative ?
      `SELECT time, value, source FROM time_series
       WHERE metric = $1 AND time >= $2 AND time <= $3
         AND source = ANY($4)
       ORDER BY time`
    : `SELECT time, value, source FROM time_series
       WHERE metric = $1 AND time >= $2 AND time <= $3
       ORDER BY time`,
    isCumulative ? [metric, start, end, cumulativeSources] : [metric, start, end],
  )

  return result.rows.map((row) => ({ source: row.source, time: new Date(row.time), value: row.value }))
}

export const getTimeSeriesMultiMetric = async (
  user: string,
  metrics: MetricType[],
  start: Date,
  end: Date,
): Promise<Record<MetricType, [Date, number][]>> => {
  if (metrics.length === 0) return {} as Record<MetricType, [Date, number][]>

  const rows = await querySplitByCumulative<{ metric: string; time: Date; value: number }>({
    cumulativeExtraParams: [cumulativeSources],
    mapRow: (row) => ({ metric: row.metric as string, time: new Date(row.time), value: row.value as number }),
    metrics,
    params: [start, end],
    queryFn: (sql, params) => query(user, sql, params),
    sqlCumulative: `SELECT time, metric, value FROM time_series
       WHERE metric = ANY($1) AND time >= $2 AND time <= $3
         AND source = ANY($4)
       ORDER BY metric, time`,
    sqlNonCumulative: `SELECT time, metric, value FROM time_series
       WHERE metric = ANY($1) AND time >= $2 AND time <= $3
       ORDER BY metric, time`,
  })

  const data: Record<string, [Date, number][]> = {}
  for (const row of rows) {
    if (!data[row.metric]) data[row.metric] = []
    data[row.metric].push([row.time, row.value])
  }

  return data as Record<MetricType, [Date, number][]>
}

// ============================================================================
// Aggregated Time Series Statistics
// ============================================================================

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
       WHERE metric = ANY($1) AND time >= $2 AND time <= $3${sourceFilter}
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

  // Sort by metric name for consistent ordering
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
       WHERE metric = ANY($1) AND time >= $2 AND time <= $3${sourceFilter}
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

  // Sort by metric and date for consistent ordering
  return results.sort((a, b) => {
    const metricCmp = a.metric.localeCompare(b.metric)
    if (metricCmp !== 0) return metricCmp
    return a.date.localeCompare(b.date)
  })
}

// ============================================================================
// Bucketed Time Series Aggregation
// ============================================================================

/**
 * Get bucketed/aggregated time series data for multiple metrics.
 *
 * Uses PostgreSQL's date_bin function to efficiently bucket data by time intervals.
 * Returns pre-aggregated statistics (avg, min, max, count) for each bucket.
 *
 * @param user - The username
 * @param metrics - Array of metric types to query
 * @param start - Start of time range
 * @param end - End of time range
 * @param bucketMinutes - Bucket size in minutes (e.g., 5, 15, 30, 60, 1440 for 1 day)
 */
// ============================================================================
// Time Series Deletion (manual source only)
// ============================================================================

export const deleteTimeSeriesPoint = async (user: string, metric: string, time: Date): Promise<boolean> => {
  const result = await query(
    user,
    `DELETE FROM time_series WHERE metric = $1 AND time = $2 AND source IN ('manual', 'aurboda')`,
    [metric, time],
  )
  return (result.rowCount ?? 0) > 0
}

export const deleteTimeSeriesMetric = async (user: string, metric: string): Promise<number> => {
  const result = await query(
    user,
    `DELETE FROM time_series WHERE metric = $1 AND source IN ('manual', 'aurboda')`,
    [metric],
  )
  return result.rowCount ?? 0
}

export const getTimeSeriesBucketed = async (
  user: string,
  metrics: MetricType[],
  start: Date,
  end: Date,
  bucketMinutes: number,
): Promise<BucketedMetricData[]> => {
  if (metrics.length === 0) return []

  const bucketedSql = (sourceFilter: string) => `SELECT
       date_bin($4::interval, time, $2) as bucket_start,
       metric,
       AVG(value) as avg,
       MIN(value) as min,
       MAX(value) as max,
       COUNT(*)::integer as count
     FROM time_series
     WHERE metric = ANY($1) AND time >= $2 AND time < $3${sourceFilter}
     GROUP BY bucket_start, metric
     ORDER BY bucket_start, metric`

  const mapRow = (row: { [key: string]: unknown }): BucketedMetricData => ({
    avg: row.avg !== null ? Number(row.avg) : 0,
    bucket_start: new Date(row.bucket_start as string),
    count: row.count as number,
    max: row.max !== null ? Number(row.max) : 0,
    metric: parseMetricType(row.metric as string),
    min: row.min !== null ? Number(row.min) : 0,
  })

  const interval = `${bucketMinutes} minutes`
  const results = await querySplitByCumulative<BucketedMetricData>({
    cumulativeExtraParams: [cumulativeSources],
    mapRow,
    metrics,
    params: [start, end, interval],
    queryFn: (sql, params) => query(user, sql, params),
    sqlCumulative: bucketedSql(`\n     AND source = ANY($5)`),
    sqlNonCumulative: bucketedSql(''),
  })

  return results.sort((a, b) => a.bucket_start.getTime() - b.bucket_start.getTime())
}
