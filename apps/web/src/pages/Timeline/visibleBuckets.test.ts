import { describe, expect, it } from 'vitest'

import { visibleBuckets } from './visibleBuckets'

const MIN = 60_000
const HOUR = 60 * MIN
const T0 = Date.UTC(2026, 0, 1)

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
    expect(visibleBuckets(empty, T0, T0 + HOUR, HOUR, 1)).toBe(empty)
  })

  it('keeps one bucket of margin on each side', () => {
    const buckets = fiveMinBuckets(48)
    const result = visibleBuckets(buckets, T0 + 2 * HOUR, T0 + 3 * HOUR, 5 * MIN, 1)
    expect(indices(result)).toEqual(range(23, 36))
  })

  it('treats a bucket ending exactly on the viewport start as margin', () => {
    const buckets = fiveMinBuckets(48)
    const result = visibleBuckets(buckets, T0 + HOUR, T0 + HOUR + 10 * MIN, 5 * MIN, 1)
    expect(indices(result)).toEqual([11, 12, 13, 14])
  })

  it('widens to whole alignment windows so re-aggregated bars stay complete', () => {
    const buckets = fiveMinBuckets(48)
    const result = visibleBuckets(buckets, T0 + 90 * MIN, T0 + 100 * MIN, HOUR, 1)
    expect(indices(result)).toEqual(range(11, 24))
  })

  it('cuts at chunk multiples so index-based line aggregation is unchanged', () => {
    const buckets = fiveMinBuckets(48)
    const result = visibleBuckets(buckets, T0 + 2 * HOUR, T0 + 3 * HOUR, 5 * MIN, 6)
    expect(indices(result)).toEqual(range(18, 41))
  })

  it('returns the same array when everything is visible', () => {
    const buckets = fiveMinBuckets(12)
    expect(visibleBuckets(buckets, T0 - HOUR, T0 + 2 * HOUR, HOUR, 6)).toBe(buckets)
  })

  it('keeps only a margin when the viewport is past the data', () => {
    const buckets = fiveMinBuckets(12)
    expect(indices(visibleBuckets(buckets, T0 + 5 * HOUR, T0 + 6 * HOUR, 5 * MIN, 1))).toEqual([11])
  })

  it('keeps only a margin when the viewport is before the data', () => {
    const buckets = fiveMinBuckets(12)
    expect(indices(visibleBuckets(buckets, T0 - 3 * HOUR, T0 - 2 * HOUR, 5 * MIN, 1))).toEqual([0])
  })
})
