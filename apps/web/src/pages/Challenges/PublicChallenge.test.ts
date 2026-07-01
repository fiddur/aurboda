import type { ChallengeStanding } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { bucketEnd, toCumulativeSeries } from './race-series'

const standing = (buckets: { bucket_start: string; value: number }[]): ChallengeStanding => ({
  buckets,
  display_name: 'fiddur',
  identity_base_url: 'https://aurboda.net/u/fiddur',
  last_updated: null,
  stale: false,
  status: 'active',
  total: buckets.reduce((s, b) => s + b.value, 0),
})

describe('bucketEnd', () => {
  test('advances by one day / week / month', () => {
    expect(bucketEnd('2026-07-01T00:00:00.000Z', '1d')).toBe('2026-07-02T00:00:00.000Z')
    expect(bucketEnd('2026-07-01T00:00:00.000Z', '1w')).toBe('2026-07-08T00:00:00.000Z')
    expect(bucketEnd('2026-07-01T00:00:00.000Z', '1M')).toBe('2026-08-01T00:00:00.000Z')
  })
})

describe('toCumulativeSeries', () => {
  test('seeds a zero start-line point so a single bucket still yields a drawable line', () => {
    const series = toCumulativeSeries(
      standing([{ bucket_start: '2026-07-01T00:00:00.000Z', value: 4486 }]),
      '#8b5cf6',
      '2026-06-30T22:00:00.000Z',
      '1d',
    )
    // start line (0) + the bucket's running total plotted at the bucket end.
    expect(series.data).toEqual([
      { date: '2026-06-30T22:00:00.000Z', value: 0 },
      { date: '2026-07-02T00:00:00.000Z', value: 4486 },
    ])
    expect(series.data.length).toBeGreaterThan(1)
  })

  test('accumulates running totals across ordered buckets', () => {
    const series = toCumulativeSeries(
      standing([
        { bucket_start: '2026-07-02T00:00:00.000Z', value: 3000 },
        { bucket_start: '2026-07-01T00:00:00.000Z', value: 5000 },
      ]),
      '#8b5cf6',
      '2026-07-01T00:00:00.000Z',
      '1d',
    )
    expect(series.data.map((d) => d.value)).toEqual([0, 5000, 8000])
  })
})
