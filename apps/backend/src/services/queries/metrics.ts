/**
 * Metric query functions.
 */

import type { CustomMetricDefinition } from '@aurboda/api-spec'

import { Temporal } from '@js-temporal/polyfill'

import type {
  BucketMetricStats,
  BucketSize,
  MetricBucket,
  QueryMetricsBucketedResult,
  QueryMetricsResult,
} from './types.ts'

import {
  getDistinctMetrics,
  getTimeSeries,
  getTimeSeriesBucketed,
  getTimeSeriesWithSource,
} from '../../db/index.ts'
import {
  getMetricAggregation,
  getMetricUnit,
  isContextualHrvMetric,
  type MetricType,
  metricUnits,
} from '../../schema.ts'
import { classifyHrvByContext, getHrvContextWindows, type HrvContext } from '../hrv-context.ts'

/**
 * Parse a bucket size string like '5m', '10s', '1h', '1d', '1M' into:
 * - interval: PostgreSQL interval string for date_bin() (e.g., '300 seconds')
 * - ms: bucket duration in milliseconds (for in-memory bucketing)
 */
export const parseBucketSize = (bucket: string): { interval: string; ms: number } => {
  const match = bucket.match(/^(\d+)([smhdwM])$/)
  if (!match) throw new Error(`Invalid bucket size: ${bucket}`)
  const n = parseInt(match[1], 10)
  const unit = match[2]
  switch (unit) {
    case 's':
      return { interval: `${n} seconds`, ms: n * 1000 }
    case 'm':
      return { interval: `${n} minutes`, ms: n * 60 * 1000 }
    case 'h':
      return { interval: `${n} hours`, ms: n * 60 * 60 * 1000 }
    case 'd':
      return { interval: `${n} days`, ms: n * 24 * 60 * 60 * 1000 }
    case 'w':
      return { interval: `${n} weeks`, ms: n * 7 * 24 * 60 * 60 * 1000 }
    case 'M':
      // Approximate months as 30 days for in-memory bucketing; PostgreSQL handles months properly
      return { interval: `${n} months`, ms: n * 30 * 24 * 60 * 60 * 1000 }
    default:
      throw new Error(`Invalid bucket size unit: ${unit}`)
  }
}

/**
 * Compute bucket start time for a given timestamp.
 * For buckets >= 1 day, uses Temporal for timezone-aware flooring (DST-correct).
 */
export const MS_PER_DAY = 24 * 60 * 60 * 1000
const getBucketStart = (time: Date, bucketMs: number, rangeStart: Date, tz: string = 'UTC'): Date => {
  // For daily+ buckets, floor to local midnight using Temporal (DST-correct)
  if (bucketMs >= MS_PER_DAY) {
    const instant = Temporal.Instant.fromEpochMilliseconds(time.getTime())
    const localMidnight = instant.toZonedDateTimeISO(tz).startOfDay()
    return new Date(localMidnight.epochMilliseconds)
  }
  // For sub-day buckets, use fixed-interval arithmetic (TZ doesn't affect sub-day boundaries)
  const startMs = rangeStart.getTime()
  const timeMs = time.getTime()
  const bucketIndex = Math.floor((timeMs - startMs) / bucketMs)
  return new Date(startMs + bucketIndex * bucketMs)
}

/**
 * Map contextual HRV metric names to their context.
 */
export const contextualHrvMetricToContext: Record<string, HrvContext> = {
  hrv_activity: 'activity',
  hrv_awake: 'awake',
  hrv_sleep: 'sleep',
}

/**
 * Compute bucketed aggregations for contextual HRV data.
 * Returns buckets with min/max/avg/count for filtered HRV samples.
 */
export const computeContextualHrvBuckets = (
  hrvData: [Date, number][],
  metric: MetricType,
  bucketMs: number,
  rangeStart: Date,
  tz: string = 'UTC',
): {
  bucket_start: Date
  metric: MetricType
  avg: number
  min: number
  max: number
  count: number
  sum: number
  first_time: Date
  last_time: Date
}[] => {
  if (hrvData.length === 0) return []

  // Group data by bucket
  const bucketMap = new Map<string, { values: number[]; times: Date[] }>()
  for (const [time, value] of hrvData) {
    const bucketStart = getBucketStart(time, bucketMs, rangeStart, tz)
    const key = bucketStart.toISOString()
    if (!bucketMap.has(key)) {
      bucketMap.set(key, { times: [], values: [] })
    }
    const entry = bucketMap.get(key)!
    entry.values.push(value)
    entry.times.push(time)
  }

  // Compute aggregations for each bucket
  return Array.from(bucketMap.entries()).map(([key, { values, times }]) => {
    const sum = values.reduce((a, b) => a + b, 0)
    const timeMs = times.map((t) => t.getTime())
    return {
      avg: sum / values.length,
      bucket_start: new Date(key),
      count: values.length,
      first_time: new Date(Math.min(...timeMs)),
      last_time: new Date(Math.max(...timeMs)),
      max: Math.max(...values),
      metric,
      min: Math.min(...values),
      sum,
    }
  })
}

/**
 * Get contextual HRV data for a single metric.
 */
async function getContextualHrvData(
  user: string,
  metric: MetricType,
  start: Date,
  end: Date,
): Promise<[Date, number][]> {
  const contextMap: Record<string, HrvContext> = {
    hrv_activity: 'activity',
    hrv_awake: 'awake',
    hrv_sleep: 'sleep',
  }
  const context = contextMap[metric]
  if (!context) return []

  // Fetch raw HRV data and context windows in parallel
  const [hrvData, { sleepWindows, activityWindows }] = await Promise.all([
    getTimeSeries(user, 'hrv_rmssd', start, end),
    getHrvContextWindows(user, start, end),
  ])

  if (hrvData.length === 0) return []

  // Classify and return the requested context
  const classified = classifyHrvByContext(hrvData, sleepWindows, activityWindows)
  return classified[context]
}

/**
 * Compute bucketed data for contextual HRV metrics.
 * Fetches raw hrv_rmssd data, classifies by context, and computes bucket aggregations.
 */
async function computeContextualHrvData(
  user: string,
  metrics: MetricType[],
  start: Date,
  end: Date,
  bucketMs: number,
  tz: string = 'UTC',
): Promise<
  {
    bucket_start: Date
    metric: MetricType
    avg: number
    min: number
    max: number
    count: number
    sum: number
    first_time: Date
    last_time: Date
  }[]
> {
  // Fetch raw HRV data and context windows in parallel
  const [hrvData, { sleepWindows, activityWindows }] = await Promise.all([
    getTimeSeries(user, 'hrv_rmssd', start, end),
    getHrvContextWindows(user, start, end),
  ])

  if (hrvData.length === 0) return []

  // Classify HRV data by context
  const classified = classifyHrvByContext(hrvData, sleepWindows, activityWindows)

  // Compute buckets for each requested contextual HRV metric
  const results: {
    bucket_start: Date
    metric: MetricType
    avg: number
    min: number
    max: number
    count: number
    sum: number
    first_time: Date
    last_time: Date
  }[] = []

  for (const metric of metrics) {
    const context = contextualHrvMetricToContext[metric]
    if (context) {
      const contextData = classified[context]
      const buckets = computeContextualHrvBuckets(contextData, metric, bucketMs, start, tz)
      results.push(...buckets)
    }
  }

  return results
}

/**
 * Query time series data for a single metric.
 * Supports both built-in and custom metrics via the customMetrics parameter.
 *
 * Supports contextual HRV metrics (hrv_sleep, hrv_activity, hrv_awake) which
 * are computed by filtering hrv_rmssd data by overlapping sleep/activity windows.
 */
export async function queryMetrics(
  user: string,
  metric: string,
  start: Date,
  end: Date,
  customMetrics: CustomMetricDefinition[] = [],
): Promise<QueryMetricsResult> {
  const unit = getMetricUnit(metric, customMetrics) ?? metricUnits[metric as MetricType] ?? ''

  // Handle contextual HRV metrics
  if (isContextualHrvMetric(metric as MetricType)) {
    const data = await getContextualHrvData(user, metric as MetricType, start, end)
    return {
      count: data.length,
      data: data.map(([time, value]) => ({ time: time.toISOString(), value })),
      metric,
      unit,
    }
  }

  const data = await getTimeSeriesWithSource(user, metric, start, end)

  return {
    count: data.length,
    data: data.map((d) => ({ source: d.source, time: d.time.toISOString(), value: d.value })),
    metric,
    unit,
  }
}

/**
 * Query bucketed/aggregated time series data for multiple metrics.
 *
 * Returns pre-aggregated buckets with min/max/avg/count/sum for each metric,
 * significantly reducing data size compared to raw time series queries.
 * Sum is included for cumulative metrics (steps, calories, etc.).
 *
 * Supports contextual HRV metrics (hrv_sleep, hrv_activity, hrv_awake) which
 * are computed by filtering hrv_rmssd data by overlapping sleep/activity windows.
 *
 * @param user - The username
 * @param metrics - Specific metrics to query (omit for all metrics in range)
 * @param start - Start of time range
 * @param end - End of time range
 * @param bucket - Bucket size string, e.g. '5m', '10s', '1h', '1d', '1M'
 * @param options.exclude - Metrics to exclude (useful when fetching all)
 * @param options.customMetrics - Custom metric definitions for validation
 */
export async function queryMetricsBucketed(
  user: string,
  metrics: MetricType[] | undefined,
  start: Date,
  end: Date,
  bucket: BucketSize,
  options: { customMetrics?: CustomMetricDefinition[]; exclude?: string[]; tz?: string } = {},
): Promise<QueryMetricsBucketedResult> {
  const { interval, ms: bucketMs } = parseBucketSize(bucket)
  const excludeSet = new Set(options.exclude ?? [])

  // Resolve which metrics to query
  let resolvedMetrics: MetricType[]
  if (metrics && metrics.length > 0) {
    resolvedMetrics = metrics.filter((m) => !excludeSet.has(m))
  } else {
    // Discover all metrics with data in the range
    const available = await getDistinctMetrics(user, start, end)
    resolvedMetrics = available.filter((m) => !excludeSet.has(m)) as MetricType[]
  }

  if (resolvedMetrics.length === 0) {
    return { bucket, buckets: [], end: end.toISOString(), start: start.toISOString() }
  }

  // Separate regular metrics from contextual HRV metrics
  const regularMetrics = resolvedMetrics.filter((m) => !isContextualHrvMetric(m))
  const contextualHrvMetricsRequested = resolvedMetrics.filter(isContextualHrvMetric)

  // Fetch regular bucketed data and contextual HRV data in parallel
  const tz = options.tz ?? 'UTC'
  const needsContextualHrv = contextualHrvMetricsRequested.length > 0
  const [regularData, contextualHrvDataResult] = await Promise.all([
    regularMetrics.length > 0 ? getTimeSeriesBucketed(user, regularMetrics, start, end, interval, tz) : [],
    needsContextualHrv
      ? computeContextualHrvData(user, contextualHrvMetricsRequested, start, end, bucketMs, tz)
      : [],
  ])

  // Combine all data
  const allData = [...regularData, ...contextualHrvDataResult]

  // Group data by bucket start time
  const bucketMap = new Map<string, MetricBucket>()

  for (const row of allData) {
    const bucketKey = row.bucket_start.toISOString()
    const bucketEndMs = row.bucket_start.getTime() + bucketMs
    const bucketEnd = new Date(bucketEndMs).toISOString()

    if (!bucketMap.has(bucketKey)) {
      bucketMap.set(bucketKey, {
        end: bucketEnd,
        metrics: {},
        start: bucketKey,
      })
    }

    const bucketEntry = bucketMap.get(bucketKey)!
    const stats: BucketMetricStats = {
      avg: row.avg,
      count: row.count,
      first_time: row.first_time.toISOString(),
      last_time: row.last_time.toISOString(),
      max: row.max,
      min: row.min,
    }
    // Include sum for cumulative metrics
    if (getMetricAggregation(row.metric) === 'sum') {
      stats.sum = row.sum
    }
    bucketEntry.metrics[row.metric] = stats
  }

  // Convert map to sorted array
  const buckets = Array.from(bucketMap.values()).sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  )

  return {
    bucket,
    buckets,
    end: end.toISOString(),
    start: start.toISOString(),
  }
}
