import { describe, expect, test } from 'vitest'

import type { QueryMetricsBucketedResult } from '../queries/types.ts'

import { windowMetricStat } from './feed-activity.ts'

const bucketed = (buckets: QueryMetricsBucketedResult['buckets']): QueryMetricsBucketedResult => ({
  bucket: '1h',
  buckets,
  end: '',
  start: '',
})

describe('windowMetricStat', () => {
  test('merges buckets: sum adds, max takes the extreme, avg re-weights by count', () => {
    const stat = windowMetricStat(
      bucketed([
        {
          end: 'b',
          metrics: {
            distance: { avg: 0, count: 1, first_time: '', last_time: '', max: 0, min: 0, sum: 3000 },
            heart_rate: { avg: 140, count: 10, first_time: '', last_time: '', max: 150, min: 130 },
          },
          start: 'a',
        },
        {
          end: 'd',
          metrics: {
            distance: { avg: 0, count: 1, first_time: '', last_time: '', max: 0, min: 0, sum: 5200 },
            heart_rate: { avg: 160, count: 30, first_time: '', last_time: '', max: 175, min: 140 },
          },
          start: 'c',
        },
      ]),
    )
    // Weighted avg = (140*10 + 160*30) / 40 = 155
    expect(stat('heart_rate', 'avg')).toBe(155)
    expect(stat('heart_rate', 'max')).toBe(175)
    expect(stat('distance', 'sum')).toBe(8200)
  })

  test('returns undefined for a metric with no data', () => {
    const stat = windowMetricStat(bucketed([]))
    expect(stat('heart_rate', 'avg')).toBeUndefined()
  })
})
