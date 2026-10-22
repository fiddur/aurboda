import type { QueryMetricsBucketedResponse } from '@aurboda/api-spec'

import { type BarBucketSize, barWindowStart, nextBarWindowStart } from './barWindows'

/**
 * Preprocesses time series data to insert nulls at gaps, allowing
 * the line chart to show breaks in the data.
 */
export const preprocessData = (
  data: [Date, number][],
  gapThresholdMinutes: number,
): ([Date, number] | null)[] => {
  if (data.length === 0) return []
  const thresholdMs = gapThresholdMinutes * 60 * 1000
  const result: ([Date, number] | null)[] = [data[0]!]
  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1]!
    const curr = data[i]!
    if (curr[0].getTime() - prev[0].getTime() > thresholdMs) {
      result.push(null)
    }
    result.push(curr)
  }
  return result
}

export interface MetricBucketParsed {
  start: Date
  end: Date
  metrics: Record<string, { avg: number; min: number; max: number; count: number; sum?: number }>
}

export const parseBucketedResponse = (
  data: QueryMetricsBucketedResponse | undefined,
): MetricBucketParsed[] => {
  if (!data?.buckets) return []
  return data.buckets.map((b) => ({
    end: new Date(b.end),
    metrics: b.metrics,
    start: new Date(b.start),
  }))
}

/**
 * Aggregate adjacent 5m buckets into larger buckets.
 *
 * @param buckets - Pre-sorted array of 5m buckets
 * @param factor - Number of 5m buckets to merge (e.g. 3 for 15m, 6 for 30m)
 */
export const aggregateBuckets = (buckets: MetricBucketParsed[], factor: number): MetricBucketParsed[] => {
  if (factor <= 1 || buckets.length === 0) return buckets

  const result: MetricBucketParsed[] = []

  for (let i = 0; i < buckets.length; i += factor) {
    const chunk = buckets.slice(i, i + factor)
    const merged: MetricBucketParsed = {
      end: chunk[chunk.length - 1]!.end,
      metrics: {},
      start: chunk[0]!.start,
    }

    const metricNames = new Set<string>()
    for (const b of chunk) {
      for (const name of Object.keys(b.metrics)) {
        metricNames.add(name)
      }
    }

    for (const name of metricNames) {
      let totalWeightedAvg = 0
      let totalCount = 0
      let totalSum = 0
      let hasSum = false
      let globalMin = Infinity
      let globalMax = -Infinity

      for (const b of chunk) {
        const stats = b.metrics[name]
        if (!stats) continue
        totalWeightedAvg += stats.avg * stats.count
        totalCount += stats.count
        if (stats.sum !== undefined) {
          totalSum += stats.sum
          hasSum = true
        }
        if (stats.min < globalMin) globalMin = stats.min
        if (stats.max > globalMax) globalMax = stats.max
      }

      if (totalCount > 0) {
        merged.metrics[name] = {
          avg: totalWeightedAvg / totalCount,
          count: totalCount,
          max: globalMax,
          min: globalMin,
          ...(hasSum && { sum: totalSum }),
        }
      }
    }

    result.push(merged)
  }

  return result
}

/**
 * Aggregate buckets into local calendar windows (hour, day, or Monday-started week).
 * Unlike `aggregateBuckets` which groups by consecutive index, this groups buckets
 * by which window they fall into, ensuring alignment with other data sources
 * (screentime, training load) that the backend buckets in the same local calendar.
 *
 * @param buckets - Pre-sorted array of metric buckets
 */
export const aggregateBucketsAligned = (
  buckets: MetricBucketParsed[],
  size: BarBucketSize,
): MetricBucketParsed[] => {
  if (buckets.length === 0) return []

  const result: MetricBucketParsed[] = []
  let currentWindowStart = barWindowStart(buckets[0]!.start, size)
  let chunk: MetricBucketParsed[] = []

  for (const bucket of buckets) {
    const bucketWindowStart = barWindowStart(bucket.start, size)

    if (bucketWindowStart.getTime() !== currentWindowStart.getTime()) {
      if (chunk.length > 0) {
        result.push(mergeBucketChunk(chunk, currentWindowStart, nextBarWindowStart(currentWindowStart, size)))
      }
      currentWindowStart = bucketWindowStart
      chunk = []
    }
    chunk.push(bucket)
  }

  if (chunk.length > 0) {
    result.push(mergeBucketChunk(chunk, currentWindowStart, nextBarWindowStart(currentWindowStart, size)))
  }

  return result
}

const mergeBucketChunk = (chunk: MetricBucketParsed[], start: Date, end: Date): MetricBucketParsed => {
  const merged: MetricBucketParsed = { end, metrics: {}, start }

  const metricNames = new Set<string>()
  for (const b of chunk) {
    for (const name of Object.keys(b.metrics)) {
      metricNames.add(name)
    }
  }

  for (const name of metricNames) {
    let totalWeightedAvg = 0
    let totalCount = 0
    let totalSum = 0
    let hasSum = false
    let globalMin = Infinity
    let globalMax = -Infinity

    for (const b of chunk) {
      const stats = b.metrics[name]
      if (!stats) continue
      totalWeightedAvg += stats.avg * stats.count
      totalCount += stats.count
      if (stats.sum !== undefined) {
        totalSum += stats.sum
        hasSum = true
      }
      if (stats.min < globalMin) globalMin = stats.min
      if (stats.max > globalMax) globalMax = stats.max
    }

    if (totalCount > 0) {
      merged.metrics[name] = {
        avg: totalWeightedAvg / totalCount,
        count: totalCount,
        max: globalMax,
        min: globalMin,
        ...(hasSum && { sum: totalSum }),
      }
    }
  }

  return merged
}
