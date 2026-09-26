import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { query } from '../db/connection.ts'
import { insertActivity, insertScreentimeCategory } from '../db/index.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { retypeLegacyScreentime } from './retype-legacy-screentime.ts'
import { createCategory } from './screentime-categories.ts'

const CONTAINER_TIMEOUT = 120_000

const START = '2026-06-01T08:00:00Z'

const legacy = (category_path: string, start = START) => ({
  activity_type: 'screentime',
  data: { category_path },
  end_time: new Date(new Date(start).getTime() + 30 * 60_000),
  external_id: `activitywatch_${new Date(start).getTime()}_${category_path}`,
  source: 'activitywatch' as const,
  start_time: new Date(start),
})

const getRow = async (id: string) => {
  const result = await query(
    getTestUser(),
    `SELECT activity_type, deleted_at FROM activities WHERE id = $1`,
    [id],
  )
  return result.rows[0] as { activity_type: string; deleted_at: Date | null }
}

describe('retypeLegacyScreentime', () => {
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

  test('retypes a legacy row whose path matches a category', async () => {
    const user = getTestUser()
    const cat = await createCategory(user, { name: ['Work', 'Dev'], rule_regex: 'vim', rule_type: 'regex' })
    const id = await insertActivity(user, legacy('Work > Dev'))

    const result = await retypeLegacyScreentime(user)

    expect(result).toEqual({ deduplicated: 0, retyped: 1, skipped: false })
    expect(await getRow(id)).toEqual({ activity_type: cat.activity_type_name, deleted_at: null })
  })

  test('soft-deletes a legacy row that has a v2 twin and leaves the twin alone', async () => {
    const user = getTestUser()
    const cat = await createCategory(user, { name: ['Games'], rule_regex: 'steam', rule_type: 'regex' })
    const legacyId = await insertActivity(user, legacy('Games'))
    const v2Id = await insertActivity(user, {
      ...legacy('Games'),
      activity_type: cat.activity_type_name!,
      external_id: `activitywatch_${new Date(START).getTime()}_${cat.activity_type_name}`,
    })

    const result = await retypeLegacyScreentime(user)

    expect(result).toEqual({ deduplicated: 1, retyped: 0, skipped: false })
    const legacyRow = await getRow(legacyId)
    expect(legacyRow.activity_type).toBe('screentime')
    expect(legacyRow.deleted_at).not.toBeNull()
    expect(await getRow(v2Id)).toEqual({ activity_type: cat.activity_type_name, deleted_at: null })
  })

  test('leaves a legacy row with an unknown path as screentime', async () => {
    const user = getTestUser()
    await createCategory(user, { name: ['Work'], rule_type: 'none' })
    const id = await insertActivity(user, legacy('Gone > Away'))

    const result = await retypeLegacyScreentime(user)

    expect(result).toEqual({ deduplicated: 0, retyped: 0, skipped: false })
    expect(await getRow(id)).toEqual({ activity_type: 'screentime', deleted_at: null })
  })

  test('leaves legacy rows at or under an excluded category as screentime', async () => {
    const user = getTestUser()
    await createCategory(user, { exclude_from_screentime: true, name: ['Idle'], rule_type: 'none' })
    await createCategory(user, { name: ['Idle', 'Lock'], rule_regex: 'lock', rule_type: 'regex' })
    const parentId = await insertActivity(user, legacy('Idle'))
    const childId = await insertActivity(user, legacy('Idle > Lock', '2026-06-01T09:00:00Z'))

    const result = await retypeLegacyScreentime(user)

    expect(result).toEqual({ deduplicated: 0, retyped: 0, skipped: false })
    expect(await getRow(parentId)).toEqual({ activity_type: 'screentime', deleted_at: null })
    expect(await getRow(childId)).toEqual({ activity_type: 'screentime', deleted_at: null })
  })

  test('a second run is skipped via sync_state', async () => {
    const user = getTestUser()
    await createCategory(user, { name: ['Work'], rule_type: 'none' })
    await insertActivity(user, legacy('Work'))
    await retypeLegacyScreentime(user)

    const lateId = await insertActivity(user, legacy('Work', '2026-06-02T08:00:00Z'))
    const result = await retypeLegacyScreentime(user)

    expect(result).toEqual({ deduplicated: 0, retyped: 0, skipped: true })
    expect((await getRow(lateId)).activity_type).toBe('screentime')
  })

  test('mints a type for a category without one before retyping its rows', async () => {
    const user = getTestUser()
    const bare = await insertScreentimeCategory(user, { name: ['Reading'], rule_type: 'none' })
    expect(bare.activity_type_name).toBeFalsy()
    const id = await insertActivity(user, legacy('Reading'))

    const result = await retypeLegacyScreentime(user)

    const typed = await query(user, `SELECT activity_type_name FROM screentime_categories WHERE id = $1`, [
      bare.id,
    ])
    const typeName = typed.rows[0].activity_type_name as string
    expect(typeName).toBeTruthy()
    expect(result.retyped).toBe(1)
    expect((await getRow(id)).activity_type).toBe(typeName)
  })
})
