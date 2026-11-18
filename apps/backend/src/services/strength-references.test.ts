import { strengthScoreGroups } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import { loadExerciseCatalog } from './exercise-catalog.ts'
import { muscleGroupWeights } from './muscle-group-measures.ts'
import { loadStrengthReferences } from './strength-references.ts'

const references = loadStrengthReferences()
const catalog = new Map(loadExerciseCatalog().entries.map((entry) => [entry.key, entry]))
const allKeys = references.lifts.flatMap((lift) => lift.keys)

describe('the built-in strength references', () => {
  test('the groups are the score groups, in order', () => {
    expect(references.groups.map((g) => g.key)).toEqual([...strengthScoreGroups])
  })

  test('every lift belongs to a group and every group has at least two lifts', () => {
    for (const group of strengthScoreGroups) {
      expect(references.lifts.filter((lift) => lift.group === group).length, group).toBeGreaterThanOrEqual(2)
    }
  })

  test('lift ids are unique', () => {
    const ids = references.lifts.map((lift) => lift.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('no catalogue key belongs to two lifts or appears twice in one', () => {
    expect(new Set(allKeys).size).toBe(allKeys.length)
    expect(references.liftByCatalogKey.size).toBe(allKeys.length)
  })

  test('every key is in the exercise catalogue', () => {
    expect(allKeys.filter((key) => !catalog.has(key))).toEqual([])
  })

  test("every key's entry trains one of its group's muscle groups at a weight of 0.5 or more", () => {
    const groups = new Map(references.groups.map((g) => [g.key, g.muscle_groups]))
    const weak = references.lifts.flatMap((lift) =>
      lift.keys.filter((key) => {
        const entry = catalog.get(key)
        if (!entry) return true
        const weights = muscleGroupWeights(entry)
        return !(groups.get(lift.group) ?? []).some((group) => (weights[group] ?? 0) >= 0.5)
      }),
    )
    expect(weak).toEqual([])
  })

  test('ratios are positive and no higher for women than for men', () => {
    for (const { id, ratio } of references.lifts) {
      expect(ratio.female, id).toBeGreaterThan(0)
      expect(ratio.female, id).toBeLessThanOrEqual(ratio.male)
    }
  })

  test('a catalogue key looks up its lift', () => {
    expect(references.liftByCatalogKey.get('bench_press')?.id).toBe('barbell_bench_press')
    expect(references.liftByCatalogKey.get('barbell_squat')?.id).toBe('back_squat')
  })

  test('the glutes score from dumbbell and kettlebell lifts too', () => {
    expect(references.liftByCatalogKey.get('dumbbell_deadlift')?.group).toBe('glutes')
    for (const key of ['single_leg_glute_bridge', 'single_leg_hip_raise']) {
      expect(references.liftByCatalogKey.get(key)).toMatchObject({
        group: 'glutes',
        id: 'weighted_single_leg_glute_bridge',
      })
    }
  })
})
