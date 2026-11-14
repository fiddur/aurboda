import type { DataSchemaDefinition } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import type { GarminExerciseSet } from './client.ts'

import { loadExerciseCatalog } from '../../services/exercise-catalog.ts'
import { applyItemValueKeys } from '../../services/item-value-identities.ts'
import {
  buildGarminSets,
  type GarminExerciseSetsDeps,
  type GarminSet,
  importActivityExerciseSets,
  nameKeyedSets,
} from './exercise-sets.ts'

const catalog = loadExerciseCatalog()

const set = (overrides: GarminExerciseSet = {}): GarminExerciseSet => ({
  duration: 40,
  exercises: [{ category: 'BENCH_PRESS', name: 'BARBELL_BENCH_PRESS', probability: 90 }],
  repetitionCount: 8,
  setType: 'ACTIVE',
  weight: 60000,
  ...overrides,
})

const build = (...sets: GarminExerciseSet[]) => buildGarminSets({ exerciseSets: sets }, catalog)

describe('buildGarminSets', () => {
  test('a known FIT key names the set by catalogue key, with reps and kg', () => {
    expect(build(set())).toEqual([{ exercise_key: 'barbell_bench_press', reps: 8, weight: 60 }])
  })

  test('rest sets are skipped', () => {
    expect(build(set({ setType: 'REST' }), set({ setType: undefined }))).toHaveLength(1)
  })

  test('the exercise with the highest probability wins, the first on a tie', () => {
    const exercises = [
      { category: 'SQUAT', name: 'SQUAT', probability: 20 },
      { category: 'PULL_UP', name: 'PULL_UP', probability: 70 },
      { category: 'BENCH_PRESS', name: 'BARBELL_BENCH_PRESS', probability: 70 },
      { category: 'PLANK', name: 'PLANK' },
    ]
    expect(build(set({ exercises }))[0].exercise_key).toBe('pull_up')
  })

  test('a weighted variant key resolves to its base entry', () => {
    const exercises = [{ category: 'CALF_RAISE', name: 'WEIGHTED_STANDING_CALF_RAISE', probability: 100 }]
    expect(build(set({ exercises }))[0].exercise_key).toBe('standing_calf_raise')
  })

  test("an unknown name keeps Garmin's name in title case, without falling back to the category", () => {
    const exercises = [{ category: 'PLANK', name: '45_DEGREE_PLANK', probability: 100 }]
    expect(build(set({ exercises }))[0]).toEqual({ exercise: '45 Degree Plank', reps: 8, weight: 60 })
  })

  test("a missing name takes the category's generic entry, else the category in title case", () => {
    expect(build(set({ exercises: [{ category: 'SQUAT', probability: 100 }] }))[0].exercise_key).toBe('squat')
    expect(build(set({ exercises: [{ category: 'SLED', name: null, probability: 100 }] }))[0].exercise).toBe(
      'Sled',
    )
  })

  test('a missing or UNKNOWN category is an unknown exercise', () => {
    expect(
      build(set({ exercises: [{ category: 'UNKNOWN', name: 'X', probability: 100 }] }))[0].exercise,
    ).toBe('Unknown exercise')
    expect(build(set({ exercises: null }))[0].exercise).toBe('Unknown exercise')
    expect(build(set({ exercises: [{ name: 'SQUAT' }] }))[0].exercise).toBe('Unknown exercise')
  })

  test('weight in grams becomes kg rounded to 2 decimals, and no weight is left out', () => {
    expect(build(set({ weight: 22679.6 }))[0].weight).toBe(22.68)
    for (const weight of [-1, null, 0]) expect(build(set({ weight }))[0]).not.toHaveProperty('weight')
  })

  test('a set without reps is timed, a rep set carries no time', () => {
    expect(build(set({ duration: 45.6, repetitionCount: null, weight: null }))[0]).toEqual({
      exercise_key: 'barbell_bench_press',
      time: 46,
    })
    expect(build(set({ duration: 45 }))[0]).not.toHaveProperty('time')
  })

  test('a set with neither reps nor time is dropped', () => {
    expect(
      build(set({ duration: 0, repetitionCount: 0 }), set({ duration: null, repetitionCount: null })),
    ).toEqual([])
  })

  test('no exerciseSets array gives no sets', () => {
    expect(buildGarminSets({ exerciseSets: null }, catalog)).toEqual([])
    expect(buildGarminSets({}, catalog)).toEqual([])
  })
})

describe('nameKeyedSets', () => {
  test('a set still carrying a key takes the catalogue name and loses the key', () => {
    expect(
      nameKeyedSets([{ exercise_key: 'barbell_bench_press', reps: 5 }, { exercise: 'Mine' }], catalog),
    ).toEqual([{ exercise: 'Barbell Bench Press', reps: 5 }, { exercise: 'Mine' }])
  })
})

describe('importActivityExerciseSets', () => {
  const activity = {
    data: { garmin_activity_id: 4242 },
    id: 'activity-1',
    start_time: new Date('2026-11-10T07:00:00Z'),
  }

  const schema: DataSchemaDefinition = {
    fields: [
      {
        item_fields: [{ catalog: 'exercises', is_categorical: true, name: 'exercise', type: 'string' }],
        name: 'sets',
        type: 'list',
      },
    ],
  }

  const fakeDeps = (overrides: Partial<GarminExerciseSetsDeps> = {}) => {
    const stored: GarminSet[][] = []
    const raws: unknown[] = []
    const errors: string[] = []
    const deps: GarminExerciseSetsDeps = {
      aliasActivityData: async (_user, data) => data,
      applyItemValueKeysForWrite: async (_user, _type, data) =>
        applyItemValueKeys(schema, data, () => catalog, { 'sets.exercise': { logged: [], stored: [] } }),
      auditError: async (_user, _category, message) => void errors.push(message),
      insertRawRecord: async (_user, record) => void raws.push(record),
      loadExerciseCatalog: () => catalog,
      setGarminActivitySets: async (_user, _id, sets) => void stored.push(sets),
      ...overrides,
    }
    return { deps, errors, raws, stored }
  }

  test("the user's own name for the entry wins over the catalogue name", async () => {
    const { deps, stored } = fakeDeps({
      applyItemValueKeysForWrite: async (_user, _type, data) =>
        applyItemValueKeys(schema, data, () => catalog, {
          'sets.exercise': {
            logged: [{ count: 4, value: 'Bänkpress' }],
            stored: [{ catalog_key: 'barbell_bench_press', updated_at: new Date(), value: 'Bänkpress' }],
          },
        }),
    })

    expect(await importActivityExerciseSets('alice', activity, { exerciseSets: [set()] }, deps)).toBe(1)
    expect(stored).toEqual([[{ exercise: 'Bänkpress', reps: 8, weight: 60 }]])
  })

  test('no exercise_key reaches the store, even when keys are left on the sets', async () => {
    const { deps, stored } = fakeDeps({
      applyItemValueKeysForWrite: async (_user, _type, data) => ({
        data: { data, mappings: [] },
        success: true,
      }),
    })

    await importActivityExerciseSets('alice', activity, { exerciseSets: [set()] }, deps)

    expect(stored).toEqual([[{ exercise: 'Barbell Bench Press', reps: 8, weight: 60 }]])
  })

  test('aliases are applied to the named sets', async () => {
    const { deps, stored } = fakeDeps({
      aliasActivityData: async (_user, data) => ({
        sets: data.sets.map((s) => (s.exercise === 'Barbell Bench Press' ? { ...s, exercise: 'Bench' } : s)),
      }),
    })

    await importActivityExerciseSets('alice', activity, { exerciseSets: [set()] }, deps)

    expect(stored[0][0].exercise).toBe('Bench')
  })

  test('zero sets still store an empty list, marking the activity read', async () => {
    const { deps, stored } = fakeDeps()

    expect(await importActivityExerciseSets('alice', activity, { exerciseSets: null }, deps)).toBe(0)
    expect(stored).toEqual([[]])
  })

  test('the raw response is kept under its own record type and the activity id', async () => {
    const { deps, raws } = fakeDeps()
    const response = { activityId: 4242, exerciseSets: [set()] }

    await importActivityExerciseSets('alice', activity, response, deps)

    expect(raws).toEqual([
      {
        data: response,
        external_id: 'garmin-activity-4242',
        record_type: 'garmin_exercise_sets',
        recorded_at: activity.start_time,
        source: 'garmin',
      },
    ])
  })

  test('a failure to resolve the names is audited and leaves the activity unmarked', async () => {
    const { deps, errors, stored } = fakeDeps({
      applyItemValueKeysForWrite: async () => ({ error: 'boom', success: false }),
    })

    expect(await importActivityExerciseSets('alice', activity, { exerciseSets: [set()] }, deps)).toBeNull()
    expect(stored).toEqual([])
    expect(errors).toHaveLength(1)
  })
})
