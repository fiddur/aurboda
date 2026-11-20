import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { getOverrideForActivity, insertActivity } from '../db/activities/index.ts'
import { insertPerson, softDeletePerson } from '../db/people.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { activityPeopleOf } from './activity-people.ts'
import { addActivity, mergeActivities, updateActivity } from './mutations.ts'
import { queryActivities } from './queries/activities.ts'

const CONTAINER_TIMEOUT = 120_000
const MISSING = '99999999-9999-4999-8999-999999999999'

describe('who an activity was with (integration)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  const walk = (start: string) => ({
    activity_type: 'walking' as const,
    end_time: new Date(new Date(start).getTime() + 3_600_000),
    start_time: new Date(start),
  })

  test('people on add, replaced on update, cleared with [], and read back by name', async () => {
    const user = getTestUser()
    const anna = await insertPerson(user, { name: 'Anna' })
    const bo = await insertPerson(user, { name: 'Bo' })

    const added = await addActivity(user, { ...walk('2026-11-01T10:00:00Z'), people: [bo.id, anna.id] })
    expect(added.success).toBe(true)
    expect(await activityPeopleOf(user, [added.id])).toEqual([
      { id: anna.id, name: 'Anna' },
      { id: bo.id, name: 'Bo' },
    ])

    expect((await updateActivity(user, added.id!, { title: 'Stroll' })).success).toBe(true)
    expect(await activityPeopleOf(user, [added.id])).toHaveLength(2)

    expect((await updateActivity(user, added.id!, { people: [bo.id] })).success).toBe(true)
    const [listed] = await queryActivities(
      user,
      ['walking'],
      new Date('2026-11-01T00:00:00Z'),
      new Date('2026-11-02T00:00:00Z'),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { people: true },
    )
    expect(listed?.people).toEqual([{ id: bo.id, name: 'Bo' }])

    await updateActivity(user, added.id!, { people: [] })
    expect(await activityPeopleOf(user, [added.id])).toBeUndefined()
  })

  test('a list read without asking for people carries none', async () => {
    const user = getTestUser()
    const anna = await insertPerson(user, { name: 'Anna' })
    await addActivity(user, { ...walk('2026-11-01T10:00:00Z'), people: [anna.id] })
    const [listed] = await queryActivities(
      user,
      ['walking'],
      new Date('2026-11-01T00:00:00Z'),
      new Date('2026-11-02T00:00:00Z'),
    )
    expect(listed).not.toHaveProperty('people')
  })

  test('unknown, deleted and malformed ids are refused, naming them, and nothing is written', async () => {
    const user = getTestUser()
    const gone = await insertPerson(user, { name: 'Gone' })
    await softDeletePerson(user, gone.id)
    const result = await addActivity(user, {
      ...walk('2026-11-01T10:00:00Z'),
      people: [MISSING, gone.id, 'nope'],
    })
    expect(result).toEqual({ error: `Unknown people: ${MISSING}, ${gone.id}, nope`, success: false })
    const listed = await queryActivities(user, ['walking'], new Date('2026-11-01'), new Date('2026-11-02'))
    expect(listed).toEqual([])
  })

  test('a deleted person drops out of the activity, and comes back with a restore', async () => {
    const user = getTestUser()
    const anna = await insertPerson(user, { name: 'Anna' })
    const added = await addActivity(user, { ...walk('2026-11-01T10:00:00Z'), people: [anna.id] })
    await softDeletePerson(user, anna.id)
    expect(await activityPeopleOf(user, [added.id])).toBeUndefined()
  })

  test('a people-only edit of a synced activity links them without creating an override', async () => {
    const user = getTestUser()
    const anna = await insertPerson(user, { name: 'Anna' })
    const garminId = await insertActivity(user, {
      ...walk('2026-11-01T10:00:00Z'),
      external_id: 'garmin-people',
      source: 'garmin',
    })
    const result = await updateActivity(user, garminId!, { people: [anna.id] })
    expect(result.success).toBe(true)
    expect(await getOverrideForActivity(user, garminId!)).toBeNull()
    expect(await activityPeopleOf(user, [garminId])).toEqual([{ id: anna.id, name: 'Anna' }])
  })

  test('merging activities gives the merged one everyone they were with', async () => {
    const user = getTestUser()
    const anna = await insertPerson(user, { name: 'Anna' })
    const bo = await insertPerson(user, { name: 'Bo' })
    const first = await addActivity(user, { ...walk('2026-11-01T10:00:00Z'), people: [anna.id] })
    const second = await addActivity(user, { ...walk('2026-11-01T11:30:00Z'), people: [bo.id] })
    const merged = await mergeActivities(user, { activity_ids: [first.id!, second.id!] })
    expect(merged.success).toBe(true)
    expect((await activityPeopleOf(user, [merged.id]))?.map((p) => p.name)).toEqual(['Anna', 'Bo'])
  })
})
