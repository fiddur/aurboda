import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { insertMergedActivity, insertOverride } from './activities/mutations.ts'
import { query } from './connection.ts'
import { getNoteById, insertNote } from './notes.ts'
import {
  addActivityPeople,
  countPersonActivityGroups,
  countPersonActivityGroupsByType,
  deletePersonDate,
  getLivePersonByActor,
  getPeopleForActivities,
  getPeopleForActivityGroups,
  getPeopleNamesVersion,
  getPerson,
  getPersonDate,
  insertPerson,
  insertPersonDate,
  listActivityGroupMembers,
  listActivityIntervalsWithPeople,
  listActorPresentations,
  listDeletedPeople,
  listImportantDateSources,
  listLinkedActivityIds,
  listLivePersonIds,
  listPeople,
  listPeopleWithActivities,
  listPersonActivityGroups,
  listPersonDates,
  pruneDeletedPeople,
  purgePerson,
  restorePerson,
  setActivityPeople,
  softDeletePerson,
  updatePerson,
  updatePersonActorCache,
  updatePersonDate,
} from './people.ts'
import { listTimelineEntriesByActor, upsertTimelineEntry } from './timeline.ts'

const CONTAINER_TIMEOUT = 120_000
const MISSING = '99999999-9999-4999-8999-999999999999'
const ACTOR = 'https://example.social/users/anna'

const insertActivity = async (
  user: string,
  start: string,
  deleted = false,
  options: { source?: string; type?: string } = {},
): Promise<string> => {
  const result = await query<{ id: string }>(
    user,
    `INSERT INTO activities (source, activity_type, start_time, end_time, deleted_at)
     VALUES ($4, $5, $1, $2, $3) RETURNING id`,
    [
      start,
      new Date(new Date(start).getTime() + 3_600_000),
      deleted ? new Date() : null,
      options.source ?? 'aurboda',
      options.type ?? 'walking',
    ],
  )
  return result.rows[0]!.id
}

describe('People Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('insertPerson, getPerson, updatePerson and listPeople', async () => {
    const user = getTestUser()
    const anna = await insertPerson(user, {
      birth_day: 12,
      birth_month: 4,
      birth_year: null,
      birthday_notify_days_before: 3,
      name: 'Anna',
      relationship: 'friend',
    })
    expect(anna).toMatchObject({
      actor_uri: null,
      archived: false,
      birth_day: 12,
      birth_month: 4,
      birth_year: null,
      birthday_notify_days_before: 3,
      deleted_at: null,
      name: 'Anna',
      relationship: 'friend',
    })
    const bo = await insertPerson(user, { archived: true, name: 'bo' })
    expect((await listPeople(user)).map((p) => p.name)).toEqual(['Anna'])
    expect((await listPeople(user, { include_archived: true })).map((p) => p.name)).toEqual(['Anna', 'bo'])

    const updated = await updatePerson(user, anna.id, { birth_day: null, birth_month: null, name: 'Anna B' })
    expect(updated).toMatchObject({
      birth_day: null,
      birth_month: null,
      name: 'Anna B',
      relationship: 'friend',
    })
    expect(updated!.updated_at.getTime()).toBeGreaterThanOrEqual(anna.updated_at.getTime())
    expect(await updatePerson(user, MISSING, { name: 'x' })).toBeNull()
    expect((await getPerson(user, bo.id))?.name).toBe('bo')
  })

  test('the actor and its cache, and at most one live profile per actor', async () => {
    const user = getTestUser()
    const anna = await insertPerson(user, {
      actor_cache: { actor_handle: '@anna@example.social', actor_icon: null, actor_name: 'Anna' },
      actor_uri: ACTOR,
      name: 'Anna',
    })
    expect(anna).toMatchObject({ actor_handle: '@anna@example.social', actor_name: 'Anna', actor_uri: ACTOR })
    expect(anna.actor_cached_at).toBeInstanceOf(Date)
    expect((await getLivePersonByActor(user, ACTOR))?.id).toBe(anna.id)
    await expect(insertPerson(user, { actor_uri: ACTOR, name: 'Again' })).rejects.toMatchObject({
      code: '23505',
    })

    await updatePersonActorCache(user, anna.id, ACTOR, {
      actor_handle: '@anna@example.social',
      actor_icon: 'https://example.social/a.png',
      actor_name: 'Anna A.',
    })
    expect(await getPerson(user, anna.id)).toMatchObject({ actor_icon: 'https://example.social/a.png' })

    const cleared = await updatePerson(user, anna.id, { actor_uri: null })
    expect(cleared).toMatchObject({ actor_cached_at: null, actor_handle: null, actor_uri: null })
    expect(await getLivePersonByActor(user, ACTOR)).toBeNull()
  })

  test('soft delete hides a person, restore brings them back, and is refused while the actor is taken', async () => {
    const user = getTestUser()
    const anna = await insertPerson(user, { actor_uri: ACTOR, name: 'Anna' })
    expect(await softDeletePerson(user, anna.id)).toBe(true)
    expect(await softDeletePerson(user, anna.id)).toBe(false)
    expect(await getPerson(user, anna.id)).toBeNull()
    expect((await getPerson(user, anna.id, { include_deleted: true }))?.deleted_at).toBeInstanceOf(Date)
    expect(await listPeople(user)).toEqual([])
    expect((await listDeletedPeople(user)).map((p) => p.id)).toEqual([anna.id])
    expect(await updatePerson(user, anna.id, { name: 'x' })).toBeNull()

    const annie = await insertPerson(user, { actor_uri: ACTOR, name: 'Annie' })
    expect(await restorePerson(user, anna.id)).toMatchObject({
      holder: { id: annie.id },
      status: 'actor_taken',
    })
    await updatePerson(user, annie.id, { actor_uri: null })
    expect(await restorePerson(user, anna.id)).toMatchObject({
      person: { deleted_at: null },
      status: 'restored',
    })
    expect(await restorePerson(user, anna.id)).toMatchObject({ status: 'live' })
    expect(await restorePerson(user, MISSING)).toEqual({ status: 'not_found' })
  })

  test('getPeopleNamesVersion changes on an add, a rename, a delete and a restore, not on other edits', async () => {
    const user = getTestUser()
    const empty = await getPeopleNamesVersion(user)
    const anna = await insertPerson(user, { name: 'Anna' })
    const added = await getPeopleNamesVersion(user)
    expect(added).not.toBe(empty)
    await updatePerson(user, anna.id, { archived: true, relationship: 'friend' })
    expect(await getPeopleNamesVersion(user)).toBe(added)
    await updatePerson(user, anna.id, { name: 'Annie' })
    const renamed = await getPeopleNamesVersion(user)
    expect(renamed).not.toBe(added)
    await softDeletePerson(user, anna.id)
    const deleted = await getPeopleNamesVersion(user)
    expect(deleted).not.toBe(renamed)
    await restorePerson(user, anna.id)
    expect(await getPeopleNamesVersion(user)).toBe(renamed)
  })

  test('listLivePersonIds names only live people', async () => {
    const user = getTestUser()
    const anna = await insertPerson(user, { name: 'Anna' })
    const bo = await insertPerson(user, { name: 'Bo' })
    await softDeletePerson(user, bo.id)
    expect(await listLivePersonIds(user, [anna.id, bo.id, MISSING])).toEqual([anna.id])
    expect(await listLivePersonIds(user, [])).toEqual([])
  })

  test('dates: insert, list, get, update and delete, scoped to the person', async () => {
    const user = getTestUser()
    const anna = await insertPerson(user, { name: 'Anna' })
    const bo = await insertPerson(user, { name: 'Bo' })
    const late = await insertPersonDate(user, anna.id, { day: 1, kind: 'other', label: 'Late', month: 12 })
    const early = await insertPersonDate(user, anna.id, {
      day: 3,
      kind: 'anniversary',
      label: 'Wedding',
      month: 6,
      notify_days_before: 7,
      year: 2015,
    })
    expect(early).toMatchObject({ day: 3, kind: 'anniversary', month: 6, notify_days_before: 7, year: 2015 })
    expect((await listPersonDates(user, anna.id)).map((d) => d.id)).toEqual([early.id, late.id])
    expect(await getPersonDate(user, bo.id, early.id)).toBeNull()
    expect(await updatePersonDate(user, bo.id, early.id, { label: 'x' })).toBeNull()
    expect(
      await updatePersonDate(user, anna.id, early.id, { notify_days_before: null, year: null }),
    ).toMatchObject({
      label: 'Wedding',
      notify_days_before: null,
      year: null,
    })
    expect(await deletePersonDate(user, bo.id, late.id)).toBe(false)
    expect(await deletePersonDate(user, anna.id, late.id)).toBe(true)
    expect((await getPersonDate(user, anna.id, early.id))?.label).toBe('Wedding')
  })

  test('listImportantDateSources: dates and birthdays of live, non-archived people', async () => {
    const user = getTestUser()
    const anna = await insertPerson(user, { birth_day: 12, birth_month: 4, birth_year: 1990, name: 'Anna' })
    await insertPersonDate(user, anna.id, { day: 1, kind: 'anniversary', label: 'Wedding', month: 6 })
    await insertPerson(user, { name: 'No birthday' })
    await insertPerson(user, { archived: true, birth_day: 1, birth_month: 1, name: 'Archived' })
    const gone = await insertPerson(user, { birth_day: 2, birth_month: 2, name: 'Gone' })
    await softDeletePerson(user, gone.id)

    const sources = await listImportantDateSources(user)
    expect(sources).toHaveLength(2)
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          date_id: null,
          kind: 'birthday',
          month: 4,
          person_name: 'Anna',
          year: 1990,
        }),
        expect.objectContaining({ kind: 'anniversary', label: 'Wedding', person_id: anna.id }),
      ]),
    )
  })

  test('activity links: set, add, read live people only, and recent activities', async () => {
    const user = getTestUser()
    const anna = await insertPerson(user, { name: 'Anna' })
    const bo = await insertPerson(user, { name: 'bo' })
    const walk = await insertActivity(user, '2026-11-01T10:00:00Z')
    const later = await insertActivity(user, '2026-11-02T10:00:00Z')
    const deletedWalk = await insertActivity(user, '2026-11-03T10:00:00Z', true)

    await setActivityPeople(user, walk, [bo.id, anna.id])
    await addActivityPeople(user, later, [anna.id])
    await addActivityPeople(user, later, [anna.id])
    await addActivityPeople(user, deletedWalk, [anna.id])
    let linked = await getPeopleForActivities(user, [walk, later])
    expect(linked.get(walk)).toEqual([
      { id: anna.id, name: 'Anna' },
      { id: bo.id, name: 'bo' },
    ])
    expect(linked.get(later)).toEqual([{ id: anna.id, name: 'Anna' }])

    await setActivityPeople(user, walk, [bo.id], [later])
    linked = await getPeopleForActivities(user, [walk, later])
    expect(linked.get(walk)).toEqual([{ id: bo.id, name: 'bo' }])
    expect(linked.has(later)).toBe(false)

    await setActivityPeople(user, later, [anna.id])
    expect((await listPersonActivityGroups(user, anna.id, {}, { limit: 20 })).map((a) => a.id)).toEqual([
      later,
    ])
    await softDeletePerson(user, bo.id)
    expect((await getPeopleForActivities(user, [walk])).has(walk)).toBe(false)
    expect(await getPeopleForActivities(user, [])).toEqual(new Map())
  })

  test("an activity group's people: its own and its live superseded rows', live people once each", async () => {
    const user = getTestUser()
    const anna = await insertPerson(user, { name: 'Anna' })
    const bo = await insertPerson(user, { name: 'Bo' })
    const gone = await insertPerson(user, { name: 'Cy' })
    await softDeletePerson(user, gone.id)
    const winner = await insertActivity(user, '2026-11-01T10:00:00Z')
    const superseded = await insertActivity(user, '2026-11-01T10:00:00Z', false, { source: 'garmin' })
    const deletedSuperseded = await insertActivity(user, '2026-11-01T10:00:00Z', true, { source: 'strava' })
    const alone = await insertActivity(user, '2026-11-02T10:00:00Z')
    await query(user, 'UPDATE activities SET superseded_by = $1 WHERE id = ANY($2::uuid[])', [
      winner,
      [superseded, deletedSuperseded],
    ])
    await addActivityPeople(user, winner, [anna.id])
    await addActivityPeople(user, superseded, [anna.id, bo.id, gone.id])
    await addActivityPeople(user, deletedSuperseded, [gone.id])

    const people = await getPeopleForActivityGroups(user, [winner, alone])

    expect(people.get(winner)?.map((p) => p.name)).toEqual(['Anna', 'Bo'])
    expect(people.get(winner)?.[0]).toEqual({ created_at: anna.created_at, id: anna.id, name: 'Anna' })
    expect(people.has(alone)).toBe(false)
    expect(await getPeopleForActivityGroups(user, [])).toEqual(new Map())
  })

  describe("a person's activities as merge groups", () => {
    test('pages newest first across equal start times, with every row once', async () => {
      const user = getTestUser()
      const anna = await insertPerson(user, { name: 'Anna' })
      const ids: string[] = []
      for (const type of ['walking', 'running', 'yoga']) {
        ids.push(await insertActivity(user, '2026-11-01T10:00:00Z', false, { type }))
      }
      ids.push(await insertActivity(user, '2026-11-02T10:00:00Z'))
      for (const id of ids) await addActivityPeople(user, id, [anna.id])

      const first = await listPersonActivityGroups(user, anna.id, {}, { limit: 2 })
      const second = await listPersonActivityGroups(user, anna.id, {}, { before: first.at(-1)!, limit: 2 })
      const third = await listPersonActivityGroups(user, anna.id, {}, { before: second.at(-1)!, limit: 2 })
      const paged = [...first, ...second, ...third].map((g) => g.id)
      expect(paged[0]).toBe(ids[3])
      expect(paged.toSorted()).toEqual(ids.toSorted())
      expect(third).toHaveLength(0)
      expect(first[0]!.start_us).toBe(String(Date.parse('2026-11-02T10:00:00Z') * 1000))
      expect(await countPersonActivityGroups(user, anna.id, {})).toBe(4)
    })

    test('total and the page follow the type and period filters', async () => {
      const user = getTestUser()
      const anna = await insertPerson(user, { name: 'Anna' })
      const walk = await insertActivity(user, '2026-11-01T10:00:00Z')
      const run = await insertActivity(user, '2026-11-02T10:00:00Z', false, { type: 'running' })
      const laterWalk = await insertActivity(user, '2026-11-03T10:00:00Z')
      for (const id of [walk, run, laterWalk]) await addActivityPeople(user, id, [anna.id])

      expect(await countPersonActivityGroups(user, anna.id, { types: ['walking'] })).toBe(2)
      expect(
        await countPersonActivityGroups(user, anna.id, {
          end: new Date('2026-11-02T23:00:00Z'),
          start: new Date('2026-11-01T12:00:00Z'),
        }),
      ).toBe(1)
      expect(
        (await listPersonActivityGroups(user, anna.id, { types: ['walking'] }, { limit: 10 })).map(
          (g) => g.id,
        ),
      ).toEqual([laterWalk, walk])
      expect(await countPersonActivityGroupsByType(user, anna.id)).toEqual([
        { activity_type: 'walking', count: 2 },
        { activity_type: 'running', count: 1 },
      ])
    })

    test('a synced row and its override, both linked, are one group under the override', async () => {
      const user = getTestUser()
      const anna = await insertPerson(user, { name: 'Anna' })
      const synced = await insertActivity(user, '2026-11-01T10:00:00Z', false, { source: 'garmin' })
      const override = await insertOverride(user, [synced], {
        activity_type: 'walking',
        end_time: new Date('2026-11-01T11:00:00Z'),
        start_time: new Date('2026-11-01T10:00:00Z'),
        title: 'Stroll',
      })
      await addActivityPeople(user, synced, [anna.id])
      await addActivityPeople(user, override!.id!, [anna.id])

      const groups = await listPersonActivityGroups(user, anna.id, {}, { limit: 10 })
      expect(groups.map((g) => g.id)).toEqual([override!.id])
      expect(await countPersonActivityGroups(user, anna.id, {})).toBe(1)
      expect((await listActivityGroupMembers(user, [override!.id!])).map((a) => a.id).toSorted()).toEqual(
        [synced, override!.id].toSorted(),
      )
    })

    test('deleted activities are left out, and only linked live rows are listed by id', async () => {
      const user = getTestUser()
      const anna = await insertPerson(user, { name: 'Anna' })
      const live = await insertActivity(user, '2026-11-01T10:00:00Z')
      const gone = await insertActivity(user, '2026-11-02T10:00:00Z', true)
      await addActivityPeople(user, live, [anna.id])
      await addActivityPeople(user, gone, [anna.id])

      expect((await listPersonActivityGroups(user, anna.id, {}, { limit: 10 })).map((g) => g.id)).toEqual([
        live,
      ])
      expect(await countPersonActivityGroups(user, anna.id, {})).toBe(1)
      expect(await listActivityGroupMembers(user, [gone])).toEqual([])
      expect(
        await listLinkedActivityIds(user, anna.id, new Date('2026-10-01'), new Date('2026-12-01')),
      ).toEqual([live])
    })
  })

  test('a merged activity is with everyone its sources were with', async () => {
    const user = getTestUser()
    const anna = await insertPerson(user, { name: 'Anna' })
    const bo = await insertPerson(user, { name: 'Bo' })
    const first = await insertActivity(user, '2026-11-01T10:00:00Z')
    const second = await insertActivity(user, '2026-11-01T11:30:00Z')
    await setActivityPeople(user, first, [anna.id])
    await setActivityPeople(user, second, [anna.id, bo.id])
    const merged = await insertMergedActivity(
      user,
      {
        activity_type: 'walking',
        end_time: new Date('2026-11-01T12:30:00Z'),
        source: 'aurboda',
        start_time: new Date('2026-11-01T09:00:00Z'),
      },
      [first, second],
    )
    expect((await getPeopleForActivities(user, [merged])).get(merged)?.map((p) => p.name)).toEqual([
      'Anna',
      'Bo',
    ])
    expect((await getPeopleForActivities(user, [first])).get(first)?.map((p) => p.name)).toEqual(['Anna'])
  })

  test('purgePerson removes the person with dates, links and notes about them', async () => {
    const user = getTestUser()
    const anna = await insertPerson(user, { name: 'Anna' })
    await insertPersonDate(user, anna.id, { day: 1, kind: 'other', label: 'x', month: 1 })
    const walk = await insertActivity(user, '2026-11-01T10:00:00Z')
    await setActivityPeople(user, walk, [anna.id])
    const note = await insertNote(user, 'person', anna.id, 'Likes tea')
    const reply = await insertNote(user, 'note', note.id, 'Green')
    const other = await insertNote(user, 'activity', walk, 'Nice walk')

    expect(await purgePerson(user, anna.id)).toBe(true)
    expect(await getPerson(user, anna.id, { include_deleted: true })).toBeNull()
    expect(await listPersonDates(user, anna.id)).toEqual([])
    expect((await getPeopleForActivities(user, [walk])).has(walk)).toBe(false)
    expect(await getNoteById(user, note.id, { include_deleted: true })).toBeNull()
    expect(await getNoteById(user, reply.id, { include_deleted: true })).toBeNull()
    expect(await getNoteById(user, other.id)).not.toBeNull()
    expect(await purgePerson(user, anna.id)).toBe(false)
  })

  test('pruneDeletedPeople removes only the people deleted longer ago than the retention', async () => {
    const user = getTestUser()
    const old = await insertPerson(user, { name: 'Old' })
    const recent = await insertPerson(user, { name: 'Recent' })
    const live = await insertPerson(user, { name: 'Live' })
    const note = await insertNote(user, 'person', old.id, 'gone')
    await query(user, `UPDATE people SET deleted_at = NOW() - interval '31 days' WHERE id = $1`, [old.id])
    await softDeletePerson(user, recent.id)

    expect(await pruneDeletedPeople(user, 30)).toBe(1)
    expect(await getPerson(user, old.id, { include_deleted: true })).toBeNull()
    expect(await getPerson(user, recent.id, { include_deleted: true })).not.toBeNull()
    expect(await getPerson(user, live.id)).not.toBeNull()
    expect(await getNoteById(user, note.id, { include_deleted: true })).toBeNull()
  })

  test('listActorPresentations and listTimelineEntriesByActor read the follow row and the timeline', async () => {
    const user = getTestUser()
    await query(
      user,
      `INSERT INTO feed_following (actor_uri, inbox_uri, handle, display_name, avatar_url, accepted)
       VALUES ($1, $2, '@anna@example.social', 'Anna', NULL, true)`,
      [ACTOR, `${ACTOR}/inbox`],
    )
    for (const [n, published] of [
      [1, '2026-11-01T10:00:00Z'],
      [2, '2026-11-02T10:00:00Z'],
    ] as const) {
      await upsertTimelineEntry(user, {
        actor_uri: ACTOR,
        avatar_url: `https://example.social/${n}.png`,
        content: `<p>post ${n}</p>`,
        display_name: `Anna ${n}`,
        handle: '@anna@example.social',
        object_uri: `${ACTOR}/statuses/${n}`,
        published_at: new Date(published),
      })
    }
    const { following, timeline } = await listActorPresentations(user, [ACTOR])
    expect(following).toEqual([
      {
        accepted: true,
        actor_uri: ACTOR,
        avatar_url: null,
        display_name: 'Anna',
        handle: '@anna@example.social',
      },
    ])
    expect(timeline).toHaveLength(1)
    expect(timeline[0]?.actor_uri).toBe(ACTOR)
    expect(await listActorPresentations(user, [])).toEqual({ following: [], timeline: [] })

    const posts = await listTimelineEntriesByActor(user, ACTOR, 1)
    expect(posts.map((p) => p.object_uri)).toEqual([`${ACTOR}/statuses/2`])
    expect(await listTimelineEntriesByActor(user, 'https://elsewhere/u', 10)).toEqual([])
  })

  test('listActivityIntervalsWithPeople reads the live activities with live people in the range', async () => {
    const user = getTestUser()
    const anna = await insertPerson(user, { name: 'Anna' })
    const bo = await insertPerson(user, { name: 'Bo' })
    const withAnna = await insertActivity(user, '2026-03-02T10:00:00Z')
    const withBo = await insertActivity(user, '2026-03-03T10:00:00Z')
    await insertActivity(user, '2026-03-04T10:00:00Z')
    const deleted = await insertActivity(user, '2026-03-05T10:00:00Z', true)
    const outside = await insertActivity(user, '2026-04-01T10:00:00Z')
    await addActivityPeople(user, withAnna, [anna.id])
    await addActivityPeople(user, withBo, [bo.id])
    await addActivityPeople(user, deleted, [anna.id])
    await addActivityPeople(user, outside, [anna.id])
    const from = new Date('2026-03-01T00:00:00Z')
    const to = new Date('2026-03-10T00:00:00Z')

    const starts = (rows: { start_time: Date }[]) => rows.map((r) => r.start_time.toISOString())
    expect(starts(await listActivityIntervalsWithPeople(user, from, to))).toEqual([
      '2026-03-02T10:00:00.000Z',
      '2026-03-03T10:00:00.000Z',
    ])
    expect(starts(await listActivityIntervalsWithPeople(user, from, to, anna.id))).toEqual([
      '2026-03-02T10:00:00.000Z',
    ])

    await softDeletePerson(user, bo.id)
    expect(starts(await listActivityIntervalsWithPeople(user, from, to))).toEqual([
      '2026-03-02T10:00:00.000Z',
    ])
    expect(await listActivityIntervalsWithPeople(user, from, to, bo.id)).toEqual([])
  })

  test('listPeopleWithActivities lists live, non-archived people with a live activity', async () => {
    const user = getTestUser()
    const anna = await insertPerson(user, { name: 'anna' })
    const bo = await insertPerson(user, { name: 'Bo' })
    const archived = await insertPerson(user, { archived: true, name: 'Cy' })
    const gone = await insertPerson(user, { name: 'Di' })
    const onlyDeleted = await insertPerson(user, { name: 'Ed' })
    await insertPerson(user, { name: 'Fi' })
    const live = await insertActivity(user, '2026-03-02T10:00:00Z')
    const deletedActivity = await insertActivity(user, '2026-03-03T10:00:00Z', true)
    await addActivityPeople(user, live, [anna.id, bo.id, archived.id, gone.id])
    await addActivityPeople(user, deletedActivity, [onlyDeleted.id])
    await softDeletePerson(user, gone.id)

    expect(await listPeopleWithActivities(user)).toEqual([
      { id: anna.id, name: 'anna' },
      { id: bo.id, name: 'Bo' },
    ])
  })
})
