import { describe, expect, test } from 'vitest'

import {
  aggregationOptions,
  filterPatch,
  measureParams,
  measurePatch,
  parseAggregation,
  parseMeasure,
  parseMeasureQuery,
} from './chartMeasures'

describe('parseMeasure', () => {
  test('a known measure for an activity type', () => {
    expect(parseMeasure('e1rm', 'activity_type')).toBe('e1rm')
    expect(parseMeasure('volume', 'activity_type')).toBe('volume')
  })

  test('empty for anything else, and for metrics', () => {
    expect(parseMeasure(undefined, 'activity_type')).toBe('')
    expect(parseMeasure('bogus', 'activity_type')).toBe('')
    expect(parseMeasure('e1rm', 'metric')).toBe('')
  })
})

describe('parseMeasureQuery', () => {
  test('the measure with its filter', () => {
    expect(
      parseMeasureQuery(
        { filter_field: 'sets.exercise', filter_value: 'Squat', measure: 'e1rm' },
        'activity_type',
      ),
    ).toEqual({ filter_field: 'sets.exercise', filter_value: 'Squat', measure: 'e1rm' })
  })

  test('no filter without a measure, or without both parts', () => {
    expect(
      parseMeasureQuery({ filter_field: 'sets.exercise', filter_value: 'Squat' }, 'activity_type'),
    ).toEqual({
      filter_field: '',
      filter_value: '',
      measure: '',
    })
    expect(parseMeasureQuery({ filter_value: 'Squat', measure: 'volume' }, 'activity_type')).toEqual({
      filter_field: '',
      filter_value: '',
      measure: 'volume',
    })
  })
})

describe('parseAggregation', () => {
  test('the default for the source without one', () => {
    expect(parseAggregation(undefined, 'activity_type', '')).toBe('count')
    expect(parseAggregation(undefined, 'metric', '')).toBe('mean')
  })

  test("the measure's default without one, or with count", () => {
    expect(parseAggregation(undefined, 'activity_type', 'e1rm')).toBe('max')
    expect(parseAggregation('count', 'activity_type', 'volume')).toBe('sum')
  })

  test('max only with a measure', () => {
    expect(parseAggregation('max', 'activity_type', 'volume')).toBe('max')
    expect(parseAggregation('max', 'activity_type', '')).toBe('count')
    expect(parseAggregation('max', 'metric', '')).toBe('mean')
  })

  test('keeps a valid choice and drops an unknown one', () => {
    expect(parseAggregation('sum', 'activity_type', '')).toBe('sum')
    expect(parseAggregation('mean', 'activity_type', 'e1rm')).toBe('mean')
    expect(parseAggregation('median', 'activity_type', '')).toBe('count')
  })
})

describe('measurePatch', () => {
  test('choosing a measure takes its default aggregation and charts bars', () => {
    expect(measurePatch(['program'], 'e1rm')).toEqual({
      aggregation: 'max',
      chart_type: 'bar',
      measure: 'e1rm',
    })
    expect(measurePatch([], 'set_count')).toEqual({
      aggregation: 'sum',
      chart_type: 'bar',
      measure: 'set_count',
    })
  })

  test('clearing it restores count and drops the item filter and item-path breakdowns', () => {
    expect(measurePatch(['program', 'sets.exercise'], '')).toEqual({
      aggregation: 'count',
      breakdown_fields: ['program'],
      filter_field: '',
      filter_value: '',
      measure: '',
    })
  })
})

describe('filterPatch', () => {
  test('sets the path with a value', () => {
    expect(filterPatch('sets.exercise', 'Squat')).toEqual({
      filter_field: 'sets.exercise',
      filter_value: 'Squat',
    })
  })

  test('All, or no path, clears both', () => {
    expect(filterPatch('sets.exercise', '')).toEqual({ filter_field: '', filter_value: '' })
    expect(filterPatch(undefined, 'Squat')).toEqual({ filter_field: '', filter_value: '' })
  })
})

describe('measureParams', () => {
  test('nothing without a measure', () => {
    expect(measureParams({ filter_field: 'sets.exercise', filter_value: 'Squat', measure: '' })).toEqual({})
  })

  test('the measure, with the filter when both parts are set', () => {
    expect(measureParams({ filter_field: '', filter_value: '', measure: 'volume' })).toEqual({
      measure: 'volume',
    })
    expect(measureParams({ filter_field: 'sets.exercise', filter_value: 'Squat', measure: 'e1rm' })).toEqual({
      filter_field: 'sets.exercise',
      filter_value: 'Squat',
      measure: 'e1rm',
    })
  })
})

describe('aggregationOptions', () => {
  const values = (opts: { value: string }[]) => opts.map((o) => o.value)

  test('per source without a measure', () => {
    expect(values(aggregationOptions('metric', ''))).toEqual(['mean', 'sum', 'count'])
    expect(values(aggregationOptions('activity_type', ''))).toEqual(['sum', 'count'])
  })

  test('sum, max and average with a measure', () => {
    expect(values(aggregationOptions('activity_type', 'e1rm'))).toEqual(['sum', 'max', 'mean'])
  })
})
