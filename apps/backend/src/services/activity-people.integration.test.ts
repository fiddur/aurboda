import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { getOverrideForActivity, insertActivity } from '../db/activities/index.ts'
import { insertPerson, softDeletePerson } from '../db/people.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { activityPeopleOf } from './activity-people.ts'
import { addActivity, mergeActivities, updateActivity } from './mutations.ts'
import { listPersonActivityPage, personActivitySummary } from './person-activities.ts'
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

  const withPerson = (user: string, start: Date, end: Date, types: string[], personId: string) =>
    queryActivities(user, types, start, end, undefined, undefined, undefined, undefined, undefined, {
      person_id: personId,
    })

  test('person_id keeps the activities with the person, with types and a period', async () => {
    const user = getTestUser()
    const anna = await insertPerson(user, { name: 'Anna' })
    const bo = await insertPerson(user, { name: 'Bo' })
    const withAnna = await addActivity(user, { ...walk('2026-11-01T10:00:00Z'), people: [anna.id] })
    await addActivity(user, { ...walk('2026-11-01T13:00:00Z'), people: [bo.id] })
    await addActivity(user, {
      activity_type: 'running',
      end_time: new Date('2026-11-01T16:30:00Z'),
      people: [anna.id],
      start_time: new Date('2026-11-01T16:00:00Z'),
    })
    await addActivity(user, { ...walk('2026-11-05T10:00:00Z'), people: [anna.id] })

    const listed = await withPerson(
      user,
      new Date('2026-11-01T00:00:00Z'),
      new Date('2026-11-02T00:00:00Z'),
      ['walking'],
      anna.id,
    )
    expect(listed.map((a) => a.id)).toEqual([withAnna.id])
  })

  test('person_id keeps an override in the period whose linked synced row starts before it', async () => {
    const user = getTestUser()
    const anna = await insertPerson(user, { name: 'Anna' })
    const garminId = await insertActivity(user, {
      ...walk('2026-11-01T09:55:00Z'),
      external_id: 'garmin-moved',
      source: 'garmin',
    })
    await updateActivity(user, garminId!, { people: [anna.id] })
    const moved = await updateActivity(user, garminId!, { start_time: new Date('2026-11-01T10:05:00Z') })
    expect(moved.success).toBe(true)
    const override = await getOverrideForActivity(user, garminId!)
    expect(override?.start_time.toISOString()).toBe('2026-11-01T10:05:00.000Z')
    expect(await activityPeopleOf(user, [override!.id])).toBeUndefined()

    const listed = await withPerson(
      user,
      new Date('2026-11-01T10:00:00Z'),
      new Date('2026-11-02T00:00:00Z'),
      ['walking'],
      anna.id,
    )
    expect(listed).toHaveLength(1)
  })

  test('person_id names an unknown or deleted person in a 400', async () => {
    const user = getTestUser()
    const gone = await insertPerson(user, { name: 'Gone' })
    await softDeletePerson(user, gone.id)
    for (const id of [MISSING, gone.id, 'nope']) {
      await expect(
        withPerson(user, new Date('2026-11-01'), new Date('2026-11-02'), ['walking'], id),
      ).rejects.toMatchObject({ message: `Unknown people: ${id}`, status: 400 })
    }
  })

  test("a person's page lists an overridden synced activity once, under the id the list gives it", async () => {
    const user = getTestUser()
    const anna = await insertPerson(user, { name: 'Anna' })
    const garminId = await insertActivity(user, {
      ...walk('2026-11-01T10:00:00Z'),
      external_id: 'garmin-person-page',
      source: 'garmin',
    })
    await updateActivity(user, garminId!, { people: [anna.id] })
    expect((await updateActivity(user, garminId!, { title: 'Stroll' })).success).toBe(true)
    const override = await getOverrideForActivity(user, garminId!)
    expect(override).not.toBeNull()
    expect(await activityPeopleOf(user, [garminId, override!.id])).toEqual([{ id: anna.id, name: 'Anna' }])
    await addActivity(user, { ...walk('2026-11-02T10:00:00Z'), people: [anna.id] })

    const page = await listPersonActivityPage(user, anna.id, { limit: 1 })
    expect(page.ok).toBe(true)
    if (!page.ok) return
    expect(page.value.total).toBe(2)
    expect(page.value.next_cursor).toBeDefined()
    const next = await listPersonActivityPage(user, anna.id, { before: page.value.next_cursor, limit: 1 })
    if (!next.ok) throw new Error(next.error)
    expect(next.value.next_cursor).toBeUndefined()
    const [listed] = await queryActivities(
      user,
      ['walking'],
      new Date('2026-11-01T00:00:00Z'),
      new Date('2026-11-01T23:00:00Z'),
    )
    expect(next.value.data).toMatchObject([{ id: listed!.id, title: 'Stroll' }])
    expect(await personActivitySummary(user, anna.id)).toEqual({
      activity_count: 2,
      activity_types: [{ activity_type: 'walking', count: 2, type_name: expect.any(String) }],
    })
  })
})
