import type { CombinedChartConfig } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { combinedChartParts } from './combinedChart'

const filter = { filter_field: 'sets.exercise', filter_value: 'Bench Press' }

const config: CombinedChartConfig = {
  layers: [
    {
      aggregation: 'max',
      bucket_size: '1w',
      kind: 'bars',
      measure: 'e1rm',
      pattern: 'strength_training',
      source_type: 'activity_type',
      ...filter,
    },
    {
      half_life_days: 120,
      kind: 'trend',
      measure: 'e1rm',
      pattern: 'strength_training',
      source_type: 'activity_type',
      ...filter,
    },
    { color: '#22c55e', kind: 'trend', pattern: 'strength_training', source_type: 'activity_type' },
  ],
  lookback_days: 90,
}

describe('combinedChartParts', () => {
  test('the bars layer gives the bars, each resolved trend layer a line with its color', () => {
    const buckets = [{ bucket_start: '2026-03-02T00:00:00.000Z', value: 99 }]
    const history = [{ date: '2026-03-01', value: 99 }]
    expect(
      combinedChartParts(config, {
        layers: [
          { data: { buckets }, kind: 'bars' },
          { data: { current_value: 99, history }, kind: 'trend' },
          { data: { current_value: 2, history }, kind: 'trend' },
        ],
      }),
    ).toEqual({
      bars: { bucketSize: '1w', buckets },
      lines: [{ data: history }, { color: '#22c55e', data: history }],
    })
  })

  test('layers without data draw nothing', () => {
    expect(
      combinedChartParts(config, {
        layers: [
          { data: null, kind: 'bars' },
          { data: null, kind: 'trend' },
          { data: null, kind: 'trend' },
        ],
      }),
    ).toEqual({ bars: { bucketSize: '1w', buckets: [] }, lines: [] })
    expect(combinedChartParts(config, null)).toEqual({ bars: { bucketSize: '1w', buckets: [] }, lines: [] })
  })
})
