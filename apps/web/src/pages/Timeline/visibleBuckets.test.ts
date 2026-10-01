import { describe, expect, it } from 'vitest'

import { aggregateBuckets, aggregateBucketsAligned, type MetricBucketParsed } from '../../utils/chart'
import { visibleBuckets } from './visibleBuckets'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const T0 = Date.UTC(2026, 0, 5) // a Monday

const fiveMinBuckets = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    end: new Date(T0 + (i + 1) * 5 * MIN),
    i,
    start: new Date(T0 + i * 5 * MIN),
  }))

const indices = (bs: { i: number }[]) => bs.map((b) => b.i)
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => from + k)

describe('visibleBuckets', () => {
  it('returns the input for no buckets', () => {
    const empty: { start: Date; end: Date }[] = []
    expect(visibleBuckets(empty, T0, T0 + HOUR, '1h', 1)).toBe(empty)
  })

  it('keeps one bucket of margin on each side of an hour-aligned view', () => {
    const buckets = fiveMinBuckets(48)
    const result = visibleBuckets(buckets, T0 + 2 * HOUR, T0 + 3 * HOUR, '1h', 1)
    expect(indices(result)).toEqual(range(23, 36))
  })

  it('widens to whole calendar windows so re-aggregated bars stay complete', () => {
    const buckets = fiveMinBuckets(48)
    const result = visibleBuckets(buckets, T0 + 90 * MIN, T0 + 100 * MIN, '1h', 1)
    expect(indices(result)).toEqual(range(11, 24))
  })

  it('cuts at chunk multiples so index-based line aggregation is unchanged', () => {
    const buckets = fiveMinBuckets(48)
    const result = visibleBuckets(buckets, T0 + 2 * HOUR + 5 * MIN, T0 + 2 * HOUR + 50 * MIN, '1h', 6)
    expect(indices(result)).toEqual(range(18, 41))
  })

  it('returns the same array when everything is visible', () => {
    const buckets = fiveMinBuckets(12)
    expect(visibleBuckets(buckets, T0 - HOUR, T0 + 2 * HOUR, '1h', 6)).toBe(buckets)
  })

  it('keeps only a margin when the viewport is past the data', () => {
    const buckets = fiveMinBuckets(12)
    expect(indices(visibleBuckets(buckets, T0 + 5 * HOUR, T0 + 6 * HOUR, '1h', 1))).toEqual([11])
  })

  it('keeps only a margin when the viewport is before the data', () => {
    const buckets = fiveMinBuckets(12)
    expect(indices(visibleBuckets(buckets, T0 - 3 * HOUR, T0 - 2 * HOUR, '1h', 1))).toEqual([0])
  })

  describe('drawn output matches drawing every bucket', () => {
    const hourly: MetricBucketParsed[] = Array.from({ length: 21 * 24 }, (_, i) => {
      const start = new Date(T0 + i * HOUR)
      const v = (i * 37) % 101
      return {
        end: new Date(start.getTime() + HOUR),
        metrics: { hr: { avg: v, count: 1, max: v, min: v, sum: v } },
        start,
      }
    })
    const startMs = T0 + 8 * DAY + 5 * HOUR // a Tuesday morning
    const endMs = T0 + 12 * DAY + 17 * HOUR
    const inView = (b: MetricBucketParsed) => b.end.getTime() > startMs && b.start.getTime() < endMs

    it.each(['1h', '1d', '1w'] as const)('for %s bars', (size) => {
      const slice = visibleBuckets(hourly, startMs, endMs, size, 6)
      expect(slice.length).toBeLessThan(hourly.length)
      expect(aggregateBucketsAligned(slice, size).filter(inView)).toEqual(
        aggregateBucketsAligned(hourly, size).filter(inView),
      )
      for (const factor of [1, 3, 6]) {
        expect(aggregateBuckets(slice, factor).filter(inView)).toEqual(
          aggregateBuckets(hourly, factor).filter(inView),
        )
      }
    })
  })
})
