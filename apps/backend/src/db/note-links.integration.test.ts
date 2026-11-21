import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { insertMergedActivity } from './activities/mutations.ts'
import { query } from './connection.ts'
import {
  deleteNoteLinksOfTarget,
  getNoteLinksForNoteIds,
  listLiveLinkTargetIds,
  listNotesRelatedTo,
  replaceNoteLinks,
} from './note-links.ts'
import { deleteNote, insertNote, searchNotes, softDeleteNote, updateNoteGuarded } from './notes.ts'
import { insertPerson, purgePerson, restorePerson, softDeletePerson } from './people.ts'

const CONTAINER_TIMEOUT = 120_000
const MISSING = '99999999-9999-4999-8999-999999999999'
const REVISIONS = { limit: 50, min_interval_minutes: 10 }

const insertActivity = async (
  user: string,
  start: string,
  options: { title?: string; deleted?: boolean } = {},
): Promise<string> => {
  const result = await query<{ id: string }>(
    user,
    `INSERT INTO activities (source, activity_type, start_time, end_time, title, deleted_at)
     VALUES ('aurboda', 'walking', $1, $2, $3, $4) RETURNING id`,
    [
      start,
      new Date(new Date(start).getTime() + 3_600_000),
      options.title ?? null,
      options.deleted ? new Date() : null,
    ],
  )
  return result.rows[0]!.id
}

const person = (user: string, name: string) =>
  insertPerson(user, {
    birth_day: null,
    birth_month: null,
    birth_year: null,
    birthday_notify_days_before: null,
    name,
    pronouns: null,
    relationship: null,
  })

const linkCount = async (user: string): Promise<number> =>
  Number((await query<{ n: string }>(user, 'SELECT COUNT(*) AS n FROM note_links')).rows[0]!.n)

describe('Note links Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('replaceNoteLinks replaces the list, collapses duplicates, and labels people and activities', async () => {
    const user = getTestUser()
    const anna = await person(user, 'Anna')
    const walk = await insertActivity(user, '2026-11-20T17:00:00Z', { title: 'Evening walk' })
    const untitled = await insertActivity(user, '2026-11-19T08:00:00Z')
    const note = await insertNote(user, 'day', null, 'A day', undefined, undefined, {
      date: '2026-11-20',
      related: [
        { entity_id: anna.id, entity_type: 'person' },
        { entity_id: anna.id.toUpperCase(), entity_type: 'person' },
        { entity_id: walk, entity_type: 'activity' },
      ],
    })

    const links = (await getNoteLinksForNoteIds(user, [note.id])).get(note.id)
    expect(links).toEqual([
      { entity_id: anna.id, entity_type: 'person', name: 'Anna', start_time: null },
      {
        entity_id: walk,
        entity_type: 'activity',
        name: 'Evening walk',
        start_time: new Date('2026-11-20T17:00:00Z'),
      },
    ])

    await replaceNoteLinks(user, note.id, [{ entity_id: untitled, entity_type: 'activity' }])
    expect((await getNoteLinksForNoteIds(user, [note.id])).get(note.id)).toEqual([
      {
        entity_id: untitled,
        entity_type: 'activity',
        name: 'Walking',
        start_time: new Date('2026-11-19T08:00:00Z'),
      },
    ])

    await replaceNoteLinks(user, note.id, [])
    expect((await getNoteLinksForNoteIds(user, [note.id])).get(note.id)).toBeUndefined()
  })

  test('a soft-deleted target is hidden and back on restore; a purge removes its links', async () => {
    const user = getTestUser()
    const anna = await person(user, 'Anna')
    const note = await insertNote(user, 'day', null, 'With Anna', undefined, undefined, {
      date: '2026-11-20',
      related: [{ entity_id: anna.id, entity_type: 'person' }],
    })

    await softDeletePerson(user, anna.id)
    expect((await getNoteLinksForNoteIds(user, [note.id])).get(note.id)).toBeUndefined()
    expect(await listNotesRelatedTo(user, 'person', [anna.id], 50, 'UTC')).toEqual([])
    expect(await listLiveLinkTargetIds(user, 'person', [anna.id])).toEqual([])

    await restorePerson(user, anna.id)
    expect((await getNoteLinksForNoteIds(user, [note.id])).get(note.id)).toHaveLength(1)
    expect((await listNotesRelatedTo(user, 'person', [anna.id], 50, 'UTC')).map((n) => n.id)).toEqual([
      note.id,
    ])

    await purgePerson(user, anna.id)
    expect(await linkCount(user)).toBe(0)
  })

  test('a soft-deleted activity hides its links; deleteNoteLinksOfTarget removes them', async () => {
    const user = getTestUser()
    const walk = await insertActivity(user, '2026-11-20T17:00:00Z')
    const note = await insertNote(user, 'day', null, 'Walked', undefined, undefined, {
      date: '2026-11-20',
      related: [{ entity_id: walk, entity_type: 'activity' }],
    })
    expect(await listLiveLinkTargetIds(user, 'activity', [walk, MISSING, 'not-a-uuid'])).toEqual([walk])

    await query(user, 'UPDATE activities SET deleted_at = NOW() WHERE id = $1', [walk])
    expect((await getNoteLinksForNoteIds(user, [note.id])).get(note.id)).toBeUndefined()
    await query(user, 'UPDATE activities SET deleted_at = NULL WHERE id = $1', [walk])
    expect((await getNoteLinksForNoteIds(user, [note.id])).get(note.id)).toHaveLength(1)

    expect(await deleteNoteLinksOfTarget(user, 'activity', [walk])).toBe(1)
    expect(await linkCount(user)).toBe(0)
  })

  test('links go with the note when it is removed for good, and are out of sight while it is deleted', async () => {
    const user = getTestUser()
    const anna = await person(user, 'Anna')
    const note = await insertNote(user, 'day', null, 'With Anna', undefined, undefined, {
      date: '2026-11-20',
      related: [{ entity_id: anna.id, entity_type: 'person' }],
    })

    await softDeleteNote(user, note.id)
    expect(await listNotesRelatedTo(user, 'person', [anna.id], 50, 'UTC')).toEqual([])
    expect(await linkCount(user)).toBe(1)

    await deleteNote(user, note.id)
    expect(await linkCount(user)).toBe(0)
  })

  test('listNotesRelatedTo lists live roots newest first, matching any of the ids, at most limit', async () => {
    const user = getTestUser()
    const first = await insertActivity(user, '2026-11-20T08:00:00Z')
    const second = await insertActivity(user, '2026-11-20T09:00:00Z')
    const older = await insertNote(user, 'day', null, '\n\nFirst line\nSecond', undefined, undefined, {
      date: '2026-11-18',
      related: [{ entity_id: first, entity_type: 'activity' }],
      title: 'Older',
    })
    const newer = await insertNote(user, 'time', null, 'Later', new Date('2026-11-20T12:00:00Z'), undefined, {
      related: [{ entity_id: second, entity_type: 'activity' }],
    })

    const listed = await listNotesRelatedTo(user, 'activity', [first, second], 50, 'Europe/Stockholm')
    expect(listed.map((n) => n.id)).toEqual([newer.id, older.id])
    expect(listed[1]).toMatchObject({
      content: '\n\nFirst line\nSecond',
      date: '2026-11-18',
      entity_type: 'day',
      title: 'Older',
    })
    expect(await listNotesRelatedTo(user, 'activity', [first, second], 1, 'UTC')).toHaveLength(1)
    expect(await listNotesRelatedTo(user, 'activity', [first], 50, 'UTC')).toHaveLength(1)
  })

  test('updateNoteGuarded replaces links with the text, refuses a stale write, and keeps no revision for links alone', async () => {
    const user = getTestUser()
    const anna = await person(user, 'Anna')
    const bo = await person(user, 'Bo')
    const note = await insertNote(user, 'day', null, 'Hello', undefined, undefined, { date: '2026-11-20' })

    const updated = await updateNoteGuarded(
      user,
      note.id,
      { related: [{ entity_id: anna.id, entity_type: 'person' }] },
      { expected_updated_at: note.updated_at, revisions: REVISIONS },
    )
    expect(updated.status).toBe('updated')
    if (updated.status !== 'updated') return
    expect(updated.note.updated_at.getTime()).toBeGreaterThan(note.updated_at.getTime())
    const revisions = await query(user, 'SELECT 1 FROM note_revisions WHERE note_id = $1', [note.id])
    expect(revisions.rows).toHaveLength(0)

    const stale = await updateNoteGuarded(
      user,
      note.id,
      { related: [{ entity_id: bo.id, entity_type: 'person' }] },
      { expected_updated_at: note.updated_at, revisions: REVISIONS },
    )
    expect(stale.status).toBe('conflict')
    expect((await getNoteLinksForNoteIds(user, [note.id])).get(note.id)?.map((l) => l.name)).toEqual(['Anna'])
  })

  test('searchNotes filters to notes with a visible link to the target', async () => {
    const user = getTestUser()
    const anna = await person(user, 'Anna')
    const linked = await insertNote(user, 'day', null, 'With Anna', undefined, undefined, {
      date: '2026-11-20',
      related: [{ entity_id: anna.id, entity_type: 'person' }],
    })
    await insertNote(user, 'day', null, 'Alone', undefined, undefined, { date: '2026-11-21' })
    const params = {
      entity_types: ['time' as const, 'day' as const],
      limit: 50,
      related: { entity_id: anna.id, entity_type: 'person' as const },
      tz: 'UTC',
    }

    expect((await searchNotes(user, params)).notes.map((n) => n.id)).toEqual([linked.id])
    await softDeletePerson(user, anna.id)
    expect((await searchNotes(user, params)).notes).toEqual([])
  })

  test('a merge relates the notes of the merged activities to the activity they become', async () => {
    const user = getTestUser()
    const first = await insertActivity(user, '2026-11-01T09:00:00Z')
    const second = await insertActivity(user, '2026-11-01T11:00:00Z')
    const note = await insertNote(user, 'day', null, 'Walked', undefined, undefined, {
      date: '2026-11-01',
      related: [{ entity_id: second, entity_type: 'activity' }],
    })
    const merged = await insertMergedActivity(
      user,
      {
        activity_type: 'walking',
        end_time: new Date('2026-11-01T12:30:00Z'),
        source: 'aurboda',
        start_time: new Date('2026-11-01T08:00:00Z'),
      },
      [first, second],
    )

    expect((await listNotesRelatedTo(user, 'activity', [merged], 50, 'UTC')).map((n) => n.id)).toEqual([
      note.id,
    ])
  })
})
