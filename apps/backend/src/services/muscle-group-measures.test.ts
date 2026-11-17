import type { StoredExerciseCatalogEntry } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  measuresByMuscleGroup,
  muscleGroupContributions,
  muscleGroupSplit,
  muscleGroupWeights,
} from './muscle-group-measures.ts'

const entry = (key: string, muscles: StoredExerciseCatalogEntry['muscles']): StoredExerciseCatalogEntry => ({
  aliases: [],
  category: 'strength',
  equipment: [],
  key,
  muscles,
  name: key,
  same_as: { bodybuild: key },
  search_terms: [],
})

const bench = entry('bench_press', {
  front_delts: 0.5,
  lower_pecs: 1,
  triceps_long_head: 0.25,
  triceps_medial_lateral: 0.5,
  upper_pecs: 1,
})
const dip = entry('dip', { lower_pecs: 0.75, triceps: 1 })
const plank = entry('plank', {})

const entries: Record<string, StoredExerciseCatalogEntry> = { 'bench press': bench, dip, plank }
const resolve = (value: string) => entries[value.trim().toLowerCase()]

const set = (exercise: string, weight: number, reps: number, set_type = 'normal') => ({
  exercise,
  reps,
  set_type,
  weight,
})

describe('muscleGroupWeights', () => {
  test('the highest weight within a group, per group', () => {
    expect(muscleGroupWeights(bench)).toEqual({ chest: 1, shoulders: 0.5, triceps: 0.5 })
  })

  test('a free-exercise-db style entry with group keys only', () => {
    expect(muscleGroupWeights(entry('row', { biceps: 0.5, lats: 1, middle_back: 1 }))).toEqual({
      biceps: 0.5,
      lats: 1,
      middle_back: 1,
    })
  })

  test('zero weights are left out', () => {
    expect(muscleGroupWeights(entry('x', { calves: 0, chest: 1 }))).toEqual({ chest: 1 })
  })
})

describe('measuresByMuscleGroup', () => {
  test('weights the three summed measures, warmups excluded', () => {
    const items = [set('Bench Press', 40, 10, 'warmup'), set('Bench Press', 80, 5), set('bench press', 80, 5)]
    expect(measuresByMuscleGroup(items, 'exercise', resolve)).toEqual([
      { measures: { set_count: 2, total_reps: 10, volume: 800 }, muscle_group: 'chest' },
      { measures: { set_count: 1, total_reps: 5, volume: 400 }, muscle_group: 'shoulders' },
      { measures: { set_count: 1, total_reps: 5, volume: 400 }, muscle_group: 'triceps' },
    ])
  })

  test('two exercises add into one group, in catalogue group order with unmapped last', () => {
    const items = [
      set('Squat', 100, 5),
      set('Dip', 10, 8),
      set('Bench Press', 80, 5),
      { exercise: 'Plank', time: 60 },
      { reps: 5, weight: 20 },
    ]
    const result = measuresByMuscleGroup(items, 'exercise', resolve)
    expect(result.map((g) => [g.muscle_group, g.in_catalogue])).toEqual([
      ['chest', undefined],
      ['shoulders', undefined],
      ['triceps', undefined],
      [null, true],
      [null, false],
    ])
    expect(result[0].measures).toEqual({ set_count: 1.75, total_reps: 11, volume: 460 })
    expect(result[2].measures).toEqual({ set_count: 1.5, total_reps: 10.5, volume: 280 })
    expect(result[3].measures).toEqual({ set_count: 1 })
    expect(result[4].measures).toEqual({ set_count: 1, total_reps: 5, volume: 500 })
  })

  test('an entry without muscle data is apart from a name without an entry', () => {
    const items = [set('Plank', 0, 1), set('Plank', 0, 1), set('Squat', 100, 5)]
    expect(measuresByMuscleGroup(items, 'exercise', resolve)).toEqual([
      { in_catalogue: true, measures: { set_count: 2, total_reps: 2 }, muscle_group: null },
      { in_catalogue: false, measures: { set_count: 1, total_reps: 5, volume: 500 }, muscle_group: null },
    ])
  })

  test('rounds to two decimals', () => {
    const third = entry('third', { calves: 1 / 3 })
    const result = measuresByMuscleGroup([set('Third', 10, 1)], 'exercise', () => third)
    expect(result).toEqual([
      { measures: { set_count: 0.33, total_reps: 0.33, volume: 3.33 }, muscle_group: 'calves' },
    ])
  })

  test('only warmups give nothing', () => {
    expect(measuresByMuscleGroup([set('Bench Press', 40, 10, 'warmup')], 'exercise', resolve)).toEqual([])
  })
})

describe('muscleGroupSplit', () => {
  test('names the groups, most sets first and the groups without muscles last', () => {
    const items = [
      set('Squat', 100, 5),
      set('Squat', 100, 5),
      set('Squat', 100, 5),
      set('Dip', 10, 8),
      set('Plank', 0, 1),
    ]
    expect(muscleGroupSplit(items, 'exercise', resolve).map((g) => [g.name, g.measures.set_count])).toEqual([
      ['Triceps', 1],
      ['Chest', 0.75],
      ['Not in the catalogue', 3],
      ['No muscle group', 1],
    ])
  })
})

describe('muscleGroupContributions', () => {
  test('each exercise training the group, its summed measures times its weight', () => {
    const items = [set('Bench Press', 80, 5), set('Dip', 10, 8), set('Bench Press', 40, 10, 'warmup')]
    expect(muscleGroupContributions(items, 'exercise', resolve, 'triceps')).toEqual([
      {
        measures: { set_count: 0.5, total_reps: 2.5, volume: 200 },
        normalized: 'bench press',
        value: 'Bench Press',
        weight: 0.5,
      },
      { measures: { set_count: 1, total_reps: 8, volume: 80 }, normalized: 'dip', value: 'Dip', weight: 1 },
    ])
  })

  test('leaves out exercises that do not train the group and those not in the catalogue', () => {
    const items = [set('Bench Press', 80, 5), set('Plank', 0, 1), set('Squat', 100, 5)]
    expect(muscleGroupContributions(items, 'exercise', resolve, 'calves')).toEqual([])
    expect(muscleGroupContributions(items, 'exercise', resolve, 'chest').map((c) => c.value)).toEqual([
      'Bench Press',
    ])
  })

  test('two spellings of one exercise are one contribution, spelled as first logged', () => {
    const items = [set('bench press', 80, 5), set('Bench Press ', 80, 5)]
    expect(muscleGroupContributions(items, 'exercise', resolve, 'shoulders')).toEqual([
      {
        measures: { set_count: 1, total_reps: 5, volume: 400 },
        normalized: 'bench press',
        value: 'bench press',
        weight: 0.5,
      },
    ])
  })

  test('only the summed measures, unrounded', () => {
    const third = entry('third', { calves: 1 / 3 })
    const [contribution] = muscleGroupContributions([set('Third', 10, 1)], 'exercise', () => third, 'calves')
    expect(Object.keys(contribution.measures).toSorted()).toEqual(['set_count', 'total_reps', 'volume'])
    expect(contribution.measures.set_count).toBe(1 / 3)
  })

  test('an exercise with only warmups gives nothing', () => {
    expect(muscleGroupContributions([set('Dip', 10, 8, 'warmup')], 'exercise', resolve, 'triceps')).toEqual(
      [],
    )
  })
})
