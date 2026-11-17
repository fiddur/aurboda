import type { DataSchemaDefinition } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { buildChartUrl } from '../../utils/chart-url'
import {
  aggregationOptions,
  EMA_HALF_LIFE_OPTIONS,
  filterPatch,
  halfLifeOptions,
  itemBreakdownOptions,
  MEASURE_HALF_LIFE_DEFAULT,
  MEASURE_HALF_LIFE_OPTIONS,
  measureParams,
  measurePatch,
  muscleFilterOf,
  muscleFilterPatch,
  muscleFilterPath,
  parseAggregation,
  parseChartMode,
  parseMeasure,
  parseMeasureQuery,
  toggleBreakdownField,
  trendFilterPatch,
  withMuscleFilterRules,
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

  test('a measure that is not summed drops a muscle-group breakdown; a summed one keeps it', () => {
    expect(measurePatch(['program', 'sets.exercise.muscle_group'], 'e1rm')).toEqual({
      aggregation: 'max',
      breakdown_fields: ['program'],
      chart_type: 'bar',
      measure: 'e1rm',
    })
    expect(measurePatch(['sets.exercise.muscle_group'], 'volume')).toEqual({
      aggregation: 'sum',
      chart_type: 'bar',
      measure: 'volume',
    })
    expect(measurePatch(['sets.exercise.muscle_group'], '').breakdown_fields).toEqual([])
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

describe('halfLifeOptions', () => {
  test('the EMA choices without a measure', () => {
    expect(halfLifeOptions('')).toBe(EMA_HALF_LIFE_OPTIONS)
    expect(EMA_HALF_LIFE_OPTIONS.map((o) => o.value)).toEqual([7, 15, 30])
  })

  test('longer choices for a measure, the default among them', () => {
    expect(halfLifeOptions('e1rm')).toBe(MEASURE_HALF_LIFE_OPTIONS)
    expect(MEASURE_HALF_LIFE_OPTIONS).toEqual([
      { label: '30 days', value: 30 },
      { label: '60 days', value: 60 },
      { label: '120 days', value: 120 },
      { label: '240 days', value: 240 },
      { label: '1 year', value: 365 },
    ])
    expect(MEASURE_HALF_LIFE_OPTIONS.map((o) => o.value)).toContain(MEASURE_HALF_LIFE_DEFAULT)
  })
})

describe('parseChartMode', () => {
  test('a trend with a 15-day half-life by default without a measure', () => {
    expect(parseChartMode({}, '')).toEqual({ chart_type: 'trend', half_life_days: 15 })
    expect(parseChartMode({ chart_type: 'bar', half_life_days: '7' }, '')).toEqual({
      chart_type: 'bar',
      half_life_days: 7,
    })
  })

  test('bars by default with a measure, its trend when asked, 120 days by default', () => {
    expect(parseChartMode({}, 'e1rm')).toEqual({ chart_type: 'bar', half_life_days: 15 })
    expect(parseChartMode({ chart_type: 'trend' }, 'e1rm')).toEqual({
      chart_type: 'trend',
      half_life_days: MEASURE_HALF_LIFE_DEFAULT,
    })
    expect(parseChartMode({ chart_type: 'trend', half_life_days: '240' }, 'e1rm')).toEqual({
      chart_type: 'trend',
      half_life_days: 240,
    })
  })
})

describe('itemBreakdownOptions', () => {
  const schema = (catalog?: 'exercises'): DataSchemaDefinition => ({
    fields: [
      {
        item_fields: [
          { ...(catalog ? { catalog } : {}), is_categorical: true, name: 'exercise', type: 'string' },
        ],
        name: 'sets',
        type: 'list',
      },
    ],
  })

  test('a summed measure on a catalogue-backed field offers the muscle group', () => {
    expect(itemBreakdownOptions(schema('exercises'), 'set_count')).toEqual([
      { label: 'Exercise', name: 'sets.exercise' },
      { label: 'Muscle group', name: 'sets.exercise.muscle_group' },
    ])
  })

  test('not for a measure that is not summed, nor without a catalogue', () => {
    expect(itemBreakdownOptions(schema('exercises'), 'e1rm')).toEqual([
      { label: 'Exercise', name: 'sets.exercise' },
    ])
    expect(itemBreakdownOptions(schema(), 'volume')).toEqual([{ label: 'Exercise', name: 'sets.exercise' }])
  })

  test('nothing without a measure', () => {
    expect(itemBreakdownOptions(schema('exercises'), '')).toEqual([])
  })
})

describe('toggleBreakdownField', () => {
  test('adds and removes a field', () => {
    expect(toggleBreakdownField(['program'], 'location')).toEqual(['program', 'location'])
    expect(toggleBreakdownField(['program', 'location'], 'program')).toEqual(['location'])
  })

  test('the muscle group replaces the item path, and the other way round; scalar fields stay', () => {
    expect(toggleBreakdownField(['program', 'sets.exercise'], 'sets.exercise.muscle_group')).toEqual([
      'program',
      'sets.exercise.muscle_group',
    ])
    expect(toggleBreakdownField(['sets.exercise.muscle_group', 'program'], 'sets.exercise')).toEqual([
      'program',
      'sets.exercise',
    ])
  })
})

describe('the muscle filter', () => {
  const chest = { filter_field: 'sets.exercise.muscle_group', filter_value: 'chest' }
  const schema = (catalog?: 'exercises'): DataSchemaDefinition => ({
    fields: [
      {
        item_fields: [
          { ...(catalog ? { catalog } : {}), is_categorical: true, name: 'exercise', type: 'string' },
        ],
        name: 'sets',
        type: 'list',
      },
    ],
  })

  test('is told from an exercise filter', () => {
    expect(muscleFilterOf(chest)).toEqual({ group: 'chest', path: 'sets.exercise' })
    expect(muscleFilterOf({ filter_field: 'sets.exercise', filter_value: 'Squat' })).toBeUndefined()
    expect(muscleFilterOf({ filter_field: '', filter_value: '' })).toBeUndefined()
  })

  test('a group sets the filter, keeps scalar and own-path breakdowns and drops the rest', () => {
    expect(
      muscleFilterPatch(
        ['location', 'sets.exercise', 'sets.exercise.muscle_group', 'laps.kind'],
        'sets.exercise',
        'lats',
      ),
    ).toEqual({
      breakdown_fields: ['location', 'sets.exercise'],
      filter_field: 'sets.exercise.muscle_group',
      filter_value: 'lats',
    })
  })

  test('All clears the filter and keeps the breakdowns', () => {
    expect(muscleFilterPatch(['sets.exercise'], 'sets.exercise', '')).toEqual({
      breakdown_fields: ['sets.exercise'],
      filter_field: '',
      filter_value: '',
    })
  })

  test('a measure that is not summed drops it; a summed one keeps it', () => {
    expect(measurePatch([], 'e1rm', chest.filter_field)).toMatchObject({ filter_field: '', filter_value: '' })
    expect(measurePatch([], 'volume', chest.filter_field)).not.toHaveProperty('filter_field')
    expect(measurePatch([], 'e1rm', 'sets.exercise')).not.toHaveProperty('filter_field')
  })

  test('the Muscle group breakdown is not offered with a muscle filter', () => {
    expect(itemBreakdownOptions(schema('exercises'), 'set_count', chest)).toEqual([
      { label: 'Exercise', name: 'sets.exercise' },
    ])
  })

  test('is offered for a summed measure on a catalogue-backed field only', () => {
    expect(muscleFilterPath(schema('exercises'), 'set_count')).toBe('sets.exercise')
    expect(muscleFilterPath(schema('exercises'), 'e1rm')).toBeUndefined()
    expect(muscleFilterPath(schema(), 'volume')).toBeUndefined()
    expect(muscleFilterPath(schema('exercises'), '')).toBeUndefined()
  })

  test('a trend drops it', () => {
    expect(trendFilterPatch(chest)).toEqual({ filter_field: '', filter_value: '' })
    expect(trendFilterPatch({ filter_field: 'sets.exercise', filter_value: 'Squat' })).toEqual({})
    const state = {
      ...chest,
      breakdown_fields: ['sets.exercise.muscle_group'],
      measure: 'set_count' as const,
    }
    expect(withMuscleFilterRules(state, 'trend')).toMatchObject({ filter_field: '', filter_value: '' })
    expect(withMuscleFilterRules(state, 'bar')).toEqual({ ...state, breakdown_fields: [] })
  })

  test('parsing drops a muscle filter with a measure that is not summed or an unknown group', () => {
    expect(parseMeasureQuery({ ...chest, measure: 'e1rm' }, 'activity_type')).toEqual({
      filter_field: '',
      filter_value: '',
      measure: 'e1rm',
    })
    expect(
      parseMeasureQuery({ ...chest, filter_value: 'front_delts', measure: 'set_count' }, 'activity_type'),
    ).toMatchObject({ filter_field: '', filter_value: '' })
  })

  test('round-trips through a chart URL', () => {
    const url = buildChartUrl({
      aggregation: 'sum',
      breakdown_fields: ['sets.exercise'],
      bucket_size: '1w',
      chart_type: 'bar',
      ...chest,
      lookback_days: 90,
      measure: 'set_count',
      pattern: 'strength_training',
      source_type: 'activity_type',
    })
    const query = Object.fromEntries(new URLSearchParams(url.split('?')[1]))
    const state = parseMeasureQuery(query, 'activity_type')
    expect(state).toEqual({ ...chest, measure: 'set_count' })
    expect(
      withMuscleFilterRules({ ...state, breakdown_fields: query.breakdown_fields.split(',') }, 'bar'),
    ).toEqual({ ...chest, breakdown_fields: ['sets.exercise'], measure: 'set_count' })
    expect(measureParams(state)).toEqual({ ...chest, measure: 'set_count' })
  })
})
