import type { CheckInQuestion } from '@aurboda/api-spec'

import { addCheckInFormBodySchema } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import { fakeCheckInDeps } from './__fixtures__/check-in-deps.ts'
import {
  addCheckInForm,
  type CheckInDeps,
  CHECK_IN_DUE_ACTIONS,
  deleteCheckInById,
  getCheckInAdherence,
  listCheckInFormsView,
  listDue,
  queryCheckIns,
  raiseDueCheckIns,
  restoreCheckInById,
  submitCheckIn,
  updateCheckInById,
  updateCheckInFormById,
} from './check-ins.ts'

const USER = 'alice'
const MISSING = '99999999-9999-4999-8999-999999999999'

const vitaminD: CheckInQuestion = {
  default: 50,
  key: 'vitamin_d',
  logs_to: {
    activity_type: 'supplement',
    answer_field: 'dose',
    fields: { dose_unit: 'µg', substance: 'vitamin D' },
  },
  prompt: 'Vitamin D',
  required: true,
  type: 'number',
  unit: 'µg',
}
const magnesium: CheckInQuestion = {
  default: 200,
  key: 'magnesium',
  logs_to: {
    activity_type: 'supplement',
    answer_field: 'dose',
    fields: { dose_unit: 'mg', substance: 'magnesium' },
  },
  prompt: 'Magnesium',
  required: false,
  type: 'number',
  unit: 'mg',
}
const fishOil: CheckInQuestion = {
  default: true,
  key: 'fish_oil',
  logs_to: { activity_type: 'supplement', fields: { substance: 'fish oil' } },
  prompt: 'Fish oil',
  required: false,
  type: 'yes_no',
}

const unwrap = <T>(outcome: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!outcome.ok) throw new Error(outcome.error)
  return outcome.value
}

const addRoutine = async (deps: CheckInDeps, fields: Record<string, unknown> = {}) =>
  unwrap(
    await addCheckInForm(
      deps,
      USER,
      addCheckInFormBodySchema.parse({
        name: 'Morning stack',
        questions: [vitaminD, magnesium, fishOil],
        ...fields,
      }),
    ),
  )

describe('preset answers', () => {
  test('a form whose required questions all have a default is a routine', async () => {
    const { deps } = fakeCheckInDeps()
    expect((await addRoutine(deps)).is_routine).toBe(true)
    const plain = await addRoutine(deps, {
      questions: [{ ...vitaminD, default: undefined }, magnesium],
    })
    expect(plain.is_routine).toBe(false)
    expect((await listCheckInFormsView(deps, USER)).map((form) => form.is_routine)).toEqual([true, false])
  })

  test('refuses a default that is not a valid answer', async () => {
    const { deps } = fakeCheckInDeps()
    const outcome = await addCheckInForm(
      deps,
      USER,
      addCheckInFormBodySchema.parse({
        name: 'Bad',
        questions: [{ default: 9, key: 'rested', max: 5, min: 1, prompt: 'Rested?', type: 'scale' }],
      }),
    )
    expect(outcome).toMatchObject({ ok: false, status: 400 })
    expect(!outcome.ok && outcome.error).toContain('The default of "rested"')
  })

  test('changing a default makes a new version', async () => {
    const { deps } = fakeCheckInDeps()
    const form = await addRoutine(deps)
    const updated = unwrap(
      await updateCheckInFormById(deps, USER, form.id, {
        questions: [{ ...vitaminD, default: 100 }, magnesium, fishOil],
      }),
    )
    expect(updated.version).toBe(2)
  })

  test('use_defaults saves the presets, with explicit answers winning per key', async () => {
    const { deps } = fakeCheckInDeps()
    const form = await addRoutine(deps)
    const checkIn = unwrap(
      await submitCheckIn(deps, USER, { answers: { magnesium: 400 }, form_id: form.id, use_defaults: true }),
    )
    expect(checkIn.answers).toEqual({ fish_oil: true, magnesium: 400, vitamin_d: 50 })
  })

  test('use_defaults on a form that is not a routine is a 400', async () => {
    const { deps } = fakeCheckInDeps()
    const form = await addRoutine(deps, { questions: [{ ...vitaminD, default: undefined }] })
    expect(
      await submitCheckIn(deps, USER, { answers: {}, form_id: form.id, use_defaults: true }),
    ).toMatchObject({
      ok: false,
      status: 400,
    })
  })
})

describe('logging to activities', () => {
  test('logs each taken item as an activity at answered_at; 0 and no log nothing', async () => {
    const { activities, deps } = fakeCheckInDeps()
    const form = await addRoutine(deps)
    const checkIn = unwrap(
      await submitCheckIn(deps, USER, {
        answered_at: '2026-11-20T07:00:00.000Z',
        answers: { fish_oil: false, magnesium: 0, vitamin_d: 50 },
        form_id: form.id,
      }),
    )
    expect(Object.keys(checkIn.activities)).toEqual(['vitamin_d'])
    expect(checkIn.activities.vitamin_d!.logged).toBe(true)
    const activity = activities.get(checkIn.activities.vitamin_d!.activity_id)!
    expect(activity).toMatchObject({
      activity_type: 'supplement',
      data: { dose: 50, dose_unit: 'µg', substance: 'vitamin D' },
      start_time: new Date('2026-11-20T07:00:00.000Z'),
    })
    expect(activity.external_id).toMatch(/^check_in:/)
  })

  test('a yes logs the activity with its fields only', async () => {
    const { activities, deps } = fakeCheckInDeps()
    const form = await addRoutine(deps)
    const checkIn = unwrap(
      await submitCheckIn(deps, USER, { answers: {}, form_id: form.id, use_defaults: true }),
    )
    expect(activities.get(checkIn.activities.fish_oil!.activity_id)!.data).toEqual({ substance: 'fish oil' })
    expect(activities.size).toBe(3)
  })

  test('an item that cannot be logged is reported in log_errors', async () => {
    const { deps } = fakeCheckInDeps()
    const form = await addRoutine(deps, { questions: [{ ...vitaminD, default: undefined, required: false }] })
    const checkIn = unwrap(await submitCheckIn(deps, USER, { answers: { vitamin_d: -1 }, form_id: form.id }))
    expect(checkIn.activities).toEqual({})
    expect(checkIn.log_errors).toEqual([
      { error: expect.stringContaining('dose'), question_key: 'vitamin_d' },
    ])
  })

  test('refuses an unknown activity type and fields the type does not have', async () => {
    const { deps } = fakeCheckInDeps()
    const unknown = await addCheckInForm(
      deps,
      USER,
      addCheckInFormBodySchema.parse({
        name: 'X',
        questions: [{ ...vitaminD, logs_to: { activity_type: 'nonsense' } }],
      }),
    )
    expect(!unknown.ok && unknown.error).toContain('neither one of your activity types nor in the catalogue')
    const badField = await addCheckInForm(
      deps,
      USER,
      addCheckInFormBodySchema.parse({
        name: 'X',
        questions: [{ ...vitaminD, logs_to: { activity_type: 'supplement', answer_field: 'substance' } }],
      }),
    )
    expect(!badField.ok && badField.error).toContain('is not a number field')
  })

  test('a type without a schema takes any fields', async () => {
    const { deps } = fakeCheckInDeps({ activityTypes: { stretching: undefined } })
    const outcome = await addCheckInForm(
      deps,
      USER,
      addCheckInFormBodySchema.parse({
        name: 'X',
        questions: [{ ...vitaminD, logs_to: { activity_type: 'stretching', answer_field: 'minutes' } }],
      }),
    )
    expect(outcome.ok).toBe(true)
  })

  test('editing replaces exactly the activities it made', async () => {
    const { activities, deps } = fakeCheckInDeps()
    const form = await addRoutine(deps)
    const first = unwrap(
      await submitCheckIn(deps, USER, { answers: {}, form_id: form.id, use_defaults: true }),
    )
    const before = Object.values(first.activities).map((activity) => activity.activity_id)
    const edited = unwrap(
      await updateCheckInById(deps, USER, first.id, { answers: { fish_oil: false, vitamin_d: 100 } }),
    )
    for (const id of before) expect(activities.get(id)!.deleted).toBe(true)
    expect(Object.keys(edited.activities)).toEqual(['vitamin_d'])
    expect(activities.get(edited.activities.vitamin_d!.activity_id)).toMatchObject({
      data: { dose: 100 },
      deleted: false,
    })
  })

  test('a note-only edit keeps the activities', async () => {
    const { deps } = fakeCheckInDeps()
    const form = await addRoutine(deps)
    const first = unwrap(
      await submitCheckIn(deps, USER, { answers: {}, form_id: form.id, use_defaults: true }),
    )
    const edited = unwrap(await updateCheckInById(deps, USER, first.id, { note: 'with breakfast' }))
    expect(edited.activities).toEqual(first.activities)
  })

  test('deleting soft-deletes them and restoring restores them, but not one deleted on its own', async () => {
    const { activities, deps } = fakeCheckInDeps()
    const form = await addRoutine(deps)
    const checkIn = unwrap(
      await submitCheckIn(deps, USER, { answers: {}, form_id: form.id, use_defaults: true }),
    )
    const vitaminId = checkIn.activities.vitamin_d!.activity_id
    const magnesiumId = checkIn.activities.magnesium!.activity_id
    activities.get(magnesiumId)!.deleted = true

    const read = (await queryCheckIns(deps, USER, { limit: 10 })).check_ins[0]!
    expect(read.answers.magnesium).toBe(200)
    expect(read.activities.magnesium).toEqual({ activity_id: magnesiumId, logged: false })

    const deleted = (await deleteCheckInById(deps, USER, checkIn.id))!
    expect(activities.get(vitaminId)!.deleted).toBe(true)
    expect(Object.keys(deleted.activities).sort()).toEqual(['fish_oil', 'vitamin_d'])

    const restored = unwrap(await restoreCheckInById(deps, USER, checkIn.id))
    expect(activities.get(vitaminId)!.deleted).toBe(false)
    expect(activities.get(magnesiumId)!.deleted).toBe(true)
    expect(restored.activities.vitamin_d!.logged).toBe(true)
  })
})

describe('skipping', () => {
  const scheduled = { schedule: { times: ['08:00'] } }
  const slot = '2026-11-20T07:00:00.000Z'

  test('records a skipped slot, which list_due shows', async () => {
    const { deps, markedRead } = fakeCheckInDeps({ now: new Date('2026-11-20T07:30:00Z') })
    const form = await addRoutine(deps, scheduled)
    const skip = unwrap(
      await submitCheckIn(deps, USER, {
        answers: {},
        form_id: form.id,
        scheduled_for: slot,
        status: 'skipped',
      }),
    )
    expect(skip).toMatchObject({
      activities: {},
      answers: {},
      logged: {},
      scheduled_for: slot,
      status: 'skipped',
    })
    expect((await listDue(deps, USER)).slots[0]).toMatchObject({ check_in_id: skip.id, state: 'skipped' })
    expect(markedRead.at(-1)).toEqual([form.id, [slot]])
  })

  test('a skip of a slot already done or skipped is a 409, of no slot a 400', async () => {
    const { deps } = fakeCheckInDeps({ now: new Date('2026-11-20T07:30:00Z') })
    const form = await addRoutine(deps, scheduled)
    const skip = { answers: {}, form_id: form.id, scheduled_for: slot, status: 'skipped' as const }
    unwrap(await submitCheckIn(deps, USER, skip))
    expect(await submitCheckIn(deps, USER, skip)).toMatchObject({ ok: false, status: 409 })
    expect(
      await submitCheckIn(deps, USER, { ...skip, scheduled_for: '2026-11-20T07:05:00.000Z' }),
    ).toMatchObject({ ok: false, status: 400 })
  })

  test('an answer to a skipped slot replaces the skip', async () => {
    const { checkIns, deps } = fakeCheckInDeps({ now: new Date('2026-11-20T07:30:00Z') })
    const form = await addRoutine(deps, scheduled)
    const skip = unwrap(
      await submitCheckIn(deps, USER, {
        answers: {},
        form_id: form.id,
        scheduled_for: slot,
        status: 'skipped',
      }),
    )
    const done = unwrap(
      await submitCheckIn(deps, USER, {
        answers: {},
        form_id: form.id,
        scheduled_for: slot,
        use_defaults: true,
      }),
    )
    expect(checkIns.has(skip.id)).toBe(false)
    expect((await listDue(deps, USER)).slots[0]).toMatchObject({ check_in_id: done.id, state: 'done' })
  })

  test('a skipped check-in takes no answers', async () => {
    const { deps } = fakeCheckInDeps({ now: new Date('2026-11-20T07:30:00Z') })
    const form = await addRoutine(deps, scheduled)
    const skip = unwrap(
      await submitCheckIn(deps, USER, {
        answers: {},
        form_id: form.id,
        scheduled_for: slot,
        status: 'skipped',
      }),
    )
    expect(await updateCheckInById(deps, USER, skip.id, { answers: { vitamin_d: 50 } })).toMatchObject({
      ok: false,
      status: 400,
    })
  })
})

describe('the due notification of a routine', () => {
  test('lists the preset items and offers Done and Skip', async () => {
    const { deps, raised, setNow } = fakeCheckInDeps({ now: new Date('2026-11-20T06:00:00Z') })
    await addRoutine(deps, { schedule: { times: ['08:00'] } })
    setNow(new Date('2026-11-20T07:05:00Z'))
    expect(await raiseDueCheckIns(deps, USER)).toBe(1)
    expect(raised[0]).toMatchObject({
      actions: CHECK_IN_DUE_ACTIONS,
      body: 'Vitamin D 50 µg, Magnesium 200 mg, Fish oil',
      title: 'Morning stack',
    })
  })

  test('a form that is not a routine gets neither', async () => {
    const { deps, raised, setNow } = fakeCheckInDeps({ now: new Date('2026-11-20T06:00:00Z') })
    await addRoutine(deps, {
      questions: [{ ...vitaminD, default: undefined }],
      schedule: { times: ['08:00'] },
    })
    setNow(new Date('2026-11-20T07:05:00Z'))
    await raiseDueCheckIns(deps, USER)
    expect(raised[0]!.actions).toBeUndefined()
    expect(raised[0]!.body).toBeUndefined()
  })

  test('a skipped slot raises nothing', async () => {
    const { deps, raised, setNow } = fakeCheckInDeps({ now: new Date('2026-11-20T06:00:00Z') })
    const form = await addRoutine(deps, { schedule: { times: ['08:00'] } })
    setNow(new Date('2026-11-20T07:05:00Z'))
    unwrap(
      await submitCheckIn(deps, USER, {
        answers: {},
        form_id: form.id,
        scheduled_for: '2026-11-20T07:00:00.000Z',
        status: 'skipped',
      }),
    )
    expect(await raiseDueCheckIns(deps, USER)).toBe(0)
    expect(raised).toEqual([])
  })
})

describe('tying a check-in to an activity', () => {
  test('needs a live activity, and the list filters by it', async () => {
    const { activities, deps } = fakeCheckInDeps()
    const form = await addRoutine(deps)
    const other = unwrap(
      await submitCheckIn(deps, USER, { answers: {}, form_id: form.id, use_defaults: true }),
    )
    const entityId = other.activities.vitamin_d!.activity_id
    const tied = unwrap(
      await submitCheckIn(deps, USER, {
        answers: { vitamin_d: 10 },
        entity_id: entityId,
        entity_type: 'activity',
        form_id: form.id,
      }),
    )
    expect(tied).toMatchObject({ entity_id: entityId, entity_type: 'activity' })
    const listed = await queryCheckIns(deps, USER, {
      entity_id: entityId,
      entity_type: 'activity',
      limit: 10,
    })
    expect(listed.check_ins.map((checkIn) => checkIn.id)).toEqual([tied.id])

    activities.get(entityId)!.deleted = true
    expect(
      await submitCheckIn(deps, USER, {
        answers: {},
        entity_id: entityId,
        entity_type: 'activity',
        form_id: form.id,
        use_defaults: true,
      }),
    ).toMatchObject({ ok: false, status: 400 })
    expect(
      await submitCheckIn(deps, USER, {
        answers: {},
        entity_id: MISSING,
        entity_type: 'activity',
        form_id: form.id,
        use_defaults: true,
      }),
    ).toMatchObject({ ok: false, status: 400 })
  })
})

describe('getCheckInAdherence', () => {
  test('counts the slots per day and in total, and how often each item was taken', async () => {
    const { deps, setNow } = fakeCheckInDeps({ now: new Date('2026-11-01T06:00:00Z') })
    const form = await addRoutine(deps, { schedule: { times: ['08:00', '21:00'] } })
    const slot = (iso: string) => ({ answers: {}, form_id: form.id, scheduled_for: iso })
    setNow(new Date('2026-11-04T12:00:00Z'))
    unwrap(await submitCheckIn(deps, USER, { ...slot('2026-11-02T07:00:00.000Z'), use_defaults: true }))
    unwrap(
      await submitCheckIn(deps, USER, {
        ...slot('2026-11-02T20:00:00.000Z'),
        answers: { magnesium: 0, vitamin_d: 50 },
      }),
    )
    unwrap(await submitCheckIn(deps, USER, { ...slot('2026-11-03T07:00:00.000Z'), status: 'skipped' }))
    unwrap(await submitCheckIn(deps, USER, { ...slot('2026-11-04T07:00:00.000Z'), use_defaults: true }))

    const adherence = unwrap(
      await getCheckInAdherence(deps, USER, form.id, { from: '2026-11-01', to: '2026-11-04' }),
    )
    expect(adherence.days).toEqual([
      { date: '2026-11-01', done: 0, missed: 2, skipped: 0, upcoming: 0 },
      { date: '2026-11-02', done: 2, missed: 0, skipped: 0, upcoming: 0 },
      { date: '2026-11-03', done: 0, missed: 1, skipped: 1, upcoming: 0 },
      { date: '2026-11-04', done: 1, missed: 0, skipped: 0, upcoming: 1 },
    ])
    expect(adherence.totals).toEqual({ done: 3, missed: 3, skipped: 1, upcoming: 1 })
    expect(adherence.answered_check_ins).toBe(3)
    expect(adherence.questions).toEqual([
      { answered: 3, key: 'vitamin_d', prompt: 'Vitamin D' },
      { answered: 2, key: 'magnesium', prompt: 'Magnesium' },
      { answered: 2, key: 'fish_oil', prompt: 'Fish oil' },
    ])
  })

  test('a slot before 04:00 belongs to the day before, across the autumn clock change', async () => {
    const { deps, setNow } = fakeCheckInDeps({ now: new Date('2026-10-20T00:00:00Z') })
    const form = await addRoutine(deps, { schedule: { times: ['00:30'] } })
    setNow(new Date('2026-10-27T12:00:00Z'))
    unwrap(
      await submitCheckIn(deps, USER, {
        answered_at: '2026-10-25T23:40:00.000Z',
        answers: {},
        form_id: form.id,
        use_defaults: true,
      }),
    )
    const adherence = unwrap(
      await getCheckInAdherence(deps, USER, form.id, { from: '2026-10-24', to: '2026-10-26' }),
    )
    expect(adherence.days.map((day) => [day.date, day.done, day.missed])).toEqual([
      ['2026-10-24', 0, 1],
      ['2026-10-25', 1, 0],
      ['2026-10-26', 0, 1],
    ])
  })

  test('defaults to the last 30 days, skips slots before the form existed, and checks the window', async () => {
    const { deps, setNow } = fakeCheckInDeps({ now: new Date('2026-11-18T12:00:00Z') })
    const form = await addRoutine(deps, { schedule: { times: ['08:00'] } })
    setNow(new Date('2026-11-20T12:00:00Z'))
    const adherence = unwrap(await getCheckInAdherence(deps, USER, form.id, {}))
    expect([adherence.from, adherence.to, adherence.days.length]).toEqual(['2026-10-22', '2026-11-20', 30])
    expect(adherence.totals).toEqual({ done: 0, missed: 1, skipped: 0, upcoming: 1 })
    expect(
      await getCheckInAdherence(deps, USER, form.id, { from: '2026-11-02', to: '2026-11-01' }),
    ).toMatchObject({ ok: false, status: 400 })
    expect(
      await getCheckInAdherence(deps, USER, form.id, { from: '2025-01-01', to: '2026-11-01' }),
    ).toMatchObject({ ok: false, status: 400 })
    expect(await getCheckInAdherence(deps, USER, MISSING, {})).toMatchObject({ ok: false, status: 404 })
  })

  test('an unscheduled form has no slots but counts its answers', async () => {
    const { deps } = fakeCheckInDeps()
    const form = await addRoutine(deps)
    unwrap(await submitCheckIn(deps, USER, { answers: {}, form_id: form.id, use_defaults: true }))
    const adherence = unwrap(await getCheckInAdherence(deps, USER, form.id, {}))
    expect(adherence.totals).toEqual({ done: 0, missed: 0, skipped: 0, upcoming: 0 })
    expect(adherence.answered_check_ins).toBe(1)
  })
})
