/**
 * Public series resolution — the read side of the feed's privacy boundary.
 *
 * The public `/series` endpoint is deliberately unauthenticated (like a
 * shared-dashboard slug), so the *only* thing standing between a caller and a
 * user's high-resolution physiological data is data-driven scoping:
 *
 * 1. a feed post must have shared this exact metric as a *series* for an
 *    activity whose window covers the request (checked by `findCoveringWindow`),
 * 2. the returned range is clamped to that activity's window (defence in depth —
 *    coverage already guarantees it, but we never trust the caller's bounds),
 * 3. the bucket granularity is floored to a server minimum and coarsened until
 *    the window fits `MAX_SERIES_SAMPLES`, to bound payloads,
 * 4. only the requested metric's stats are projected out; per-measurement
 *    timestamps are dropped.
 *
 * The logic is dependency-injected (window lookup + bucketed query) so it can be
 * unit-tested without a database.
 */

import type { BucketSize, MetricType, PublicSeriesSample } from '@aurboda/api-spec'

import type { QueryMetricsBucketedResult } from './queries/types.ts'

import { metricUnits } from '../schema.ts'

/** Minimum bucket granularity for public series, to bound response size. */
export const MIN_SERIES_BUCKET_SECONDS = 5

export interface PublicSeriesDeps {
  /** The window of a shared activity that authorizes this metric, or null. */
  findCoveringWindow: (
    metric: string,
    start: Date,
    end: Date,
  ) => Promise<{ start_time: Date; end_time: Date } | null>
  /** Bucketed aggregation over an authorized, clamped window. */
  queryBucketed: (
    metric: MetricType,
    start: Date,
    end: Date,
    bucket: BucketSize,
  ) => Promise<QueryMetricsBucketedResult>
}

export interface PublicSeriesResult {
  metric: MetricType
  unit: string
  bucket: BucketSize
  start: string
  end: string
  samples: PublicSeriesSample[]
}

/**
 * Most samples one series may carry. A sample serialises to at most
 * `SAMPLE_JSON_BYTES`, so a capped series stays well under a peer's 1 MB
 * response ceiling (`safe-fetch.ts`).
 */
export const MAX_SERIES_SAMPLES = 2000

/** An upper bound on one `PublicSeriesSample`'s JSON size, numbers at full precision. */
export const SAMPLE_JSON_BYTES = 220

const BUCKET_UNIT_SECONDS: Record<string, number> = {
  M: 30 * 86_400,
  d: 86_400,
  h: 3600,
  m: 60,
  s: 1,
  w: 7 * 86_400,
}

const bucketSeconds = (bucket: string): number | null => {
  const match = bucket.match(/^(\d+)([smhdwM])$/)
  return match ? parseInt(match[1], 10) * BUCKET_UNIT_SECONDS[match[2]] : null
}

const COARSER_BUCKETS: BucketSize[] = [
  '5s',
  '10s',
  '15s',
  '30s',
  '1m',
  '2m',
  '5m',
  '10m',
  '15m',
  '30m',
  '1h',
  '2h',
  '3h',
  '6h',
  '12h',
  '1d',
  '2d',
  '7d',
  '14d',
  '28d',
]

/**
 * Coarsen `bucket` until `[start, end]` spans at most `maxSamples` buckets: the
 * bucket as given when it already fits, else the first round size that does.
 * One spare bucket allows for a window that straddles bucket boundaries at both
 * ends.
 */
export const coarsenBucketToFit = (
  bucket: BucketSize,
  start: Date,
  end: Date,
  maxSamples: number = MAX_SERIES_SAMPLES,
): BucketSize => {
  const needed = (end.getTime() - start.getTime()) / 1000 / Math.max(1, maxSamples - 1)
  const given = bucketSeconds(bucket) ?? 0
  if (given >= needed) return bucket
  return COARSER_BUCKETS.find((b) => (bucketSeconds(b) ?? 0) >= needed) ?? `${Math.ceil(needed / 86_400)}d`
}

/**
 * The sample budget of each of `seriesCount` series sharing one payload whose
 * other content is `fixedBytes`: an even share of what `byteBudget` leaves,
 * at most `MAX_SERIES_SAMPLES` and never below `minSamples`, so a crowded
 * payload still draws every series coarsely.
 */
export const sharedSampleBudget = (
  byteBudget: number,
  fixedBytes: number,
  seriesCount: number,
  minSamples = 24,
): number => {
  if (seriesCount <= 0) return MAX_SERIES_SAMPLES
  const share = Math.floor((byteBudget - fixedBytes) / SAMPLE_JSON_BYTES / seriesCount)
  return Math.min(MAX_SERIES_SAMPLES, Math.max(minSamples, share))
}

/**
 * Project one metric's stats out of a bucketed-query result into
 * `PublicSeriesSample[]`, dropping any bucket the metric has no stats for.
 * Shared by the public `/series` endpoint and the article structured/chart-block
 * resolvers, which all bucket the same way and want the same sample shape.
 */
export const samplesFromBucketedResult = (
  result: QueryMetricsBucketedResult,
  metric: MetricType,
): PublicSeriesSample[] =>
  result.buckets.flatMap((b) => {
    const stats = b.metrics[metric]
    if (!stats) return []
    const sample: PublicSeriesSample = {
      avg: stats.avg,
      count: stats.count,
      end: b.end,
      max: stats.max,
      min: stats.min,
      start: b.start,
    }
    if (stats.sum !== undefined) sample.sum = stats.sum
    return [sample]
  })

/**
 * Floor a series bucket string to `MIN_SERIES_BUCKET_SECONDS`. Anything at or
 * above the minimum is returned unchanged; anything below (including `0s`)
 * becomes `5s`.
 */
export const floorSeriesBucket = (bucket: string): BucketSize => {
  const seconds = bucketSeconds(bucket)
  return seconds == null || seconds < MIN_SERIES_BUCKET_SECONDS
    ? `${MIN_SERIES_BUCKET_SECONDS}s`
    : (bucket as BucketSize)
}

/**
 * Resolve a public series request to bucketed samples, or null when the request
 * is not authorized (unshared metric, or a window no shared activity covers).
 */
export const resolvePublicSeries = async (
  metric: MetricType,
  requestedStart: Date,
  requestedEnd: Date,
  bucket: string,
  deps: PublicSeriesDeps,
): Promise<PublicSeriesResult | null> => {
  if (!(requestedStart.getTime() < requestedEnd.getTime())) return null

  const window = await deps.findCoveringWindow(metric, requestedStart, requestedEnd)
  if (!window) return null

  // Clamp to the activity window. Coverage makes this a no-op for legitimate
  // requests, but we never let the caller's bounds widen the exposed range.
  const start = new Date(Math.max(requestedStart.getTime(), window.start_time.getTime()))
  const end = new Date(Math.min(requestedEnd.getTime(), window.end_time.getTime()))
  if (!(start.getTime() < end.getTime())) return null

  const effectiveBucket = coarsenBucketToFit(floorSeriesBucket(bucket), start, end)
  const result = await deps.queryBucketed(metric, start, end, effectiveBucket)
  const samples = samplesFromBucketedResult(result, metric)

  return {
    bucket: effectiveBucket,
    end: end.toISOString(),
    metric,
    samples,
    start: start.toISOString(),
    unit: metricUnits[metric] ?? '',
  }
}
