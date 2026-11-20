import type { AddCheckInFormBody, CheckInQuestion } from '@aurboda/api-spec'

import { addCheckInFormBodySchema, scheduleSchema } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import { fakeCheckInDeps } from './__fixtures__/check-in-deps.ts'
import {
  addCheckInForm,
  type CheckInDeps,
  checkInDueDedupeKey,
  deleteCheckInById,
  deleteCheckInFormById,
  listDue,
  metricTargetProblems,
  queryCheckIns,
  raiseDueCheckIns,
  restoreCheckInById,
  restoreCheckInFormById,
  submitCheckIn,
  updateCheckInById,
  updateCheckInFormById,
} from './check-ins.ts'
import { loadMetricCatalog } from './metric-catalog.ts'

const USER = 'alice'
const MISSING = '99999999-9999-4999-8999-999999999999'

const rested: CheckInQuestion = {
  key: 'rested',
  logs_to: { metric: 'rested' },
  max: 5,
  min: 1,
  prompt: 'How rested?',
  required: true,
  type: 'scale',
}
const dose: CheckInQuestion = {
  key: 'dose',
  logs_to: { metric: 'ibuprofen_mg' },
  prompt: 'Dose',
  required: false,
  type: 'number',
  unit: 'mg',
}
const notes: CheckInQuestion = { key: 'notes', prompt: 'Notes', required: false, type: 'text' }

const body = (fields: Record<string, unknown>): AddCheckInFormBody => addCheckInFormBodySchema.parse(fields)

const unwrap = <T>(outcome: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!outcome.ok) throw new Error(outcome.error)
  return outcome.value
}

const addForm = async (deps: CheckInDeps, fields: Record<string, unknown> = {}) =>
  unwrap(
    await addCheckInForm(deps, USER, body({ name: 'Morning', questions: [rested, dose, notes], ...fields })),
  )

describe('addCheckInForm', () => {
  test('creates a form at version 1', async () => {
    const { deps } = fakeCheckInDeps()
    const form = await addForm(deps)
    expect(form).toMatchObject({
      archived: false,
      deleted_at: null,
      name: 'Morning',
      notify: true,
      version: 1,
    })
  })

  test('copies a template, with overrides', async () => {
    const { deps } = fakeCheckInDeps()
    const form = unwrap(await addCheckInForm(deps, USER, body({ name: 'Evening', template: 'mood_energy' })))
    expect(form.name).toBe('Evening')
    expect(form.questions.map((question) => question.key)).toEqual(['mood', 'energy', 'notes'])
  })

  test('refuses an unknown template', async () => {
    const { deps } = fakeCheckInDeps()
    const outcome = await addCheckInForm(deps, USER, body({ template: 'nope' }))
    expect(outcome).toMatchObject({ ok: false, status: 400 })
  })

  test('refuses a metric that cannot take check-in points', async () => {
    const { deps } = fakeCheckInDeps()
    const outcome = await addCheckInForm(
      deps,
      USER,
      body({ name: 'Steps', questions: [{ ...dose, logs_to: { metric: 'steps' }, unit: undefined }] }),
    )
    expect(outcome).toMatchObject({ ok: false, status: 400 })
  })
})

describe('metricTargetProblems', () => {
  const catalog = loadMetricCatalog()

  test('a new name is fine, a computed metric or a wrong unit is not', () => {
    expect(metricTargetProblems([rested], null, [], catalog)).toEqual([])
    expect(
      metricTargetProblems([{ ...rested, logs_to: { metric: 'steps' } }], null, [], catalog)[0],
    ).toContain('computed from other sources')
    expect(
      metricTargetProblems([{ ...dose, logs_to: { metric: 'weight' }, unit: 'mg' }], null, [], catalog),
    ).toHaveLength(1)
    expect(
      metricTargetProblems([{ ...dose, logs_to: { metric: 'weight' }, unit: 'kg' }], null, [], catalog),
    ).toEqual([])
  })
})

describe('updateCheckInFormById', () => {
  test('renaming or reordering keeps the version; changing a question bumps it', async () => {
    const { deps, versions } = fakeCheckInDeps()
    const form = await addForm(deps)
    const renamed = unwrap(await updateCheckInFormById(deps, USER, form.id, { name: 'Morning 2' }))
    expect(renamed.version).toBe(1)
    const reordered = unwrap(
      await updateCheckInFormById(deps, USER, form.id, { questions: [notes, dose, rested] }),
    )
    expect(reordered.version).toBe(1)
    expect(versions.get(form.id)![0]!.questions.map((q) => q.key)).toEqual(['notes', 'dose', 'rested'])
    const changed = unwrap(
      await updateCheckInFormById(deps, USER, form.id, {
        questions: [{ ...rested, prompt: 'Rested?' }, dose],
      }),
    )
    expect(changed.version).toBe(2)
    expect(versions.get(form.id)).toHaveLength(2)
  })

  test('a removed key cannot come back with another type', async () => {
    const { deps } = fakeCheckInDeps()
    const form = await addForm(deps)
    unwrap(await updateCheckInFormById(deps, USER, form.id, { questions: [rested, dose] }))
    const outcome = await updateCheckInFormById(deps, USER, form.id, {
      questions: [rested, dose, { ...notes, type: 'yes_no' }],
    })
    expect(outcome).toMatchObject({ ok: false, status: 400 })
    expect(outcome.ok ? '' : outcome.error).toContain('"notes"')
  })

  test('a score over a removed question is refused', async () => {
    const { deps } = fakeCheckInDeps()
    const form = await addForm(deps, { score: { metric: 'total', questions: ['rested'] } })
    const outcome = await updateCheckInFormById(deps, USER, form.id, { questions: [dose] })
    expect(outcome).toMatchObject({ ok: false, status: 400 })
  })

  test('a changed schedule, notify switched on or unarchiving restarts it from now', async () => {
    const fake = fakeCheckInDeps({ now: new Date('2026-11-20T10:00:00Z') })
    const form = await addForm(fake.deps, { schedule: { times: ['08:00'] } })
    fake.setNow(new Date('2026-11-20T11:00:00Z'))
    await updateCheckInFormById(fake.deps, USER, form.id, { name: 'Renamed' })
    expect(fake.forms.get(form.id)!.schedule_not_before.toISOString()).toBe('2026-11-20T10:00:00.000Z')
    await updateCheckInFormById(fake.deps, USER, form.id, {
      schedule: scheduleSchema.parse({ times: ['09:00'] }),
    })
    expect(fake.forms.get(form.id)!.schedule_not_before.toISOString()).toBe('2026-11-20T11:00:00.000Z')
    fake.setNow(new Date('2026-11-20T12:00:00Z'))
    await updateCheckInFormById(fake.deps, USER, form.id, { notify: false })
    await updateCheckInFormById(fake.deps, USER, form.id, { notify: true })
    expect(fake.forms.get(form.id)!.schedule_not_before.toISOString()).toBe('2026-11-20T12:00:00.000Z')
  })

  test('404 for an unknown or deleted form', async () => {
    const { deps } = fakeCheckInDeps()
    expect(await updateCheckInFormById(deps, USER, MISSING, { name: 'X' })).toMatchObject({ status: 404 })
    expect(await updateCheckInFormById(deps, USER, 'not-a-uuid', { name: 'X' })).toMatchObject({
      status: 404,
    })
    const form = await addForm(deps)
    await deleteCheckInFormById(deps, USER, form.id)
    expect(await updateCheckInFormById(deps, USER, form.id, { name: 'X' })).toMatchObject({ status: 404 })
  })
})

describe('deleting and restoring forms', () => {
  test('a deleted form is listed only as deleted, and restoring restarts its schedule', async () => {
    const fake = fakeCheckInDeps()
    const form = await addForm(fake.deps)
    expect((await deleteCheckInFormById(fake.deps, USER, form.id))?.deleted_at).not.toBeNull()
    expect(await deleteCheckInFormById(fake.deps, USER, form.id)).toBeNull()
    fake.setNow(new Date('2026-11-21T10:00:00Z'))
    const restored = await restoreCheckInFormById(fake.deps, USER, form.id)
    expect(restored?.deleted_at).toBeNull()
    expect(fake.forms.get(form.id)!.schedule_not_before.toISOString()).toBe('2026-11-21T10:00:00.000Z')
    expect(await restoreCheckInFormById(fake.deps, USER, form.id)).toBeNull()
  })
})

describe('submitCheckIn', () => {
  test('logs numeric answers as metric points at answered_at and creates new custom metrics', async () => {
    const fake = fakeCheckInDeps()
    const form = await addForm(fake.deps)
    const checkIn = unwrap(
      await submitCheckIn(fake.deps, USER, {
        answered_at: '2026-11-20T07:00:00.000Z',
        answers: { dose: 400, notes: 'ok', rested: 4 },
        form_id: form.id,
      }),
    )
    expect(fake.points).toEqual([
      { metric: 'rested', time: '2026-11-20T07:00:00.000Z', value: 4 },
      { metric: 'ibuprofen_mg', time: '2026-11-20T07:00:00.000Z', unit: 'mg', value: 400 },
    ])
    expect(checkIn.logged).toEqual({
      dose: { metric: 'ibuprofen_mg', time: '2026-11-20T07:00:00.000Z' },
      rested: { metric: 'rested', time: '2026-11-20T07:00:00.000Z' },
    })
    expect(fake.customMetrics).toEqual([
      { description: 'Morning', name: 'rested', unit: 'score' },
      { description: 'Morning', name: 'ibuprofen_mg', unit: 'mg' },
    ])
    expect(checkIn).toMatchObject({ form_name: 'Morning', form_version: 1, status: 'answered' })
    expect(checkIn.questions.map((q) => q.key)).toEqual(['rested', 'dose', 'notes'])
  })

  test('0 and a missing answer log nothing', async () => {
    const fake = fakeCheckInDeps()
    const form = await addForm(fake.deps)
    const checkIn = unwrap(
      await submitCheckIn(fake.deps, USER, { answers: { dose: 0, rested: 2 }, form_id: form.id }),
    )
    expect(Object.keys(checkIn.logged)).toEqual(['rested'])
  })

  test('logs the score and reports what could not be logged', async () => {
    const fake = fakeCheckInDeps()
    const form = await addForm(fake.deps, {
      questions: [rested, { ...dose, logs_to: { metric: 'refused' } }],
      score: { factor: 2, metric: 'total', questions: ['rested'] },
    })
    const checkIn = unwrap(
      await submitCheckIn(fake.deps, USER, { answers: { dose: 1, rested: 3 }, form_id: form.id }),
    )
    expect(checkIn.score).toBe(6)
    expect(checkIn.logged._score).toMatchObject({ metric: 'total' })
    expect(checkIn.log_errors).toEqual([{ error: 'Refused', question_key: 'dose' }])
  })

  test('refuses bad answers and unknown or deleted forms', async () => {
    const { deps } = fakeCheckInDeps()
    const form = await addForm(deps)
    expect(await submitCheckIn(deps, USER, { answers: {}, form_id: form.id })).toMatchObject({ status: 400 })
    expect(await submitCheckIn(deps, USER, { answers: {}, form_id: MISSING })).toMatchObject({ status: 404 })
    await deleteCheckInFormById(deps, USER, form.id)
    expect(await submitCheckIn(deps, USER, { answers: { rested: 1 }, form_id: form.id })).toMatchObject({
      status: 404,
    })
  })

  test("marks the done slot's notification read", async () => {
    const fake = fakeCheckInDeps({ now: new Date('2026-11-20T07:10:00Z') })
    const form = await addForm(fake.deps, { schedule: { times: ['08:00', '20:00'] } })
    await submitCheckIn(fake.deps, USER, { answers: { rested: 3 }, form_id: form.id })
    expect(fake.markedRead).toEqual([[form.id, ['2026-11-20T07:00:00.000Z']]])
  })
})

describe('editing, deleting and restoring check-ins', () => {
  test('an edit replaces exactly the points the check-in wrote and is read against its version', async () => {
    const fake = fakeCheckInDeps()
    const form = await addForm(fake.deps)
    fake.points.push({ metric: 'rested', time: '2026-11-19T07:00:00.000Z', value: 5 })
    const checkIn = unwrap(
      await submitCheckIn(fake.deps, USER, {
        answered_at: '2026-11-20T07:00:00.000Z',
        answers: { dose: 200, rested: 4 },
        form_id: form.id,
      }),
    )
    unwrap(await updateCheckInFormById(fake.deps, USER, form.id, { questions: [{ ...rested, max: 10 }] }))
    expect(await updateCheckInById(fake.deps, USER, checkIn.id, { answers: { rested: 8 } })).toMatchObject({
      status: 400,
    })
    const edited = unwrap(
      await updateCheckInById(fake.deps, USER, checkIn.id, {
        answered_at: '2026-11-20T07:30:00.000Z',
        answers: { rested: 2 },
      }),
    )
    expect(edited.form_version).toBe(1)
    expect(fake.points).toEqual([
      { metric: 'rested', time: '2026-11-19T07:00:00.000Z', value: 5 },
      { metric: 'rested', time: '2026-11-20T07:30:00.000Z', value: 2 },
    ])
    expect(edited.logged).toEqual({ rested: { metric: 'rested', time: '2026-11-20T07:30:00.000Z' } })
  })

  test('editing only the note leaves the points', async () => {
    const fake = fakeCheckInDeps()
    const form = await addForm(fake.deps)
    const checkIn = unwrap(await submitCheckIn(fake.deps, USER, { answers: { rested: 4 }, form_id: form.id }))
    const edited = unwrap(await updateCheckInById(fake.deps, USER, checkIn.id, { note: 'slept badly' }))
    expect(edited.note).toBe('slept badly')
    expect(fake.points).toHaveLength(1)
  })

  test('deleting removes the points and restoring writes them again', async () => {
    const fake = fakeCheckInDeps()
    const form = await addForm(fake.deps)
    const checkIn = unwrap(await submitCheckIn(fake.deps, USER, { answers: { rested: 4 }, form_id: form.id }))
    const deleted = await deleteCheckInById(fake.deps, USER, checkIn.id)
    expect(deleted?.deleted_at).not.toBeNull()
    expect(deleted?.logged).toEqual({})
    expect(fake.points).toEqual([])
    expect(await deleteCheckInById(fake.deps, USER, checkIn.id)).toBeNull()
    expect(await updateCheckInById(fake.deps, USER, checkIn.id, { note: 'x' })).toMatchObject({ status: 404 })
    const restored = unwrap(await restoreCheckInById(fake.deps, USER, checkIn.id))
    expect(restored.deleted_at).toBeNull()
    expect(fake.points).toHaveLength(1)
    expect(Object.keys(restored.logged)).toEqual(['rested'])
    expect(await restoreCheckInById(fake.deps, USER, checkIn.id)).toMatchObject({ status: 404 })
  })
})

describe('queryCheckIns', () => {
  test('pages newest first with a cursor and filters by form', async () => {
    const fake = fakeCheckInDeps()
    const form = await addForm(fake.deps)
    const other = await addForm(fake.deps, { name: 'Other' })
    for (const hour of ['06', '07', '08']) {
      await submitCheckIn(fake.deps, USER, {
        answered_at: `2026-11-20T${hour}:00:00.000Z`,
        answers: { rested: 3 },
        form_id: form.id,
      })
    }
    await submitCheckIn(fake.deps, USER, { answers: { rested: 3 }, form_id: other.id })
    const first = await queryCheckIns(fake.deps, USER, { form_id: form.id, limit: 2 })
    expect(first.check_ins.map((c) => c.answered_at)).toEqual([
      '2026-11-20T08:00:00.000Z',
      '2026-11-20T07:00:00.000Z',
    ])
    expect(first.next_cursor).not.toBeNull()
    const second = await queryCheckIns(fake.deps, USER, {
      cursor: first.next_cursor!,
      form_id: form.id,
      limit: 2,
    })
    expect(second.check_ins.map((c) => c.answered_at)).toEqual(['2026-11-20T06:00:00.000Z'])
    expect(second.next_cursor).toBeNull()
  })

  test("a deleted form's check-ins stay listed with its name", async () => {
    const fake = fakeCheckInDeps()
    const form = await addForm(fake.deps)
    await submitCheckIn(fake.deps, USER, { answers: { rested: 3 }, form_id: form.id })
    await deleteCheckInFormById(fake.deps, USER, form.id)
    const { check_ins } = await queryCheckIns(fake.deps, USER, { limit: 10 })
    expect(check_ins.map((c) => c.form_name)).toEqual(['Morning'])
  })
})

describe('listDue', () => {
  test("lists each scheduled form's slots of the current day with their state", async () => {
    const fake = fakeCheckInDeps({ now: new Date('2026-11-20T10:00:00Z') })
    const form = await addForm(fake.deps, { schedule: { times: ['08:00', '20:00', '00:30'] } })
    await addForm(fake.deps, { name: 'Unscheduled' })
    await addForm(fake.deps, { name: 'Archived', schedule: { times: ['09:00'] } }).then((archived) =>
      updateCheckInFormById(fake.deps, USER, archived.id, { archived: true }),
    )
    const due = await listDue(fake.deps, USER)
    expect(due.timezone).toBe('Europe/Stockholm')
    expect(due.slots.map((slot) => [slot.form_id, slot.time, slot.state, slot.date])).toEqual([
      [form.id, '08:00', 'due', '2026-11-20'],
      [form.id, '20:00', 'upcoming', '2026-11-20'],
      [form.id, '00:30', 'upcoming', '2026-11-20'],
    ])
  })

  test('takes a date, where everything not done is missed once over', async () => {
    const fake = fakeCheckInDeps({ now: new Date('2026-11-20T10:00:00Z') })
    await addForm(fake.deps, { schedule: { times: ['08:00'] } })
    const due = await listDue(fake.deps, USER, '2026-11-18')
    expect(due.slots.map((slot) => slot.state)).toEqual(['missed'])
  })
})

describe('raiseDueCheckIns', () => {
  const schedule = { times: ['08:00', '20:00'] }

  test('raises a slot due within the hour, once per slot key, and not before the schedule began', async () => {
    const fake = fakeCheckInDeps({ now: new Date('2026-11-20T06:00:00Z') })
    const form = await addForm(fake.deps, { schedule })
    fake.setNow(new Date('2026-11-20T07:05:00Z'))
    expect(await raiseDueCheckIns(fake.deps, USER)).toBe(1)
    expect(fake.raised).toEqual([
      {
        data: { form_id: form.id, scheduled_for: '2026-11-20T07:00:00.000Z' },
        dedupe_key: checkInDueDedupeKey(form.id, { date: '2026-11-20', time: '08:00' }),
        link: `/check-ins/${form.id}`,
        title: 'Morning',
        type: 'check_in_due',
      },
    ])
    expect(fake.raised[0]!.dedupe_key).toBe(`check_in:${form.id}:2026-11-20:08:00`)
  })

  test('raises nothing more than an hour overdue, for a schedule made after the slot, or once done', async () => {
    const fake = fakeCheckInDeps({ now: new Date('2026-11-20T07:30:00Z') })
    const form = await addForm(fake.deps, { schedule })
    expect(await raiseDueCheckIns(fake.deps, USER)).toBe(0)
    fake.forms.set(form.id, {
      ...fake.forms.get(form.id)!,
      schedule_not_before: new Date('2026-11-01T00:00:00Z'),
    })
    expect(await raiseDueCheckIns(fake.deps, USER)).toBe(1)
    fake.setNow(new Date('2026-11-20T08:00:00Z'))
    expect(await raiseDueCheckIns(fake.deps, USER)).toBe(0)
    fake.setNow(new Date('2026-11-20T07:30:00Z'))
    await submitCheckIn(fake.deps, USER, { answers: { rested: 3 }, form_id: form.id })
    expect(await raiseDueCheckIns(fake.deps, USER)).toBe(0)
  })

  test('a slot after midnight belongs to the day before and is raised on time', async () => {
    const fake = fakeCheckInDeps({ now: new Date('2026-11-19T12:00:00Z') })
    const form = await addForm(fake.deps, { schedule: { times: ['00:30'] } })
    fake.setNow(new Date('2026-11-20T23:40:00Z'))
    expect(await raiseDueCheckIns(fake.deps, USER)).toBe(1)
    expect(fake.raised[0]!.dedupe_key).toBe(`check_in:${form.id}:2026-11-20:00:30`)
  })

  test('notify off, archived or deleted raises nothing', async () => {
    const fake = fakeCheckInDeps({ now: new Date('2026-11-19T12:00:00Z') })
    const quiet = await addForm(fake.deps, { notify: false, schedule })
    const archived = await addForm(fake.deps, { schedule })
    await updateCheckInFormById(fake.deps, USER, archived.id, { archived: true })
    const deleted = await addForm(fake.deps, { schedule })
    await deleteCheckInFormById(fake.deps, USER, deleted.id)
    fake.setNow(new Date('2026-11-20T07:05:00Z'))
    expect(await raiseDueCheckIns(fake.deps, USER)).toBe(0)
    expect(quiet.notify).toBe(false)
  })
})
