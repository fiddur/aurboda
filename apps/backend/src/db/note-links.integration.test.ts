import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { createTableStatements } from '../schema.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { hardDeleteActivitiesBySource, insertMergedActivity } from './activities/mutations.ts'
import {
  deleteSkippedCheckIns,
  insertCheckIn,
  insertCheckInForm,
  purgeDeletedCheckIns,
  setCheckInDeleted,
  softDeleteCheckInForm,
} from './check-ins.ts'
import { query } from './connection.ts'
import { deleteMeal, insertMeal } from './meals.ts'
import {
  deleteNoteLinksOfTarget,
  getNoteLinksForNoteIds,
  listLiveLinkTargetIds,
  listNotesRelatedTo,
  replaceNoteLinks,
} from './note-links.ts'
import { deleteNote, insertNote, searchNotes, softDeleteNote, updateNoteGuarded } from './notes.ts'
import { insertPerson, purgePerson, restorePerson, softDeletePerson } from './people.ts'
import { deleteReport, insertReport } from './reports.ts'

const CONTAINER_TIMEOUT = 120_000
const MISSING = '99999999-9999-4999-8999-999999999999'
const REVISIONS = { limit: 50, min_interval_minutes: 10 }

const insertActivity = async (
  user: string,
  start: string,
  options: { title?: string; deleted?: boolean; source?: string } = {},
): Promise<string> => {
  const result = await query<{ id: string }>(
    user,
    `INSERT INTO activities (source, activity_type, start_time, end_time, title, deleted_at)
     VALUES ($5, 'walking', $1, $2, $3, $4) RETURNING id`,
    [
      start,
      new Date(new Date(start).getTime() + 3_600_000),
      options.title ?? null,
      options.deleted ? new Date() : null,
      options.source ?? 'aurboda',
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

const meal = async (user: string, time: string, mealType?: string): Promise<string> =>
  (await insertMeal(user, { meal_type: mealType, source: 'manual', time: new Date(time) })).id

const report = async (user: string, date: string): Promise<string> =>
  (await insertReport(user, { entries: [], report_date: new Date(date), report_type: 'blood_panel' })).id

const form = (user: string, name: string) =>
  insertCheckInForm(user, {
    description: null,
    name,
    notify: false,
    questions: [{ key: 'notes', prompt: 'Notes', required: false, type: 'text' }],
    schedule: null,
    schedule_not_before: new Date('2026-01-01T00:00:00Z'),
    score: null,
  })

const checkIn = async (
  user: string,
  formId: string,
  answeredAt: string,
  options: { status?: 'answered' | 'skipped'; scheduledFor?: string } = {},
): Promise<string> =>
  (
    await insertCheckIn(user, {
      activity_ids: {},
      answered_at: new Date(answeredAt),
      answers: {},
      entity_id: null,
      entity_type: null,
      form_id: formId,
      form_version: 1,
      logged: {},
      note: null,
      scheduled_for: options.scheduledFor ? new Date(options.scheduledFor) : null,
      status: options.status ?? 'answered',
    })
  ).id

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
      {
        activity_type: null,
        end_time: null,
        entity_id: anna.id,
        entity_type: 'person',
        form_id: null,
        name: 'Anna',
        start_time: null,
      },
      {
        activity_type: 'walking',
        end_time: new Date('2026-11-20T18:00:00Z'),
        entity_id: walk,
        entity_type: 'activity',
        form_id: null,
        name: 'Evening walk',
        start_time: new Date('2026-11-20T17:00:00Z'),
      },
    ])

    await replaceNoteLinks(user, note.id, [{ entity_id: untitled, entity_type: 'activity' }])
    expect((await getNoteLinksForNoteIds(user, [note.id])).get(note.id)).toEqual([
      {
        activity_type: 'walking',
        end_time: new Date('2026-11-19T09:00:00Z'),
        entity_id: untitled,
        entity_type: 'activity',
        form_id: null,
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

  test('replacing the links leaves a link hidden by its deleted target, which is back on restore', async () => {
    const user = getTestUser()
    const anna = await person(user, 'Anna')
    const bo = await person(user, 'Bo')
    const note = await insertNote(user, 'day', null, 'With Anna and Bo', undefined, undefined, {
      date: '2026-11-20',
      related: [
        { entity_id: anna.id, entity_type: 'person' },
        { entity_id: bo.id, entity_type: 'person' },
      ],
    })

    await softDeletePerson(user, anna.id)
    await replaceNoteLinks(user, note.id, [])
    expect((await getNoteLinksForNoteIds(user, [note.id])).get(note.id)).toBeUndefined()

    await restorePerson(user, anna.id)
    expect((await getNoteLinksForNoteIds(user, [note.id])).get(note.id)?.map((l) => l.entity_id)).toEqual([
      anna.id,
    ])
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

  test('a note about a deleted person is left out of the related list until the person is restored', async () => {
    const user = getTestUser()
    const anna = await person(user, 'Anna')
    const walk = await insertActivity(user, '2026-11-20T17:00:00Z')
    const note = await insertNote(user, 'person', anna.id, 'Walked with Anna', undefined, undefined, {
      related: [{ entity_id: walk, entity_type: 'activity' }],
    })
    const listed = async () =>
      (await listNotesRelatedTo(user, 'activity', [walk], 50, 'UTC')).map((n) => n.id)

    expect(await listed()).toEqual([note.id])
    await softDeletePerson(user, anna.id)
    expect(await listed()).toEqual([])
    await restorePerson(user, anna.id)
    expect(await listed()).toEqual([note.id])
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

  test('an activity removed for good takes its links with it, also an override it orphans', async () => {
    const user = getTestUser()
    const synced = await insertActivity(user, '2026-11-20T17:00:00Z', { source: 'garmin' })
    const override = await insertActivity(user, '2026-11-20T17:00:00Z', { title: 'Walk with Anna' })
    await query(user, 'INSERT INTO activity_override_targets (override_id, target_id) VALUES ($1, $2)', [
      override,
      synced,
    ])
    const kept = await insertActivity(user, '2026-11-21T17:00:00Z')
    const note = await insertNote(user, 'day', null, 'Walked', undefined, undefined, {
      date: '2026-11-20',
      related: [
        { entity_id: synced, entity_type: 'activity' },
        { entity_id: override, entity_type: 'activity' },
        { entity_id: kept, entity_type: 'activity' },
      ],
    })
    expect(await linkCount(user)).toBe(3)

    expect(await hardDeleteActivitiesBySource(user, 'garmin')).toBe(1)

    const rows = await query<{ entity_id: string }>(
      user,
      'SELECT entity_id::text FROM note_links WHERE note_id = $1',
      [note.id],
    )
    expect(rows.rows.map((r) => r.entity_id)).toEqual([kept])
  })

  test('meals, reports and check-ins are linked, labelled from their own rows, and listed after people and activities', async () => {
    const user = getTestUser()
    const anna = await person(user, 'Anna')
    const walk = await insertActivity(user, '2026-11-20T17:00:00Z', { title: 'Evening walk' })
    const lunch = await meal(user, '2026-11-20T11:30:00Z', 'lunch')
    const untyped = await meal(user, '2026-11-20T08:00:00Z')
    const panel = await report(user, '2026-11-20T07:00:00Z')
    const mood = await form(user, 'Mood')
    const answered = await checkIn(user, mood.id, '2026-11-20T20:00:00Z')
    const note = await insertNote(user, 'day', null, 'A day', undefined, undefined, {
      date: '2026-11-20',
      related: [
        { entity_id: answered, entity_type: 'check_in' },
        { entity_id: panel, entity_type: 'report' },
        { entity_id: lunch, entity_type: 'meal' },
        { entity_id: untyped, entity_type: 'meal' },
        { entity_id: walk, entity_type: 'activity' },
        { entity_id: anna.id, entity_type: 'person' },
      ],
    })

    const links = (await getNoteLinksForNoteIds(user, [note.id])).get(note.id)
    expect(links?.map((l) => [l.entity_type, l.name])).toEqual([
      ['person', 'Anna'],
      ['activity', 'Evening walk'],
      ['meal', ''],
      ['meal', 'lunch'],
      ['report', 'blood_panel'],
      ['check_in', 'Mood'],
    ])
    expect(links?.[3]).toMatchObject({ form_id: null, start_time: new Date('2026-11-20T11:30:00Z') })
    expect(links?.[4]).toMatchObject({ start_time: new Date('2026-11-20T07:00:00Z') })
    expect(links?.[5]).toMatchObject({ form_id: mood.id, start_time: new Date('2026-11-20T20:00:00Z') })

    for (const [type, id] of [
      ['meal', lunch],
      ['report', panel],
      ['check_in', answered],
    ] as const) {
      expect(await listLiveLinkTargetIds(user, type, [id, MISSING, 'not-a-uuid'])).toEqual([id])
      expect((await listNotesRelatedTo(user, type, [id], 50, 'UTC')).map((n) => n.id)).toEqual([note.id])
      const found = await searchNotes(user, {
        entity_types: ['time', 'day'],
        limit: 50,
        related: { entity_id: id, entity_type: type },
        tz: 'UTC',
      })
      expect(found.notes.map((n) => n.id)).toEqual([note.id])
    }

    await replaceNoteLinks(user, note.id, [{ entity_id: lunch, entity_type: 'meal' }])
    expect((await getNoteLinksForNoteIds(user, [note.id])).get(note.id)?.map((l) => l.entity_id)).toEqual([
      lunch,
    ])
  })

  test('a deleted check-in hides its links and is back on restore; a purge removes them', async () => {
    const user = getTestUser()
    const mood = await form(user, 'Mood')
    const answered = await checkIn(user, mood.id, '2026-11-20T20:00:00Z')
    const note = await insertNote(user, 'day', null, 'Checked in', undefined, undefined, {
      date: '2026-11-20',
      related: [{ entity_id: answered, entity_type: 'check_in' }],
    })

    await setCheckInDeleted(user, answered, true)
    expect((await getNoteLinksForNoteIds(user, [note.id])).get(note.id)).toBeUndefined()
    expect(await listNotesRelatedTo(user, 'check_in', [answered], 50, 'UTC')).toEqual([])
    expect(await listLiveLinkTargetIds(user, 'check_in', [answered])).toEqual([])
    await replaceNoteLinks(user, note.id, [])
    expect(await linkCount(user)).toBe(1)

    await setCheckInDeleted(user, answered, false)
    expect((await getNoteLinksForNoteIds(user, [note.id])).get(note.id)).toHaveLength(1)

    await setCheckInDeleted(user, answered, true)
    await purgeDeletedCheckIns(user, new Date(Date.now() + 60_000))
    expect(await linkCount(user)).toBe(0)
  })

  test('a check-in removed for good with its form, or as a replaced skip, takes its links with it', async () => {
    const user = getTestUser()
    const mood = await form(user, 'Mood')
    const kept = await form(user, 'Sleep')
    const answered = await checkIn(user, mood.id, '2026-11-20T20:00:00Z')
    const skipped = await checkIn(user, kept.id, '2026-11-20T08:00:00Z', {
      scheduledFor: '2026-11-20T08:00:00Z',
      status: 'skipped',
    })
    const other = await checkIn(user, kept.id, '2026-11-21T08:00:00Z')
    await insertNote(user, 'day', null, 'Checked in', undefined, undefined, {
      date: '2026-11-20',
      related: [
        { entity_id: answered, entity_type: 'check_in' },
        { entity_id: skipped, entity_type: 'check_in' },
        { entity_id: other, entity_type: 'check_in' },
      ],
    })

    await softDeleteCheckInForm(user, mood.id)
    await purgeDeletedCheckIns(user, new Date(Date.now() + 60_000))
    expect(await deleteSkippedCheckIns(user, kept.id, new Date('2026-11-20T08:00:00Z'))).toBe(1)

    const rows = await query<{ entity_id: string }>(user, 'SELECT entity_id::text FROM note_links')
    expect(rows.rows.map((r) => r.entity_id)).toEqual([other])
  })

  test('a meal or a report removed takes its links with it', async () => {
    const user = getTestUser()
    const lunch = await meal(user, '2026-11-20T11:30:00Z', 'lunch')
    const dinner = await meal(user, '2026-11-20T18:00:00Z', 'dinner')
    const panel = await report(user, '2026-11-20T07:00:00Z')
    const note = await insertNote(user, 'day', null, 'Ate', undefined, undefined, {
      date: '2026-11-20',
      related: [
        { entity_id: lunch, entity_type: 'meal' },
        { entity_id: dinner, entity_type: 'meal' },
        { entity_id: panel, entity_type: 'report' },
      ],
    })

    expect(await deleteMeal(user, lunch)).toBe(true)
    expect(await deleteReport(user, panel)).toBe(true)

    expect((await getNoteLinksForNoteIds(user, [note.id])).get(note.id)?.map((l) => l.entity_id)).toEqual([
      dinner,
    ])
    expect(await linkCount(user)).toBe(1)
  })

  test('the database refuses a link of a kind it does not know', async () => {
    const user = getTestUser()
    const note = await insertNote(user, 'day', null, 'A day', undefined, undefined, { date: '2026-11-20' })
    await expect(
      query(user, `INSERT INTO note_links (note_id, entity_type, entity_id) VALUES ($1, 'place', $2)`, [
        note.id,
        MISSING,
      ]),
    ).rejects.toThrow(/note_links_entity_type_check/)
  })

  test('a database with the old person-or-activity check is widened, and a rerun changes nothing', async () => {
    const user = getTestUser()
    const constraint = async () =>
      (
        await query<{ def: string }>(
          user,
          `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'note_links_entity_type_check'`,
        )
      ).rows.map((r) => r.def)
    await query(user, 'ALTER TABLE note_links DROP CONSTRAINT note_links_entity_type_check')
    await query(
      user,
      `ALTER TABLE note_links ADD CONSTRAINT note_links_entity_type_check CHECK (entity_type IN ('person', 'activity'))`,
    )

    for (const run of [1, 2]) {
      await query(user, createTableStatements.note_links_more_targets!)
      await query(user, createTableStatements.note_links_target_delete_triggers!)
      expect(await constraint(), `run ${run}`).toEqual([
        expect.stringMatching(/'person'.*'activity'.*'meal'.*'report'.*'check_in'/),
      ])
    }
    const triggers = await query<{ name: string }>(
      user,
      `SELECT trigger_name AS name FROM information_schema.triggers
        WHERE trigger_name LIKE '%_delete_note_links' ORDER BY trigger_name`,
    )
    expect(triggers.rows.map((r) => r.name)).toEqual([
      'activities_delete_note_links',
      'check_ins_delete_note_links',
      'meals_delete_note_links',
      'reports_delete_note_links',
    ])
  })
})
