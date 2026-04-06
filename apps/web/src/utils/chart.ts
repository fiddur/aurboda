import type { QueryMetricsBucketedResponse } from '@aurboda/api-spec'

/**
 * Preprocesses time series data to insert nulls at gaps, allowing
 * the line chart to show breaks in the data.
 *
 * @param data - Array of [Date, value] tuples
 * @param gapThresholdMinutes - Minimum gap in minutes to insert a null
 * @returns Array with nulls inserted at gaps
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

// ── Metric bucket types and aggregation ───────────────────────────────────────

/** A single parsed metric bucket with stats per metric. */
export interface MetricBucketParsed {
  start: Date
  end: Date
  metrics: Record<string, { avg: number; min: number; max: number; count: number; sum?: number }>
}

/**
 * Parse a bucketed metrics API response into an array of typed buckets.
 */
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
 * @returns Aggregated buckets
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

    // Collect all metric names present in the chunk
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
 * Aggregate buckets into time-aligned windows (e.g., align to hour boundaries).
 * Unlike `aggregateBuckets` which groups by consecutive index, this groups buckets
 * by which target window they fall into, ensuring alignment with other data sources
 * (screentime, training load) that use clean time boundaries.
 *
 * @param buckets - Pre-sorted array of metric buckets
 * @param windowMs - Target window size in ms (e.g. 3600000 for 1 hour)
 * @returns Aggregated buckets aligned to window boundaries
 */
export const aggregateBucketsAligned = (
  buckets: MetricBucketParsed[],
  windowMs: number,
): MetricBucketParsed[] => {
  if (buckets.length === 0) return []

  const result: MetricBucketParsed[] = []
  let currentWindowStart = Math.floor(buckets[0]!.start.getTime() / windowMs) * windowMs
  let chunk: MetricBucketParsed[] = []

  for (const bucket of buckets) {
    const bucketWindowStart = Math.floor(bucket.start.getTime() / windowMs) * windowMs

    if (bucketWindowStart !== currentWindowStart) {
      // Flush the previous window
      if (chunk.length > 0) {
        result.push(
          mergeBucketChunk(chunk, new Date(currentWindowStart), new Date(currentWindowStart + windowMs)),
        )
      }
      currentWindowStart = bucketWindowStart
      chunk = []
    }
    chunk.push(bucket)
  }

  // Flush the last window
  if (chunk.length > 0) {
    result.push(
      mergeBucketChunk(chunk, new Date(currentWindowStart), new Date(currentWindowStart + windowMs)),
    )
  }

  return result
}

/** Merge a chunk of buckets into a single bucket with given start/end boundaries. */
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
