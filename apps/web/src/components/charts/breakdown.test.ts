import { describe, expect, test } from 'vitest'

import { breakdownBarSeries, SERIES_COLORS } from './breakdown'

describe('breakdownBarSeries', () => {
  test('one coloured series per name, missing buckets at 0', () => {
    const buckets: { bucket_start: string; series: Record<string, number> }[] = [
      { bucket_start: 'w1', series: { Chest: 4, Triceps: 2.5 } },
      { bucket_start: 'w2', series: { Chest: 3 } },
    ]
    expect(breakdownBarSeries(['Chest', 'Triceps'], buckets)).toEqual([
      {
        color: SERIES_COLORS[0],
        data: [
          { bucket_start: 'w1', value: 4 },
          { bucket_start: 'w2', value: 3 },
        ],
        name: 'Chest',
      },
      {
        color: SERIES_COLORS[1],
        data: [
          { bucket_start: 'w1', value: 2.5 },
          { bucket_start: 'w2', value: 0 },
        ],
        name: 'Triceps',
      },
    ])
  })

  test('null without a breakdown', () => {
    expect(breakdownBarSeries(undefined, [])).toBeNull()
    expect(breakdownBarSeries([], [])).toBeNull()
    expect(breakdownBarSeries(['Chest'], undefined)).toBeNull()
  })
})
