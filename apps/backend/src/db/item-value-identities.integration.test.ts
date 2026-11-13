import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  deleteItemValueIdentity,
  listItemValueIdentities,
  moveItemValueIdentity,
  upsertItemValueIdentity,
} from './item-value-identities.ts'

const CONTAINER_TIMEOUT = 120_000

const field = 'sets.exercise'

const stored = async () =>
  (await listItemValueIdentities(getTestUser(), field)).map((r) => [r.value, r.catalog_key])

describe('item value identities integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('upsert and list by field, ordered by value', async () => {
    const user = getTestUser()
    const curl = await upsertItemValueIdentity(user, field, 'DB Curl', 'standing_dumbbell_bicep_curl')
    await upsertItemValueIdentity(user, field, 'Bench', null)
    await upsertItemValueIdentity(user, 'laps.stroke', 'Free', 'freestyle')

    expect(curl).toMatchObject({ catalog_key: 'standing_dumbbell_bicep_curl', field, value: 'DB Curl' })
    expect(curl.created_at).toBeInstanceOf(Date)
    expect(curl.updated_at).toBeInstanceOf(Date)
    expect(await stored()).toEqual([
      ['Bench', null],
      ['DB Curl', 'standing_dumbbell_bicep_curl'],
    ])
  })

  test('upsert replaces the row of the same name, trimmed and case-insensitively', async () => {
    const user = getTestUser()
    const first = await upsertItemValueIdentity(user, field, 'DB Curl', 'standing_dumbbell_bicep_curl')
    const second = await upsertItemValueIdentity(user, field, ' db curl', null)

    expect(second.id).toBe(first.id)
    expect(second.updated_at.getTime()).toBeGreaterThanOrEqual(first.updated_at.getTime())
    expect(await stored()).toEqual([[' db curl', null]])
  })

  test('delete by normalised value reports whether a row went', async () => {
    const user = getTestUser()
    await upsertItemValueIdentity(user, field, 'DB Curl', null)
    await upsertItemValueIdentity(user, 'laps.exercise', 'DB Curl', null)

    expect(await deleteItemValueIdentity(user, field, ' db CURL ')).toBe(true)
    expect(await deleteItemValueIdentity(user, field, 'DB Curl')).toBe(false)
    expect(await stored()).toEqual([])
    expect(await listItemValueIdentities(user, 'laps.exercise')).toHaveLength(1)
  })

  describe('moveItemValueIdentity', () => {
    test('moves the row to a target without one', async () => {
      const user = getTestUser()
      await upsertItemValueIdentity(user, field, 'DB Curl', 'standing_dumbbell_bicep_curl')

      expect(await moveItemValueIdentity(user, field, 'db curl', 'Dumbbell Curl')).toBe('moved')
      expect(await stored()).toEqual([['Dumbbell Curl', 'standing_dumbbell_bicep_curl']])
    })

    test('drops the row when the target has its own', async () => {
      const user = getTestUser()
      await upsertItemValueIdentity(user, field, 'DB Curl', 'standing_dumbbell_bicep_curl')
      await upsertItemValueIdentity(user, field, 'Dumbbell Curl', null)

      expect(await moveItemValueIdentity(user, field, 'DB Curl', 'dumbbell curl')).toBe('dropped')
      expect(await stored()).toEqual([['Dumbbell Curl', null]])
    })

    test('a spelling-only merge keeps the row under the new spelling', async () => {
      const user = getTestUser()
      await upsertItemValueIdentity(user, field, 'db curl', 'standing_dumbbell_bicep_curl')

      expect(await moveItemValueIdentity(user, field, 'db curl', 'DB Curl')).toBe('moved')
      expect(await stored()).toEqual([['DB Curl', 'standing_dumbbell_bicep_curl']])
    })

    test('does nothing without a source row, and only in the field', async () => {
      const user = getTestUser()
      await upsertItemValueIdentity(user, 'laps.exercise', 'DB Curl', null)

      expect(await moveItemValueIdentity(user, field, 'DB Curl', 'Dumbbell Curl')).toBe('none')
      expect(await listItemValueIdentities(user, 'laps.exercise')).toMatchObject([{ value: 'DB Curl' }])
    })
  })
})
