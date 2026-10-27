import { describe, expect, test } from 'vitest'

import {
  aggregationOptions,
  buildSpec,
  defaultUnit,
  emptySpecForm,
  type SpecForm,
  specPatch,
} from './spec-form'

const apply = (form: SpecForm, change: Parameters<typeof specPatch>[1]): SpecForm => ({
  ...form,
  ...specPatch(form, change),
})

const strength: SpecForm = { ...emptySpecForm, pattern: 'strength_training', source_type: 'activity_type' }

describe('defaultUnit', () => {
  test('the measure unit, and sets for a set count', () => {
    expect(defaultUnit('total_reps')).toBe('reps')
    expect(defaultUnit('max_weight')).toBe('kg')
    expect(defaultUnit('max_time')).toBe('s')
    expect(defaultUnit('set_count')).toBe('sets')
  })
})

describe('aggregationOptions', () => {
  test('sum or count without a measure', () => {
    expect(aggregationOptions(undefined).map((o) => o.value)).toEqual(['sum', 'count'])
  })

  test('sum or the best single session with a measure', () => {
    expect(aggregationOptions('max_reps').map((o) => o.value)).toEqual(['sum', 'max'])
  })
})

describe('specPatch', () => {
  test('choosing a measure sets its default aggregation and unit', () => {
    expect(apply(strength, { kind: 'measure', measure: 'max_reps' })).toMatchObject({
      aggregation: 'max',
      measure: 'max_reps',
      unit: 'reps',
    })
    expect(apply(strength, { kind: 'measure', measure: 'total_reps' })).toMatchObject({
      aggregation: 'sum',
      unit: 'reps',
    })
  })

  test('a unit the user typed is kept', () => {
    const typed = { ...strength, unit: 'push-ups' }
    expect(apply(typed, { kind: 'measure', measure: 'total_reps' }).unit).toBe('push-ups')
  })

  test('a unit filled in from the previous measure follows the new one', () => {
    const volume = apply(strength, { kind: 'measure', measure: 'volume' })
    expect(volume.unit).toBe('kg')
    expect(apply(volume, { kind: 'measure', measure: 'set_count' }).unit).toBe('sets')
  })

  test('clearing the measure restores sum, drops the filter and the filled-in unit', () => {
    const measured = apply(apply(strength, { kind: 'measure', measure: 'max_reps' }), {
      kind: 'filter',
      path: 'sets.exercise',
      value: 'Push-ups',
    })
    const cleared = apply(measured, { kind: 'measure', measure: undefined })
    expect(cleared).toMatchObject({ aggregation: 'sum', measure: undefined, unit: '' })
    expect(cleared.filter_field).toBeUndefined()
    expect(cleared.filter_value).toBeUndefined()
  })

  test('clearing the measure keeps a typed unit', () => {
    const measured = { ...apply(strength, { kind: 'measure', measure: 'max_reps' }), unit: 'push-ups' }
    expect(apply(measured, { kind: 'measure', measure: undefined }).unit).toBe('push-ups')
  })

  test('a filter value sets field and value; All clears both', () => {
    const measured = apply(strength, { kind: 'measure', measure: 'total_reps' })
    const filtered = apply(measured, { kind: 'filter', path: 'sets.exercise', value: 'Push-ups' })
    expect(filtered).toMatchObject({ filter_field: 'sets.exercise', filter_value: 'Push-ups' })
    const all = apply(filtered, { kind: 'filter', path: 'sets.exercise', value: '' })
    expect(all.filter_field).toBeUndefined()
    expect(all.filter_value).toBeUndefined()
  })

  test('changing the activity type clears measure and filter', () => {
    const measured = apply(apply(strength, { kind: 'measure', measure: 'max_reps' }), {
      kind: 'filter',
      path: 'sets.exercise',
      value: 'Push-ups',
    })
    const changed = apply(measured, { kind: 'pattern', pattern: 'running' })
    expect(changed).toMatchObject({ aggregation: 'sum', pattern: 'running', unit: '' })
    expect(changed.measure).toBeUndefined()
    expect(changed.filter_field).toBeUndefined()
    expect(changed.filter_value).toBeUndefined()
  })

  test('picking the same activity type again keeps the measure', () => {
    const measured = apply(strength, { kind: 'measure', measure: 'max_reps' })
    expect(apply(measured, { kind: 'pattern', pattern: 'strength_training' }).measure).toBe('max_reps')
  })

  test('changing the source type clears pattern, measure and filter', () => {
    const measured = apply(strength, { kind: 'measure', measure: 'max_reps' })
    const changed = apply(measured, { kind: 'source_type', source_type: 'metric' })
    expect(changed).toMatchObject({ aggregation: 'sum', pattern: '', source_type: 'metric' })
    expect(changed.measure).toBeUndefined()
  })

  test('without a measure, a source change keeps count', () => {
    const counted = { ...strength, aggregation: 'count' as const }
    expect(apply(counted, { kind: 'pattern', pattern: 'running' }).aggregation).toBe('count')
  })
})

describe('buildSpec', () => {
  test('carries the measure fields only when set', () => {
    expect(buildSpec({ ...strength, pattern: ' running ', unit: ' hours ' }, 'auto')).toEqual({
      aggregation: 'sum',
      bucket_size: 'auto',
      pattern: 'running',
      source_type: 'activity_type',
      unit: 'hours',
    })
  })

  test('with a measure and a filter', () => {
    const form = apply(apply(strength, { kind: 'measure', measure: 'max_reps' }), {
      kind: 'filter',
      path: 'sets.exercise',
      value: 'Push-ups',
    })
    expect(buildSpec(form, '1w')).toEqual({
      aggregation: 'max',
      bucket_size: '1w',
      filter_field: 'sets.exercise',
      filter_value: 'Push-ups',
      measure: 'max_reps',
      pattern: 'strength_training',
      source_type: 'activity_type',
      unit: 'reps',
    })
  })
})
