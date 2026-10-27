import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { deleteActivity, getActivityById, insertActivity, rewriteItemValue } from './activities/index.ts'
import {
  deleteItemValueAlias,
  deleteItemValueAliasesByAlias,
  listItemValueAliases,
  repointItemValueAliases,
  upsertItemValueAlias,
} from './item-value-aliases.ts'

const CONTAINER_TIMEOUT = 120_000

let counter = 0

const addSession = async (data: Record<string, unknown>, activityType = 'strength_training') => {
  counter++
  return insertActivity(getTestUser(), {
    activity_type: activityType,
    data,
    external_id: `ext-${counter}`,
    source: 'gravl',
    start_time: new Date(Date.UTC(2026, 5, counter, 7)),
  })
}

const dataOf = async (id: string) => (await getActivityById(getTestUser(), id, true))?.data

describe('item value aliases integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    counter = 0
  })

  describe('aliases', () => {
    test('upsert, list by field ordered by alias, and delete', async () => {
      const user = getTestUser()
      const curl = await upsertItemValueAlias(user, 'sets.exercise', 'Dumbbell Bicep Curl', 'Dumbbell Curl')
      await upsertItemValueAlias(user, 'sets.exercise', 'Bench', 'Bench Press')
      await upsertItemValueAlias(user, 'laps.stroke', 'Free', 'Freestyle')

      expect(curl).toMatchObject({
        alias: 'Dumbbell Bicep Curl',
        field: 'sets.exercise',
        value: 'Dumbbell Curl',
      })
      expect(curl.created_at).toBeInstanceOf(Date)
      expect((await listItemValueAliases(user, 'sets.exercise')).map((a) => a.alias)).toEqual([
        'Bench',
        'Dumbbell Bicep Curl',
      ])
      expect(await listItemValueAliases(user)).toHaveLength(3)

      expect(await deleteItemValueAlias(user, curl.id)).toBe(true)
      expect(await deleteItemValueAlias(user, curl.id)).toBe(false)
      expect((await listItemValueAliases(user, 'sets.exercise')).map((a) => a.alias)).toEqual(['Bench'])
    })

    test('an upsert of the same alias in another spelling replaces it', async () => {
      const user = getTestUser()
      const first = await upsertItemValueAlias(user, 'sets.exercise', 'DB Curl', 'Curl')
      const second = await upsertItemValueAlias(user, 'sets.exercise', ' db curl', 'Dumbbell Curl')

      expect(second.id).toBe(first.id)
      expect(await listItemValueAliases(user, 'sets.exercise')).toEqual([
        expect.objectContaining({ alias: ' db curl', value: 'Dumbbell Curl' }),
      ])
    })

    test('the same alias may exist in another field', async () => {
      const user = getTestUser()
      await upsertItemValueAlias(user, 'sets.exercise', 'Row', 'Barbell Row')
      await upsertItemValueAlias(user, 'laps.exercise', 'Row', 'Rowing')
      expect(await listItemValueAliases(user)).toHaveLength(2)
    })

    test('repoint moves the aliases of one value of the field to another', async () => {
      const user = getTestUser()
      await upsertItemValueAlias(user, 'sets.exercise', 'DB Curl', 'Dumbbell Bicep Curl')
      await upsertItemValueAlias(user, 'sets.exercise', 'Bicep Curl', ' dumbbell bicep curl')
      await upsertItemValueAlias(user, 'sets.exercise', 'Bench', 'Bench Press')
      await upsertItemValueAlias(user, 'laps.exercise', 'X', 'Dumbbell Bicep Curl')

      expect(
        await repointItemValueAliases(user, 'sets.exercise', 'Dumbbell Bicep Curl', 'Dumbbell Curl'),
      ).toBe(2)

      const values = Object.fromEntries(
        (await listItemValueAliases(user)).map((a) => [`${a.field}:${a.alias}`, a.value]),
      )
      expect(values).toEqual({
        'laps.exercise:X': 'Dumbbell Bicep Curl',
        'sets.exercise:Bench': 'Bench Press',
        'sets.exercise:Bicep Curl': 'Dumbbell Curl',
        'sets.exercise:DB Curl': 'Dumbbell Curl',
      })
    })

    test('delete by alias removes the alias in any spelling, in that field only', async () => {
      const user = getTestUser()
      await upsertItemValueAlias(user, 'sets.exercise', 'Dumbbell Curl', 'Curl')
      await upsertItemValueAlias(user, 'laps.exercise', 'Dumbbell Curl', 'Curl')

      expect(await deleteItemValueAliasesByAlias(user, 'sets.exercise', ' dumbbell CURL ')).toBe(1)
      expect((await listItemValueAliases(user)).map((a) => a.field)).toEqual(['laps.exercise'])
    })
  })

  describe('rewriteItemValue', () => {
    test('rewrites matching items only, keeping order and other keys, and counts the activities', async () => {
      const user = getTestUser()
      const mixed = await addSession({
        set_count: 3,
        sets: [
          { exercise: 'Dumbbell Bicep Curl', reps: 10, weight: 12 },
          { exercise: 'Bench Press', reps: 5, weight: 80 },
          { exercise: '  dumbbell bicep CURL ', reps: 8, set_type: 'warmup' },
          'not an item',
        ],
      })
      const other = await addSession({ sets: [{ exercise: 'Squat', reps: 5 }] })
      const noSets = await addSession({ note: 'rest day' })

      expect(
        await rewriteItemValue(
          user,
          ['strength_training'],
          'sets',
          'exercise',
          'Dumbbell Bicep Curl',
          'Dumbbell Curl',
        ),
      ).toBe(1)

      expect(await dataOf(mixed)).toEqual({
        set_count: 3,
        sets: [
          { exercise: 'Dumbbell Curl', reps: 10, weight: 12 },
          { exercise: 'Bench Press', reps: 5, weight: 80 },
          { exercise: 'Dumbbell Curl', reps: 8, set_type: 'warmup' },
          'not an item',
        ],
      })
      expect(await dataOf(other)).toEqual({ sets: [{ exercise: 'Squat', reps: 5 }] })
      expect(await dataOf(noSets)).toEqual({ note: 'rest day' })
    })

    test('only touches live activities of the given types', async () => {
      const user = getTestUser()
      const sets = [{ exercise: 'Pull Up', reps: 8 }]
      const strength = await addSession({ sets })
      const calisthenics = await addSession({ sets }, 'calisthenics')
      const yoga = await addSession({ sets }, 'yoga')
      const deleted = await addSession({ sets })
      await deleteActivity(user, deleted)

      expect(
        await rewriteItemValue(
          user,
          ['strength_training', 'calisthenics'],
          'sets',
          'exercise',
          'pull up',
          'Pull-up',
        ),
      ).toBe(2)

      expect(await dataOf(strength)).toEqual({ sets: [{ exercise: 'Pull-up', reps: 8 }] })
      expect(await dataOf(calisthenics)).toEqual({ sets: [{ exercise: 'Pull-up', reps: 8 }] })
      expect(await dataOf(yoga)).toEqual({ sets })
      expect(await dataOf(deleted)).toEqual({ sets })
    })

    test('a spelling-only rewrite counts only the activities whose spelling changed', async () => {
      const user = getTestUser()
      const lower = await addSession({ sets: [{ exercise: 'pull up' }, { exercise: 'Pull Up' }] })
      await addSession({ sets: [{ exercise: 'Pull Up' }] })

      expect(
        await rewriteItemValue(user, ['strength_training'], 'sets', 'exercise', 'pull up', 'Pull Up'),
      ).toBe(1)
      expect(await dataOf(lower)).toEqual({ sets: [{ exercise: 'Pull Up' }, { exercise: 'Pull Up' }] })
    })

    test('returns 0 for no types or an empty source', async () => {
      const user = getTestUser()
      await addSession({ sets: [{ exercise: 'Pull Up' }] })
      expect(await rewriteItemValue(user, [], 'sets', 'exercise', 'Pull Up', 'Pull-up')).toBe(0)
      expect(await rewriteItemValue(user, ['strength_training'], 'sets', 'exercise', '  ', 'Pull-up')).toBe(0)
    })
  })
})
