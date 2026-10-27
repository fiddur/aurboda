import type { DataSchemaDefinition } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  defaultAggregation,
  formatMeasure,
  formatSet,
  formatSets,
  measurableTypes,
  measureFilter,
  measureFilterPath,
  measureGoalLabel,
  measureOptions,
  measureSet,
  topSet,
} from './measures'

const THIN = ' '

describe('formatMeasure', () => {
  test('volume groups thousands with a thin space and drops decimals', () => {
    expect(formatMeasure('volume', 4320)).toBe(`4${THIN}320 kg`)
    expect(formatMeasure('volume', 1_234_567.6)).toBe(`1${THIN}234${THIN}568 kg`)
    expect(formatMeasure('volume', 640)).toBe('640 kg')
  })

  test('weights keep one decimal and drop a trailing .0', () => {
    expect(formatMeasure('e1rm', 102.5)).toBe('102.5 kg')
    expect(formatMeasure('max_weight', 100)).toBe('100 kg')
    expect(formatMeasure('e1rm', 106.66)).toBe('106.7 kg')
  })

  test('set count is a bare number', () => {
    expect(formatMeasure('set_count', 24)).toBe('24')
  })

  test('reps are a plain integer with a unit', () => {
    expect(formatMeasure('total_reps', 120)).toBe('120 reps')
    expect(formatMeasure('max_reps', 41.6)).toBe('42 reps')
  })

  test('max time is m:ss', () => {
    expect(formatMeasure('max_time', 90)).toBe('1:30')
    expect(formatMeasure('max_time', 5)).toBe('0:05')
    expect(formatMeasure('max_time', 3725)).toBe('62:05')
  })
})

describe('formatSet', () => {
  test('reps and weight', () => {
    expect(formatSet({ reps: 8, weight: 80 })).toBe('8×80 kg')
  })

  test('reps only, weight only, time, distance', () => {
    expect(formatSet({ reps: 15, weight: null })).toBe('15 reps')
    expect(formatSet({ reps: null, weight: 80 })).toBe('80 kg')
    expect(formatSet({ time: 90 })).toBe('1:30')
    expect(formatSet({ distance: 40 })).toBe('40 m')
    expect(formatSet({ reps: 10, time: 30 })).toBe('10 reps 0:30')
  })

  test('a dash when nothing is set', () => {
    expect(formatSet({ exercise: 'Plank' })).toBe('—')
  })

  test('set type flags', () => {
    expect(formatSet({ reps: 8, set_type: 'warmup', weight: 60 })).toBe('8×60 kg (w)')
    expect(formatSet({ reps: 8, set_type: 'drop_set', weight: 60 })).toBe('8×60 kg (drop)')
    expect(formatSet({ reps: 8, set_type: 'failure', weight: 60 })).toBe('8×60 kg (f)')
    expect(formatSet({ reps: 8, set_type: 'normal', weight: 60 })).toBe('8×60 kg')
  })
})

describe('formatSets', () => {
  test('joins with a comma', () => {
    expect(
      formatSets([
        { reps: 8, set_type: 'warmup', weight: 60 },
        { reps: 8, weight: 80 },
      ]),
    ).toBe('8×60 kg (w), 8×80 kg')
    expect(formatSets([])).toBe('')
  })
})

describe('topSet', () => {
  test('the heaviest working set, more reps breaking a tie', () => {
    const sets = [
      { reps: 5, set_type: 'warmup', weight: 120 },
      { reps: 8, weight: 80 },
      { reps: 6, weight: 85 },
      { reps: 8, weight: 85 },
    ]
    expect(topSet(sets)).toBe(sets[3])
  })

  test('the most reps without weights', () => {
    const sets = [{ reps: 12 }, { reps: 15 }, { reps: 10 }]
    expect(topSet(sets)).toBe(sets[1])
  })

  test('the longest time without weights or reps', () => {
    const sets = [{ time: 30 }, { time: 60 }, { time: 45 }]
    expect(topSet(sets)).toBe(sets[1])
  })

  test('undefined with no working set', () => {
    expect(topSet([])).toBeUndefined()
    expect(topSet([{ reps: 8, set_type: 'warmup', weight: 60 }])).toBeUndefined()
    expect(topSet([{ reps: 8, set_type: ' Warmup ', weight: 60 }])).toBeUndefined()
    expect(topSet([{ exercise: 'x' }])).toBeUndefined()
  })
})

describe('measureSet', () => {
  const sets = [
    { reps: 1, weight: 100 },
    { reps: 10, weight: 90 },
    { reps: 12, set_type: 'warmup', weight: 95 },
    { time: 40 },
  ]

  test('e1rm picks the set with the highest Epley estimate', () => {
    expect(measureSet(sets, 'e1rm')).toBe(sets[1])
  })

  test('max_weight picks the top set', () => {
    expect(measureSet(sets, 'max_weight')).toBe(sets[0])
  })

  test('max_time picks the longest working set', () => {
    expect(measureSet(sets, 'max_time')).toBe(sets[3])
  })

  test('max_reps picks the working set with the most reps', () => {
    expect(measureSet(sets, 'max_reps')).toBe(sets[1])
  })

  test('undefined for measures that are not one set', () => {
    expect(measureSet(sets, 'volume')).toBeUndefined()
    expect(measureSet(sets, 'set_count')).toBeUndefined()
    expect(measureSet(sets, 'total_reps')).toBeUndefined()
  })
})

describe('defaultAggregation', () => {
  test('max for single-set measures, sum for totals', () => {
    expect(defaultAggregation('e1rm')).toBe('max')
    expect(defaultAggregation('max_weight')).toBe('max')
    expect(defaultAggregation('max_time')).toBe('max')
    expect(defaultAggregation('volume')).toBe('sum')
    expect(defaultAggregation('set_count')).toBe('sum')
    expect(defaultAggregation('max_reps')).toBe('max')
    expect(defaultAggregation('total_reps')).toBe('sum')
  })
})

describe('measureGoalLabel', () => {
  const goal = { activity_type: 'strength_training', measure: 'e1rm' as const }

  test('the exercise when the goal is on one', () => {
    expect(measureGoalLabel({ ...goal, filter_value: 'Bench Press' })).toBe('Bench Press · Best e1RM')
  })

  test('the display name, else the given type name, else the type', () => {
    expect(measureGoalLabel({ ...goal, activity_type_name: 'Strength' })).toBe('Strength · Best e1RM')
    expect(measureGoalLabel(goal, 'Strength training')).toBe('Strength training · Best e1RM')
    expect(measureGoalLabel({ ...goal, measure: 'volume' })).toBe('strength_training · Volume')
  })
})

describe('measureOptions', () => {
  test('every measure with its label, in the order measures are declared', () => {
    const options = measureOptions()
    expect(options.map((o) => o.value)).toEqual([
      'volume',
      'e1rm',
      'max_weight',
      'set_count',
      'max_time',
      'total_reps',
      'max_reps',
    ])
    expect(options[1]).toEqual({ label: 'Best e1RM', value: 'e1rm' })
  })
})

const strength: { name: string; data_schema?: DataSchemaDefinition } = {
  data_schema: {
    fields: [
      { name: 'program', type: 'string' },
      {
        item_fields: [
          { name: 'reps', type: 'number' },
          { is_categorical: true, label: 'Exercise', name: 'exercise', type: 'string' },
        ],
        name: 'sets',
        type: 'list',
      },
    ],
  },
  name: 'strength_training',
}
const coffee = { data_schema: { fields: [{ name: 'cups', type: 'number' as const }] }, name: 'coffee' }
const plain = { data_schema: undefined, name: 'walk' }

describe('measurableTypes', () => {
  test('only the types with a list field', () => {
    expect(measurableTypes([coffee, strength, plain])).toEqual([strength])
  })
})

describe('measureFilter', () => {
  test('the first categorical item field, with its path and label', () => {
    expect(measureFilter(strength)).toEqual({ label: 'Exercise', path: 'sets.exercise' })
    expect(measureFilterPath(strength)).toBe('sets.exercise')
  })

  test('undefined without one', () => {
    expect(measureFilter(coffee)).toBeUndefined()
    expect(measureFilterPath(undefined)).toBeUndefined()
  })
})
