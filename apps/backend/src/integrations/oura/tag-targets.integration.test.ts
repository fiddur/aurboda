import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { query } from '../../db/connection.ts'
import { getActivityTypeDefinition, insertActivityTypeDefinition } from '../../db/index.ts'
import { getCatalogActivityType, loadActivityTypeCatalog } from '../../services/activity-type-catalog.ts'
import { mergeActivityType } from '../../services/activity-type-definitions.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../../test/db-test-helper.ts'
import { processOuraData } from './process.ts'

const CONTAINER_TIMEOUT = 120_000

const bareTag = (code: string, external_id: string) => ({
  end_time: new Date('2026-03-01T21:00:00Z'),
  external_id,
  source: 'oura' as const,
  start_time: new Date('2026-03-01T20:00:00Z'),
  tag: code,
  tag_from_code: true,
  tag_key: code,
})

const activityOf = async (external_id: string) => {
  const result = await query(
    getTestUser(),
    `SELECT activity_type, data FROM activities WHERE external_id = $1 AND deleted_at IS NULL`,
    [external_id],
  )
  return result.rows[0] as { activity_type: string; data: Record<string, unknown> | null }
}

describe('Oura tags landing on built-in activity types', () => {
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

  test('a bare known code lands on the catalogue type with the field value', async () => {
    const user = getTestUser()
    await processOuraData(user, 'tags', [bareTag('tag_generic_back_pain', 'oura-tag-1')])

    const activity = await activityOf('oura-tag-1')
    expect(activity.activity_type).toBe('pain')
    expect(activity.data).toMatchObject({ location: 'back', tag_key: 'tag_generic_back_pain' })
    const pain = await getActivityTypeDefinition(user, 'pain')
    expect(pain?.data_schema).toEqual(getCatalogActivityType(loadActivityTypeCatalog(), 'pain')?.data_schema)
    expect(await getActivityTypeDefinition(user, 'tag_generic_back_pain')).toBeNull()
  })

  test('a type named after the code keeps its tags until merged, then the built-in type takes them', async () => {
    const user = getTestUser()
    await insertActivityTypeDefinition(user, {
      display_category: 'other',
      display_name: 'tag_generic_back_pain',
      name: 'tag_generic_back_pain',
    })

    await processOuraData(user, 'tags', [bareTag('tag_generic_back_pain', 'oura-tag-2')])
    const before = await activityOf('oura-tag-2')
    expect(before.activity_type).toBe('tag_generic_back_pain')
    expect(before.data).toEqual({ tag_key: 'tag_generic_back_pain' })

    expect(
      (await mergeActivityType(user, 'tag_generic_back_pain', 'pain', { location: 'back' })).success,
    ).toBe(true)

    await processOuraData(user, 'tags', [bareTag('tag_generic_back_pain', 'oura-tag-3')])
    const after = await activityOf('oura-tag-3')
    expect(after.activity_type).toBe('pain')
    expect(after.data).toMatchObject({ location: 'back', tag_key: 'tag_generic_back_pain' })
  })

  test('a bare nap code lands on the built-in nap type', async () => {
    await processOuraData(getTestUser(), 'tags', [bareTag('tag_generic_nap', 'oura-tag-4')])
    const activity = await activityOf('oura-tag-4')
    expect(activity.activity_type).toBe('nap')
    expect(activity.data).toEqual({ tag_key: 'tag_generic_nap' })
  })
})
