import type { CombinedChartConfig } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { barsLayerParams, combinedChartParts, trendLayerParams } from './combinedChart'

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

const range = { end: '2026-03-31T00:00:00.000Z', start: '2026-01-01T00:00:00.000Z' }

describe('barsLayerParams', () => {
  test('queries the bars source over the range', () => {
    expect(barsLayerParams(config.layers[0] as Parameters<typeof barsLayerParams>[0], range)).toEqual({
      aggregation: 'max',
      bucket_size: '1w',
      measure: 'e1rm',
      pattern: 'strength_training',
      source_type: 'activity_type',
      ...filter,
      ...range,
    })
  })

  test('counts by default and drops an item filter without a measure', () => {
    expect(
      barsLayerParams(
        { bucket_size: '1d', kind: 'bars', pattern: 'coffee', source_type: 'activity_type', ...filter },
        range,
      ),
    ).toEqual({
      aggregation: 'count',
      bucket_size: '1d',
      pattern: 'coffee',
      source_type: 'activity_type',
      ...range,
    })
  })
})

describe('trendLayerParams', () => {
  test('a measure trend keeps its filter and half-life over the shared lookback', () => {
    expect(trendLayerParams(config.layers[1] as Parameters<typeof trendLayerParams>[0], 90)).toEqual({
      half_life_days: 120,
      lookback_days: 90,
      measure: 'e1rm',
      pattern: 'strength_training',
      source_type: 'activity_type',
      ...filter,
    })
  })

  test('a rate trend takes the trend widget defaults', () => {
    expect(trendLayerParams(config.layers[2] as Parameters<typeof trendLayerParams>[0], 30)).toEqual({
      aggregation: 'count',
      display_period: 'monthly',
      half_life_days: 15,
      lookback_days: 30,
      pattern: 'strength_training',
      source_type: 'activity_type',
    })
  })
})

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
