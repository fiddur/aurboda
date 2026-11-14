import { describe, expect, it } from 'vitest'

import { getExerciseByKey, loadExerciseCatalog } from './exercise-catalog.ts'
import {
  singleLiftExerciseName,
  singleLiftTypeForHealthConnect,
  singleLiftTypes,
} from './single-lift-types.ts'

const seeded: Record<string, number> = {
  back_extension: 1,
  barbell_shoulder_press: 3,
  bench_press: 6,
  bench_sit_up: 7,
  burpee: 12,
  crunch: 15,
  deadlift: 17,
  dumbbell_curl_left_arm: 18,
  dumbbell_curl_right_arm: 19,
  dumbbell_front_raise: 20,
  dumbbell_lateral_raise: 21,
  dumbbell_triceps_extension_left_arm: 22,
  dumbbell_triceps_extension_right_arm: 23,
  dumbbell_triceps_extension_two_arm: 24,
  forward_twist: 30,
  jumping_jack: 40,
  lat_pull_down: 42,
  lunge: 43,
  plank: 49,
  squat: 67,
  upper_twist: 77,
}

describe('singleLiftTypes', () => {
  it('holds the 21 legacy types with their seeded Health Connect numbers', () => {
    expect(
      Object.fromEntries(
        Object.entries(singleLiftTypes).map(([n, t]) => [n, t.health_connect_exercise_type]),
      ),
    ).toEqual(seeded)
  })

  it('names only catalogue keys that exist', () => {
    const catalog = loadExerciseCatalog()
    const missing = Object.values(singleLiftTypes)
      .map((t) => t.exercise_key)
      .filter((key): key is string => key !== null && !getExerciseByKey(catalog, key))
    expect(missing).toEqual([])
  })
})

describe('singleLiftExerciseName', () => {
  it('uses the catalogue name, else the display name', () => {
    const catalog = loadExerciseCatalog()
    expect(singleLiftExerciseName('bench_press')).toBe('Bench Press')
    expect(singleLiftExerciseName('crunch')).toBe(getExerciseByKey(catalog, 'lying_ab_crunch')?.name)
    expect(singleLiftExerciseName('jumping_jack')).toBe('Jumping Jack')
  })

  it('is undefined for another type', () => {
    expect(singleLiftExerciseName('running')).toBeUndefined()
  })
})

describe('singleLiftTypeForHealthConnect', () => {
  it('maps a legacy session number to its type', () => {
    expect(singleLiftTypeForHealthConnect(6)).toBe('bench_press')
  })

  it('ignores other numbers and non-numbers', () => {
    expect(singleLiftTypeForHealthConnect(70)).toBeUndefined()
    expect(singleLiftTypeForHealthConnect('6')).toBeUndefined()
    expect(singleLiftTypeForHealthConnect(undefined)).toBeUndefined()
  })
})
