import { describe, expect, test } from 'vitest'

import {
  combineMeasures,
  groupItemsByKey,
  isWorkingItem,
  listItems,
  measureItems,
  normalizeItemValue,
  parseFieldPath,
  recordsFor,
} from './activity-measures.ts'

const set = (exercise: string | null, weight: number | null, reps: number | null, extra = {}) => ({
  exercise,
  reps,
  weight,
  ...extra,
})

describe('parseFieldPath', () => {
  test('splits an item path, leaves a plain field alone', () => {
    expect(parseFieldPath('sets.exercise')).toEqual({ field: 'sets', key: 'exercise' })
    expect(parseFieldPath('session_name')).toEqual({ field: 'session_name' })
  })
})

describe('normalizeItemValue', () => {
  test('trims and lowercases, empty and nullish are no value', () => {
    expect(normalizeItemValue('  Bench Press ')).toBe('bench press')
    expect(normalizeItemValue(5)).toBe('5')
    expect(normalizeItemValue('   ')).toBeUndefined()
    expect(normalizeItemValue(null)).toBeUndefined()
    expect(normalizeItemValue(undefined)).toBeUndefined()
  })
})

describe('listItems', () => {
  test('object items of an array field only', () => {
    expect(listItems({ sets: [{ a: 1 }, 'x', null, [1], { b: 2 }] }, 'sets')).toEqual([{ a: 1 }, { b: 2 }])
    expect(listItems({ sets: 'nope' }, 'sets')).toEqual([])
    expect(listItems(undefined, 'sets')).toEqual([])
  })
})

describe('isWorkingItem', () => {
  test('warmups (any case) are not working sets', () => {
    expect(isWorkingItem({ set_type: 'warmup' })).toBe(false)
    expect(isWorkingItem({ set_type: ' WarmUp ' })).toBe(false)
    expect(isWorkingItem({ set_type: 'working' })).toBe(true)
    expect(isWorkingItem({})).toBe(true)
  })
})

describe('measureItems', () => {
  test('Gravl-shaped sets with nulls, warmups excluded', () => {
    const measures = measureItems([
      set('Bench Press', 40, 10, { set_type: 'warmup', time: null }),
      set('Bench Press', 80, 5, { set_type: 'working', time: null }),
      set('Bench Press', 85, 3, { time: null }),
      set('Bench Press', null, null, { time: null }),
    ])
    expect(measures).toEqual({
      e1rm: 93.5,
      max_weight: 85,
      set_count: 3,
      volume: 80 * 5 + 85 * 3,
    })
  })

  test('Epley rounds to one decimal', () => {
    expect(measureItems([set('Squat', 102.5, 7)]).e1rm).toBe(126.4)
  })

  test('a time-only set gives max_time and a set count, no volume', () => {
    expect(
      measureItems([
        { exercise: 'Plank', time: 60 },
        { exercise: 'Plank', time: 45 },
      ]),
    ).toEqual({
      max_time: 60,
      set_count: 2,
    })
  })

  test('a bodyweight set (reps only) counts but has no volume or e1rm', () => {
    expect(measureItems([set('Pull-up', null, 8)])).toEqual({ set_count: 1 })
  })

  test('non-positive and non-numeric values are absent', () => {
    expect(
      measureItems([
        { reps: '5', weight: 0 },
        { reps: -1, weight: 50 },
      ]),
    ).toEqual({
      max_weight: 50,
      set_count: 2,
    })
  })

  test('no working items → no measures', () => {
    expect(measureItems([])).toEqual({})
    expect(measureItems([set('Bench', 40, 10, { set_type: 'warmup' })])).toEqual({})
  })
})

describe('combineMeasures', () => {
  test('sums volume and set_count, maxes the rest, absent stays absent', () => {
    expect(
      combineMeasures([
        { e1rm: 90, max_weight: 80, set_count: 3, volume: 1000 },
        { e1rm: 95, max_weight: 78, set_count: 2, volume: 500 },
        { max_time: 30, set_count: 1 },
      ]),
    ).toEqual({ e1rm: 95, max_time: 30, max_weight: 80, set_count: 6, volume: 1500 })
    expect(combineMeasures([])).toEqual({})
    expect(combineMeasures([{}, { set_count: 1 }])).toEqual({ set_count: 1 })
  })
})

describe('groupItemsByKey', () => {
  test('groups by normalised value in order of first appearance, dropping items without one', () => {
    const items = [
      set('Bench Press', 80, 5),
      set('squat', 100, 5),
      set(' bench press', 85, 3),
      set(null, 10, 10),
      set('  ', 10, 10),
    ]
    expect(groupItemsByKey(items, 'exercise')).toEqual([
      { items: [items[0], items[2]], normalized: 'bench press', value: 'Bench Press' },
      { items: [items[1]], normalized: 'squat', value: 'squat' },
    ])
  })
})

describe('recordsFor', () => {
  test('strictly greater than every earlier session', () => {
    expect(
      recordsFor({ e1rm: 100, max_time: 30, max_weight: 80, set_count: 5, volume: 2000 }, [
        { e1rm: 95, max_weight: 80, set_count: 9, volume: 3000 },
        { e1rm: 99 },
      ]),
    ).toEqual(['e1rm', 'max_time'])
  })

  test('the first time is a record; an absent measure never is', () => {
    expect(recordsFor({ max_weight: 50, set_count: 1 }, [])).toEqual(['max_weight'])
    expect(recordsFor({ set_count: 1 }, [{ e1rm: 10 }])).toEqual([])
  })
})
