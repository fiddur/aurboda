import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { query } from '../db/connection.ts'
import { getActivityTypeDefinition, insertActivity, insertActivityTypeDefinition } from '../db/index.ts'
import { getUserSettings } from '../db/settings.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { mergeActivityType, updateActivityTypeDefinition } from './activity-type-definitions.ts'

const CONTAINER_TIMEOUT = 120_000

describe('mergeActivityType with set_data (integration)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    await query(getTestUser(), `DELETE FROM activity_type_definitions WHERE is_builtin = false`)
  })

  const givenBeerAndOwnAlcohol = async () => {
    const user = getTestUser()
    await insertActivityTypeDefinition(user, {
      data_schema: { fields: [{ name: 'glasses', type: 'number' }] },
      display_category: 'other',
      display_name: 'Alcohol',
      name: 'alcohol',
    })
    await insertActivityTypeDefinition(user, {
      display_category: 'other',
      display_name: 'Beer',
      name: 'beer',
    })
    await insertActivity(user, {
      activity_type: 'beer',
      end_time: new Date('2026-03-01T21:00:00Z'),
      source: 'aurboda',
      start_time: new Date('2026-03-01T20:00:00Z'),
    })
    return user
  }

  test('a target of a catalogue name gets the catalogue field set_data names, and keeps its own', async () => {
    const user = await givenBeerAndOwnAlcohol()

    const result = await mergeActivityType(user, 'beer', 'alcohol', { kind: 'beer' })

    expect(result).toMatchObject({ activities_data_set: 1, activities_reassigned: 1, success: true })
    const alcohol = await getActivityTypeDefinition(user, 'alcohol')
    expect(alcohol?.data_schema?.fields.map((field) => field.name)).toEqual(['glasses', 'kind'])
    const moved = await query(user, `SELECT data FROM activities WHERE activity_type = 'alcohol'`)
    expect(moved.rows).toEqual([{ data: { kind: 'beer' } }])
  })

  test('a refused merge leaves the target schema as it was', async () => {
    const user = await givenBeerAndOwnAlcohol()

    const result = await mergeActivityType(user, 'beer', 'alcohol', { kind: 'mead' })

    expect(result.success).toBe(false)
    const alcohol = await getActivityTypeDefinition(user, 'alcohol')
    expect(alcohol?.data_schema?.fields.map((field) => field.name)).toEqual(['glasses'])
    expect(await getActivityTypeDefinition(user, 'beer')).not.toBeNull()
  })
})

describe('workout type changes (integration)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    await query(getTestUser(), `DELETE FROM activity_type_definitions WHERE is_builtin = false`)
  })

  test('moving a type into the exercise category marks the hours from its first session dirty', async () => {
    const user = getTestUser()
    await insertActivityTypeDefinition(user, {
      display_category: 'other',
      display_name: 'Padel',
      name: 'padel',
    })
    await insertActivity(user, {
      activity_type: 'padel',
      end_time: new Date('2026-03-01T21:00:00Z'),
      source: 'aurboda',
      start_time: new Date('2026-03-01T19:45:00Z'),
    })

    await updateActivityTypeDefinition(user, 'padel', { display_name: 'Padel!' })
    expect((await getUserSettings(user))?.training_load?.impulse_watermark).toBeUndefined()

    await updateActivityTypeDefinition(user, 'padel', { display_category: 'exercise' })
    expect((await getUserSettings(user))?.training_load?.impulse_watermark).toBe('2026-03-01T19:00:00.000Z')
  })
})
