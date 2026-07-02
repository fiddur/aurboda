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
 * 3. the bucket granularity is floored to a server minimum to bound payloads,
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

const BUCKET_UNIT_SECONDS: Record<string, number> = { h: 3600, m: 60, s: 1 }

/**
 * Floor a series bucket string to `MIN_SERIES_BUCKET_SECONDS`. Anything at or
 * above the minimum is returned unchanged; anything below (including `0s`)
 * becomes `5s`.
 */
export const floorSeriesBucket = (bucket: string): BucketSize => {
  const match = bucket.match(/^(\d+)([smh])$/)
  if (!match) return `${MIN_SERIES_BUCKET_SECONDS}s`
  const seconds = parseInt(match[1], 10) * BUCKET_UNIT_SECONDS[match[2]]
  return seconds < MIN_SERIES_BUCKET_SECONDS ? `${MIN_SERIES_BUCKET_SECONDS}s` : (bucket as BucketSize)
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

  const effectiveBucket = floorSeriesBucket(bucket)
  const result = await deps.queryBucketed(metric, start, end, effectiveBucket)

  const samples: PublicSeriesSample[] = result.buckets.flatMap((b) => {
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

  return {
    bucket: effectiveBucket,
    end: end.toISOString(),
    metric,
    samples,
    start: start.toISOString(),
    unit: metricUnits[metric] ?? '',
  }
}
