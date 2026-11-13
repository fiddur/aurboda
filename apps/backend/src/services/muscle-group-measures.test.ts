import type { StoredExerciseCatalogEntry } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { measuresByMuscleGroup, muscleGroupSplit, muscleGroupWeights } from './muscle-group-measures.ts'

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
    expect(result.map((g) => g.muscle_group)).toEqual(['chest', 'shoulders', 'triceps', null])
    expect(result[0].measures).toEqual({ set_count: 1.75, total_reps: 11, volume: 460 })
    expect(result[2].measures).toEqual({ set_count: 1.5, total_reps: 10.5, volume: 280 })
    expect(result[3].measures).toEqual({ set_count: 2, total_reps: 5, volume: 500 })
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
  test('names the groups, most sets first and not in the catalogue last', () => {
    const items = [set('Squat', 100, 5), set('Squat', 100, 5), set('Squat', 100, 5), set('Dip', 10, 8)]
    expect(muscleGroupSplit(items, 'exercise', resolve).map((g) => [g.name, g.measures.set_count])).toEqual([
      ['Triceps', 1],
      ['Chest', 0.75],
      ['Not in the catalogue', 3],
    ])
  })
})
