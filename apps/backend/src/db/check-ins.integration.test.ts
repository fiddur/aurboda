import type { CheckInQuestion } from '@aurboda/api-spec'

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  deleteCheckInPoints,
  deleteSkippedCheckIns,
  getCheckIn,
  getCheckInForm,
  insertCheckIn,
  insertCheckInForm,
  listCheckInForms,
  listCheckInFormVersions,
  listCheckIns,
  listFormCheckInsBetween,
  purgeDeletedCheckIns,
  restoreCheckInForm,
  setCheckInDeleted,
  softDeleteCheckInForm,
  updateCheckIn,
  updateCheckInForm,
} from './check-ins.ts'
import { query } from './connection.ts'
import { getNotificationById, insertNotification, markCheckInDueNotificationsRead } from './notifications.ts'
import { insertTimeSeries } from './time-series.ts'

const CONTAINER_TIMEOUT = 120_000
const MISSING = '99999999-9999-4999-8999-999999999999'
const NOT_BEFORE = new Date('2026-11-18T10:00:00Z')
const ANSWERED = { activity_ids: {}, entity_id: null, entity_type: null, status: 'answered' } as const

const rested: CheckInQuestion = {
  key: 'rested',
  logs_to: { metric: 'rested' },
  max: 5,
  min: 1,
  prompt: 'How rested?',
  required: true,
  type: 'scale',
}
const notes: CheckInQuestion = { key: 'notes', prompt: 'Notes', required: false, type: 'text' }

const formInput = {
  description: null,
  name: 'Morning',
  notify: true,
  questions: [rested, notes],
  schedule: { day_starts_at: '04:00', times: ['08:00'], weekdays: [1, 2, 3, 4, 5, 6, 7] },
  schedule_not_before: NOT_BEFORE,
  score: { metric: 'total', questions: ['rested'] },
}

const at = (iso: string) => new Date(iso)

describe('Check-ins Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('insertCheckInForm stores the form and its first version', async () => {
    const user = getTestUser()
    const form = await insertCheckInForm(user, formInput)
    expect(form).toMatchObject({ ...formInput, archived: false, deleted_at: null, version: 1 })
    expect(await getCheckInForm(user, form.id)).toEqual(form)
    const versions = await listCheckInFormVersions(user, form.id)
    expect(versions).toMatchObject([{ questions: [rested, notes], score: formInput.score, version: 1 }])
    expect(await getCheckInForm(user, MISSING)).toBeNull()
  })

  test('updateCheckInForm adds a version, or copies a reorder to the current one', async () => {
    const user = getTestUser()
    const form = await insertCheckInForm(user, formInput)
    const reordered = await updateCheckInForm(
      user,
      form.id,
      { questions: [notes, rested] },
      { newVersion: false },
    )
    expect(reordered?.version).toBe(1)
    expect((await listCheckInFormVersions(user, form.id))[0]!.questions.map((q) => q.key)).toEqual([
      'notes',
      'rested',
    ])
    const bumped = await updateCheckInForm(
      user,
      form.id,
      { name: 'Mornings', questions: [rested], score: null },
      { newVersion: true },
    )
    expect(bumped).toMatchObject({ name: 'Mornings', score: null, version: 2 })
    expect(
      (await listCheckInFormVersions(user, form.id)).map((v) => [v.version, v.questions.length]),
    ).toEqual([
      [1, 2],
      [2, 1],
    ])
    const cleared = await updateCheckInForm(
      user,
      form.id,
      { archived: true, description: 'Text', notify: false, schedule: null, schedule_not_before: NOT_BEFORE },
      { newVersion: false },
    )
    expect(cleared).toMatchObject({ archived: true, description: 'Text', notify: false, schedule: null })
    expect(await updateCheckInForm(user, MISSING, { name: 'X' }, { newVersion: false })).toBeNull()
  })

  test('soft delete and restore of forms', async () => {
    const user = getTestUser()
    const form = await insertCheckInForm(user, formInput)
    expect((await softDeleteCheckInForm(user, form.id))?.deleted_at).toBeInstanceOf(Date)
    expect(await softDeleteCheckInForm(user, form.id)).toBeNull()
    expect(await listCheckInForms(user)).toEqual([])
    expect((await listCheckInForms(user, { deleted: true })).map((f) => f.id)).toEqual([form.id])
    const restoredAt = at('2026-11-20T10:00:00Z')
    const restored = await restoreCheckInForm(user, form.id, restoredAt)
    expect(restored).toMatchObject({ deleted_at: null, schedule_not_before: restoredAt })
    expect(await restoreCheckInForm(user, form.id, restoredAt)).toBeNull()
  })

  test('check-ins carry the form name and the questions of their version', async () => {
    const user = getTestUser()
    const form = await insertCheckInForm(user, formInput)
    const checkIn = await insertCheckIn(user, {
      answered_at: at('2026-11-20T07:00:00Z'),
      answers: { notes: 'ok', rested: 4 },
      form_id: form.id,
      form_version: 1,
      ...ANSWERED,
      logged: { rested: { metric: 'rested', time: '2026-11-20T07:00:00.000Z' } },
      note: null,
      scheduled_for: at('2026-11-20T07:00:00Z'),
    })
    await updateCheckInForm(user, form.id, { name: 'Renamed', questions: [rested] }, { newVersion: true })
    const read = await getCheckIn(user, checkIn.id)
    expect(read).toMatchObject({
      answers: { notes: 'ok', rested: 4 },
      form_name: 'Renamed',
      form_version: 1,
      score_definition: formInput.score,
      status: 'answered',
    })
    expect(read!.questions.map((q) => q.key)).toEqual(['rested', 'notes'])
    expect(await getCheckIn(user, MISSING)).toBeNull()
  })

  test('updateCheckIn and setCheckInDeleted', async () => {
    const user = getTestUser()
    const form = await insertCheckInForm(user, formInput)
    const checkIn = await insertCheckIn(user, {
      answered_at: at('2026-11-20T07:00:00Z'),
      answers: { rested: 4 },
      form_id: form.id,
      form_version: 1,
      ...ANSWERED,
      logged: { rested: { metric: 'rested', time: '2026-11-20T07:00:00.000Z' } },
      note: 'n',
      scheduled_for: null,
    })
    const updated = await updateCheckIn(user, checkIn.id, {
      answered_at: at('2026-11-20T08:00:00Z'),
      answers: { rested: 2 },
      logged: {},
      note: null,
      scheduled_for: at('2026-11-20T07:00:00Z'),
    })
    expect(updated).toMatchObject({
      answered_at: at('2026-11-20T08:00:00Z'),
      answers: { rested: 2 },
      logged: {},
      note: null,
      scheduled_for: at('2026-11-20T07:00:00Z'),
    })
    expect(await updateCheckIn(user, MISSING, { note: 'x' })).toBeNull()
    await updateCheckIn(user, checkIn.id, { logged: { rested: { metric: 'rested', time: 'x' } } })
    expect(await setCheckInDeleted(user, checkIn.id, true)).toBe(true)
    expect(await setCheckInDeleted(user, checkIn.id, true)).toBe(false)
    expect(await getCheckIn(user, checkIn.id)).toMatchObject({ logged: {} })
    expect(await setCheckInDeleted(user, checkIn.id, false)).toBe(true)
    expect((await getCheckIn(user, checkIn.id))?.deleted_at).toBeNull()
  })

  test('listCheckIns pages newest first and filters', async () => {
    const user = getTestUser()
    const form = await insertCheckInForm(user, formInput)
    const other = await insertCheckInForm(user, { ...formInput, name: 'Other' })
    const add = (formId: string, iso: string) =>
      insertCheckIn(user, {
        answered_at: at(iso),
        answers: { rested: 3 },
        form_id: formId,
        form_version: 1,
        ...ANSWERED,
        logged: {},
        note: null,
        scheduled_for: null,
      })
    await add(form.id, '2026-11-20T06:00:00Z')
    const middle = await add(form.id, '2026-11-20T07:00:00Z')
    await add(form.id, '2026-11-20T08:00:00Z')
    await add(other.id, '2026-11-20T09:00:00Z')
    const first = await listCheckIns(user, { form_id: form.id, limit: 2 })
    expect(first.map((c) => c.answered_at.toISOString())).toEqual([
      '2026-11-20T08:00:00.000Z',
      '2026-11-20T07:00:00.000Z',
    ])
    const rest = await listCheckIns(user, {
      before: { id: first[1]!.id, ts: first[1]!.cursor_ts },
      form_id: form.id,
      limit: 2,
    })
    expect(rest.map((c) => c.answered_at.toISOString())).toEqual(['2026-11-20T06:00:00.000Z'])
    const ranged = await listCheckIns(user, {
      from: at('2026-11-20T07:00:00Z'),
      limit: 10,
      to: at('2026-11-20T09:00:00Z'),
    })
    expect(ranged.map((c) => c.answered_at.toISOString())).toEqual([
      '2026-11-20T08:00:00.000Z',
      '2026-11-20T07:00:00.000Z',
    ])
    await setCheckInDeleted(user, middle.id, true)
    expect((await listCheckIns(user, { deleted: true, limit: 10 })).map((c) => c.id)).toEqual([middle.id])
    expect(await listCheckIns(user, { limit: 10 })).toHaveLength(3)
  })

  test('listFormCheckInsBetween takes live check-ins answered or scheduled in the window', async () => {
    const user = getTestUser()
    const form = await insertCheckInForm(user, formInput)
    const base = { answers: {}, form_id: form.id, form_version: 1, ...ANSWERED, logged: {}, note: null }
    const inside = await insertCheckIn(user, {
      ...base,
      answered_at: at('2026-11-20T08:00:00Z'),
      scheduled_for: null,
    })
    const late = await insertCheckIn(user, {
      ...base,
      answered_at: at('2026-11-21T09:00:00Z'),
      scheduled_for: at('2026-11-20T07:00:00Z'),
    })
    await insertCheckIn(user, { ...base, answered_at: at('2026-11-22T08:00:00Z'), scheduled_for: null })
    const deleted = await insertCheckIn(user, {
      ...base,
      answered_at: at('2026-11-20T09:00:00Z'),
      scheduled_for: null,
    })
    await setCheckInDeleted(user, deleted.id, true)
    const rows = await listFormCheckInsBetween(
      user,
      form.id,
      at('2026-11-20T03:00:00Z'),
      at('2026-11-21T03:00:00Z'),
    )
    expect(rows.map((r) => r.id)).toEqual([inside.id, late.id])
  })

  test("deleteCheckInPoints hard-deletes only the check_in source's points, so they can be written again", async () => {
    const user = getTestUser()
    const time = at('2026-11-20T07:00:00Z')
    await insertTimeSeries(user, [
      { metric: 'rested', source: 'check_in', time, unit: 'score', value: 4 },
      { metric: 'rested', source: 'manual', time, unit: 'score', value: 2 },
    ])
    expect(await deleteCheckInPoints(user, [{ metric: 'rested', time: time.toISOString() }])).toBe(1)
    expect(await deleteCheckInPoints(user, [])).toBe(0)
    await insertTimeSeries(user, [{ metric: 'rested', source: 'check_in', time, unit: 'score', value: 5 }])
    const rows = await query<{ source: string; value: number }>(
      user,
      `SELECT source, value FROM time_series WHERE metric = 'rested' AND deleted_at IS NULL ORDER BY source`,
    )
    expect(rows.rows.map((r) => [r.source, Number(r.value)])).toEqual([
      ['check_in', 5],
      ['manual', 2],
    ])
  })

  test('markCheckInDueNotificationsRead marks only that form’s slots', async () => {
    const user = getTestUser()
    const slot = '2026-11-20T07:00:00.000Z'
    const raise = (formId: string, scheduledFor: string, key: string) =>
      insertNotification(user, {
        data: { form_id: formId, scheduled_for: scheduledFor },
        dedupe_key: key,
        in_app: true,
        push: true,
        title: 'Morning',
        type: 'check_in_due',
      })
    const mine = await raise('form-a', slot, 'a1')
    const otherSlot = await raise('form-a', '2026-11-20T19:00:00.000Z', 'a2')
    const otherForm = await raise('form-b', slot, 'b1')
    expect(await markCheckInDueNotificationsRead(user, 'form-a', [slot])).toBe(1)
    expect(await markCheckInDueNotificationsRead(user, 'form-a', [])).toBe(0)
    expect((await getNotificationById(user, mine!.id))?.read_at).toBeInstanceOf(Date)
    expect((await getNotificationById(user, otherSlot!.id))?.read_at).toBeNull()
    expect((await getNotificationById(user, otherForm!.id))?.read_at).toBeNull()
  })

  test('markCheckInDueNotificationsRead also clears the actions of one already read', async () => {
    const user = getTestUser()
    const slot = '2026-11-20T07:00:00.000Z'
    const raised = await insertNotification(user, {
      actions: [
        { key: 'done', label: 'Done' },
        { key: 'skip', label: 'Skip' },
      ],
      data: { form_id: 'form-a', scheduled_for: slot },
      dedupe_key: 'a1',
      in_app: true,
      push: true,
      title: 'Morning',
      type: 'check_in_due',
    })
    await query(user, `UPDATE notifications SET read_at = '2026-11-20T07:01:00Z' WHERE id = $1`, [raised!.id])
    expect(await markCheckInDueNotificationsRead(user, 'form-a', [slot])).toBe(1)
    const read = await getNotificationById(user, raised!.id)
    expect(read).toMatchObject({ actions: [], read_at: at('2026-11-20T07:01:00Z') })
    expect(await markCheckInDueNotificationsRead(user, 'form-a', [slot])).toBe(0)
  })

  test('skips, activities and entities are stored and read back', async () => {
    const user = getTestUser()
    const form = await insertCheckInForm(user, formInput)
    const slot = at('2026-11-20T07:00:00Z')
    const activity = await query<{ id: string }>(
      user,
      `INSERT INTO activities (source, activity_type, start_time, external_id)
       VALUES ('check_in', 'meditation', $1, 'check_in:test') RETURNING id`,
      [slot],
    )
    const gone = await query<{ id: string }>(
      user,
      `INSERT INTO activities (source, activity_type, start_time, external_id, deleted_at)
       VALUES ('check_in', 'meditation', $1, 'check_in:gone', NOW()) RETURNING id`,
      [slot],
    )
    const liveId = activity.rows[0]!.id
    const goneId = gone.rows[0]!.id
    const answered = await insertCheckIn(user, {
      activity_ids: { gone: goneId, rested: liveId },
      answered_at: slot,
      answers: { rested: 4 },
      entity_id: liveId,
      entity_type: 'activity',
      form_id: form.id,
      form_version: 1,
      logged: {},
      note: null,
      scheduled_for: null,
      status: 'answered',
    })
    expect(answered).toMatchObject({
      activity_ids: { gone: goneId, rested: liveId },
      entity_id: liveId,
      entity_type: 'activity',
      live_activity_ids: [liveId],
    })
    expect((await updateCheckIn(user, answered.id, { activity_ids: {} }))?.activity_ids).toEqual({})

    const skip = await insertCheckIn(user, {
      ...ANSWERED,
      answered_at: new Date(slot.getTime() + 60_000),
      answers: {},
      form_id: form.id,
      form_version: 1,
      logged: {},
      note: null,
      scheduled_for: slot,
      status: 'skipped',
    })
    expect(skip.status).toBe('skipped')
    const rows = await listFormCheckInsBetween(
      user,
      form.id,
      at('2026-11-20T03:00:00Z'),
      at('2026-11-21T03:00:00Z'),
    )
    expect(rows.map((r) => [r.status, r.answers])).toEqual([
      ['answered', { rested: 4 }],
      ['skipped', {}],
    ])
    expect(
      (await listCheckIns(user, { entity: { id: liveId, type: 'activity' }, limit: 10 })).map((c) => c.id),
    ).toEqual([answered.id])
    expect(await deleteSkippedCheckIns(user, form.id, at('2026-11-20T08:00:00Z'))).toBe(0)
    expect(await deleteSkippedCheckIns(user, form.id, slot)).toBe(1)
    expect(await getCheckIn(user, skip.id)).toBeNull()
    expect(await getCheckIn(user, answered.id)).not.toBeNull()
  })

  test('purgeDeletedCheckIns removes what was deleted before the cutoff, with a form its check-ins', async () => {
    const user = getTestUser()
    const kept = await insertCheckInForm(user, formInput)
    const gone = await insertCheckInForm(user, { ...formInput, name: 'Gone' })
    const base = { answers: {}, form_version: 1, ...ANSWERED, logged: {}, note: null, scheduled_for: null }
    const oldCheckIn = await insertCheckIn(user, {
      ...base,
      answered_at: at('2026-10-01T07:00:00Z'),
      form_id: kept.id,
    })
    const liveCheckIn = await insertCheckIn(user, {
      ...base,
      answered_at: at('2026-10-02T07:00:00Z'),
      form_id: kept.id,
    })
    await insertCheckIn(user, { ...base, answered_at: at('2026-10-03T07:00:00Z'), form_id: gone.id })
    await setCheckInDeleted(user, oldCheckIn.id, true)
    await softDeleteCheckInForm(user, gone.id)
    await query(user, `UPDATE check_ins SET deleted_at = '2026-10-01' WHERE id = $1`, [oldCheckIn.id])
    await query(user, `UPDATE check_in_forms SET deleted_at = '2026-10-01' WHERE id = $1`, [gone.id])
    expect(await purgeDeletedCheckIns(user, at('2026-10-20T00:00:00Z'))).toEqual({ check_ins: 1, forms: 1 })
    expect(await getCheckIn(user, oldCheckIn.id)).toBeNull()
    expect(await getCheckIn(user, liveCheckIn.id)).not.toBeNull()
    expect(await getCheckInForm(user, gone.id)).toBeNull()
    expect(await listCheckInFormVersions(user, gone.id)).toEqual([])
  })
})
