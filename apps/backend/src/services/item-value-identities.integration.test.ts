import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { getActivityById, insertActivity } from '../db/activities/index.ts'
import { upsertItemValueAlias } from '../db/item-value-aliases.ts'
import { listItemValueIdentities, upsertItemValueIdentity } from '../db/item-value-identities.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { mergeItemValues } from './item-value-aliases.ts'
import {
  clearItemValueIdentity,
  getItemValueIdentity,
  listUnmappedItemValues,
  setItemValueIdentity,
} from './item-value-identities.ts'
import { addActivity } from './mutations.ts'
import { queryActivityFieldValues } from './queries/index.ts'

const CONTAINER_TIMEOUT = 120_000
const type = 'strength_training'
const field = 'sets.exercise'

let counter = 0

const addSession = async (...exercises: string[]) => {
  counter++
  return insertActivity(getTestUser(), {
    activity_type: type,
    data: { sets: exercises.map((exercise) => ({ exercise, reps: 5 })) },
    external_id: `ext-${counter}`,
    source: 'gravl',
    start_time: new Date(Date.UTC(2026, 5, counter, 7)),
  })
}

const stored = async () =>
  (await listItemValueIdentities(getTestUser(), field)).map((r) => [r.value, r.catalog_key])

describe('item value identities (integration)', () => {
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

  test('field values carry identities only for a catalogue-backed field', async () => {
    const user = getTestUser()
    await addSession('Lat Pulldown', 'Pulldown', 'Zercher Carry', 'Barbell Squat')
    await upsertItemValueIdentity(user, field, 'pulldown', 'lat_pulldown')
    await upsertItemValueIdentity(user, field, 'Barbell Squat', null)

    const exercises = await queryActivityFieldValues(user, type, field)
    expect(exercises).toMatchObject({ catalog: 'exercises', catalog_version: expect.any(String) })
    expect(Object.fromEntries(exercises.values.map((v) => [v.value, [v.catalog_key, v.state]]))).toEqual({
      'Barbell Squat': [null, 'dismissed'],
      'Lat Pulldown': ['lat_pulldown', 'catalog'],
      Pulldown: ['lat_pulldown', 'user'],
      'Zercher Carry': [null, 'unmapped'],
    })

    const reps = await queryActivityFieldValues(user, type, 'sets.reps')
    expect(reps).not.toHaveProperty('catalog')
    expect(reps).not.toHaveProperty('catalog_version')
    expect(reps.values[0]).not.toHaveProperty('state')
    expect(reps.values[0]).not.toHaveProperty('catalog_key')
  })

  test('the unmapped list leaves out dismissed, mapped and catalogue names, most used first', async () => {
    const user = getTestUser()
    await addSession('Zercher Carry', 'Wide Grip Pulldown', 'Lat Pulldown', 'Pulldown', 'Odd Thing')
    await addSession('Wide Grip Pulldown')
    await upsertItemValueIdentity(user, field, 'Pulldown', 'lat_pulldown')
    await upsertItemValueIdentity(user, field, 'Odd Thing', null)

    const result = await listUnmappedItemValues(user, type, field)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data).toMatchObject({ catalog: 'exercises', field })
    expect(result.data.values.map((v) => [v.value, v.count])).toEqual([
      ['Wide Grip Pulldown', 2],
      ['Zercher Carry', 1],
    ])
    expect(result.data.values[0].last_used).toBe('2026-06-02T07:00:00.000Z')
    expect(result.data.values[0].suggestions.map((s) => s.key)).toContain('wide_grip_lat_pulldown')
  })

  test('set, get, clear and clear again', async () => {
    const user = getTestUser()
    await addSession('Pulldown', 'Lat Pulldown', 'Lats')
    await addSession('Lats')
    await upsertItemValueIdentity(user, field, 'Lats', 'lat_pulldown')

    const set = await setItemValueIdentity(user, type, { field, key: 'lat_pulldown', value: ' Pulldown ' })
    expect(set).toMatchObject({
      data: {
        catalog: 'exercises',
        catalog_key: 'lat_pulldown',
        entry: { key: 'lat_pulldown', name: 'Lat Pulldown' },
        field,
        state: 'user',
        value: 'Pulldown',
      },
      success: true,
    })
    expect(set.success && set.data.other_values).toEqual(
      expect.arrayContaining([
        { count: 2, value: 'Lats' },
        { count: 1, value: 'Lat Pulldown' },
      ]),
    )
    expect(set.success && set.data.other_values).toHaveLength(2)

    const dismissed = await setItemValueIdentity(user, type, { field, key: null, value: 'pulldown' })
    expect(dismissed).toMatchObject({ data: { catalog_key: null, other_values: [], state: 'dismissed' } })
    expect(dismissed.success && dismissed.data).not.toHaveProperty('entry')

    expect(await getItemValueIdentity(user, type, field, 'Never Logged')).toMatchObject({
      data: { catalog_key: null, other_values: [], state: 'unmapped', value: 'Never Logged' },
    })

    expect(await clearItemValueIdentity(user, type, field, 'PULLDOWN')).toEqual({ success: true })
    expect(await getItemValueIdentity(user, type, field, 'Pulldown')).toMatchObject({
      data: { catalog_key: null, state: 'unmapped' },
    })
    expect(await clearItemValueIdentity(user, type, field, 'Pulldown')).toEqual({
      error: expect.stringContaining('not found'),
      success: false,
    })
  })

  test('an unknown key and a field without a catalogue are refused', async () => {
    const user = getTestUser()
    expect(await setItemValueIdentity(user, type, { field, key: 'nope', value: 'X' })).toEqual({
      error: 'Unknown exercise catalogue key "nope"',
      success: false,
    })
    expect(await getItemValueIdentity(user, type, 'sets.note', 'X')).toEqual({
      error: '"sets.note" is not a catalogue-backed item field of "strength_training"',
      success: false,
    })
    expect(await listUnmappedItemValues(user, 'nope', field)).toEqual({
      error: expect.stringContaining('not found'),
      success: false,
    })
    expect(await stored()).toEqual([])
  })

  test('a merge moves the stored identity to a target without one, else drops it', async () => {
    const user = getTestUser()
    await addSession('Pulldown', 'Lats', 'Lat Pull')
    await upsertItemValueIdentity(user, field, 'Pulldown', 'lat_pulldown')
    await upsertItemValueIdentity(user, field, 'Lats', 'lat_pulldown')
    await upsertItemValueIdentity(user, field, 'Lat Pull', null)

    await mergeItemValues(user, type, { field, source: 'Pulldown', target: 'Cable Pulldown' })
    await mergeItemValues(user, type, { field, source: 'Lats', target: 'Lat Pull' })

    expect(await stored()).toEqual([
      ['Cable Pulldown', 'lat_pulldown'],
      ['Lat Pull', null],
    ])
  })

  describe('writing a set by catalogue key', () => {
    const write = (sets: Record<string, unknown>[]) =>
      addActivity(getTestUser(), {
        activity_type: type,
        data: { sets },
        start_time: new Date(Date.UTC(2026, 6, ++counter, 7)),
      })

    test('a key alone is stored as a name, without the key', async () => {
      const result = await write([{ exercise_key: 'lat_pulldown', reps: 8, weight: 50 }])
      expect(result.success).toBe(true)
      const activity = await getActivityById(getTestUser(), result.id ?? '', true)
      expect(activity?.data).toEqual({ sets: [{ exercise: 'Lat Pulldown', reps: 8, weight: 50 }] })
    })

    test("a key alone takes the user's own name for it", async () => {
      const user = getTestUser()
      await addSession('Pulldown')
      await upsertItemValueIdentity(user, field, 'Pulldown', 'lat_pulldown')

      const result = await write([{ exercise_key: 'lat_pulldown', reps: 8 }])
      const activity = await getActivityById(user, result.id ?? '', true)
      expect(activity?.data).toEqual({ sets: [{ exercise: 'Pulldown', reps: 8 }] })
    })

    test('a key next to a new name stores the mapping', async () => {
      const result = await write([{ exercise: 'Cable Pulldown', exercise_key: 'lat_pulldown', reps: 8 }])
      expect(result.success).toBe(true)
      expect(await stored()).toEqual([['Cable Pulldown', 'lat_pulldown']])
      const activity = await getActivityById(getTestUser(), result.id ?? '', true)
      expect(activity?.data).toEqual({ sets: [{ exercise: 'Cable Pulldown', reps: 8 }] })
    })

    test('a key next to an aliased name maps the name that is stored', async () => {
      const user = getTestUser()
      await upsertItemValueAlias(user, field, 'Pulls', 'Cable Pulldown')

      const result = await write([{ exercise: 'Pulls', exercise_key: 'lat_pulldown', reps: 8 }])
      expect(result.success).toBe(true)
      expect(await stored()).toEqual([['Cable Pulldown', 'lat_pulldown']])
      const activity = await getActivityById(user, result.id ?? '', true)
      expect(activity?.data).toEqual({ sets: [{ exercise: 'Cable Pulldown', reps: 8 }] })
    })

    test('a key alone whose catalogue name is aliased is stored under the alias target', async () => {
      const user = getTestUser()
      await upsertItemValueAlias(user, field, 'Lat Pulldown', 'Cable Pulldown')

      const result = await write([{ exercise_key: 'lat_pulldown', reps: 8 }])
      const activity = await getActivityById(user, result.id ?? '', true)
      expect(activity?.data).toEqual({ sets: [{ exercise: 'Cable Pulldown', reps: 8 }] })
    })

    test('a write rejected after validation stores no mapping', async () => {
      const result = await addActivity(getTestUser(), {
        activity_type: type,
        data: { sets: [{ exercise: 'Cable Pulldown', exercise_key: 'lat_pulldown', reps: 8 }] },
        end_time: new Date(Date.UTC(2026, 6, 1, 6)),
        start_time: new Date(Date.UTC(2026, 6, 1, 7)),
      })
      expect(result).toEqual({ error: 'end_time must not be before start_time', success: false })
      expect(await stored()).toEqual([])
    })

    test('an unknown key is rejected', async () => {
      const result = await write([
        { exercise: 'A', reps: 1 },
        { exercise_key: 'nope', reps: 8 },
      ])
      expect(result).toEqual({
        error: 'Data validation failed: sets[1].exercise_key: unknown exercise catalogue key "nope"',
        success: false,
      })
      expect(await stored()).toEqual([])
    })
  })
})
