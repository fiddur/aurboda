import { describe, expect, test } from 'vitest'

import { EMA_HALF_LIFE_DEFAULT, MEASURE_HALF_LIFE_DEFAULT } from '../../utils/half-life'
import { barsFetchParams, trendFetchParams } from './chartFetchParams'

const filter = { filter_field: 'sets.exercise', filter_value: 'Bench Press' }
const range = { end: '2026-03-31T00:00:00.000Z', start: '2026-01-01T00:00:00.000Z' }

describe('barsFetchParams', () => {
  test('a measure source keeps its aggregation and item filter over the range', () => {
    expect(
      barsFetchParams(
        {
          aggregation: 'max',
          bucket_size: '1w',
          measure: 'e1rm',
          pattern: 'strength_training',
          source_type: 'activity_type',
          ...filter,
        },
        range,
      ),
    ).toEqual({
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
      barsFetchParams(
        { bucket_size: '1d', pattern: 'coffee', source_type: 'activity_type', ...filter },
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

  test('a metric source also counts by default', () => {
    expect(barsFetchParams({ bucket_size: '1d', pattern: 'weight', source_type: 'metric' }, range)).toEqual({
      aggregation: 'count',
      bucket_size: '1d',
      pattern: 'weight',
      source_type: 'metric',
      ...range,
    })
  })

  test('a tag definition id is sent as activity_type_id', () => {
    expect(
      barsFetchParams(
        {
          aggregation: 'sum',
          bucket_size: '1w',
          source_type: 'activity_type',
          tag_definition_id: '00000000-0000-4000-8000-000000000001',
        },
        range,
      ),
    ).toEqual({
      activity_type_id: '00000000-0000-4000-8000-000000000001',
      aggregation: 'sum',
      bucket_size: '1w',
      pattern: undefined,
      source_type: 'activity_type',
      ...range,
    })
  })
})

describe('trendFetchParams', () => {
  test('a measure trend keeps its filter and explicit half-life, and takes no rate fields', () => {
    expect(
      trendFetchParams(
        {
          aggregation: 'sum',
          display_period: 'weekly',
          half_life_days: 120,
          measure: 'e1rm',
          pattern: 'strength_training',
          source_type: 'activity_type',
          ...filter,
        },
        90,
      ),
    ).toEqual({
      half_life_days: 120,
      lookback_days: 90,
      measure: 'e1rm',
      pattern: 'strength_training',
      source_type: 'activity_type',
      ...filter,
    })
  })

  test('a measure trend defaults to the measure half-life', () => {
    expect(
      trendFetchParams({ measure: 'e1rm', pattern: 'strength_training', source_type: 'activity_type' }, 90),
    ).toMatchObject({ half_life_days: MEASURE_HALF_LIFE_DEFAULT })
  })

  test('an activity rate trend counts per month by default', () => {
    expect(trendFetchParams({ pattern: 'coffee', source_type: 'activity_type' }, 30)).toEqual({
      aggregation: 'count',
      display_period: 'monthly',
      half_life_days: EMA_HALF_LIFE_DEFAULT,
      lookback_days: 30,
      pattern: 'coffee',
      source_type: 'activity_type',
    })
  })

  test('a metric trend averages by default', () => {
    expect(trendFetchParams({ pattern: 'weight', source_type: 'metric' }, 30)).toMatchObject({
      aggregation: 'mean',
      display_period: 'monthly',
    })
  })

  test('explicit values win over the defaults', () => {
    expect(
      trendFetchParams(
        {
          aggregation: 'sum',
          display_period: 'weekly',
          half_life_days: 7,
          missing_days: 'zero',
          pattern: 'weight',
          source_type: 'metric',
        },
        60,
      ),
    ).toEqual({
      aggregation: 'sum',
      display_period: 'weekly',
      half_life_days: 7,
      lookback_days: 60,
      missing_days: 'zero',
      pattern: 'weight',
      source_type: 'metric',
    })
  })
})
