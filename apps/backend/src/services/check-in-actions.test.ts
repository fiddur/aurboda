import type { CheckInQuestion } from '@aurboda/api-spec'

import { addCheckInFormBodySchema } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import type { NotificationRecord } from '../db/index.ts'

import { fakeCheckInDeps } from './__fixtures__/check-in-deps.ts'
import { checkInDueActionHandlers } from './check-in-actions.ts'
import { addCheckInForm, submitCheckIn, updateCheckInFormById } from './check-ins.ts'

const USER = 'alice'
const SLOT = '2026-11-20T07:00:00.000Z'

const vitaminD: CheckInQuestion = {
  default: 50,
  key: 'vitamin_d',
  logs_to: { activity_type: 'supplement', answer_field: 'dose', fields: { substance: 'vitamin D' } },
  prompt: 'Vitamin D',
  required: true,
  type: 'number',
  unit: 'µg',
}

const setup = async () => {
  const fake = fakeCheckInDeps({ now: new Date('2026-11-20T06:00:00Z') })
  const outcome = await addCheckInForm(
    fake.deps,
    USER,
    addCheckInFormBodySchema.parse({
      name: 'Morning stack',
      questions: [vitaminD],
      schedule: { times: ['08:00'] },
    }),
  )
  if (!outcome.ok) throw new Error(outcome.error)
  fake.setNow(new Date('2026-11-20T07:12:00Z'))
  const handlers = checkInDueActionHandlers(fake.deps)
  return { ...fake, form: outcome.value, handlers }
}

const notification = (data: Record<string, unknown>): NotificationRecord => ({
  actions: [
    { key: 'done', label: 'Done' },
    { key: 'skip', label: 'Skip' },
  ],
  body: 'Vitamin D 50 µg',
  created_at: new Date('2026-11-20T07:05:00Z'),
  data,
  dedupe_key: 'check_in:x',
  id: '00000000-0000-4000-8000-0000000000aa',
  in_app: true,
  link: '/check-ins/x',
  push: true,
  read_at: null,
  title: 'Morning stack',
  type: 'check_in_due',
})

const slotNotification = (formId: string) => notification({ form_id: formId, scheduled_for: SLOT })

const onlyCheckIn = (checkIns: ReturnType<typeof fakeCheckInDeps>['checkIns']) => [...checkIns.values()]

describe('check_in_due actions', () => {
  test('done saves the routine as preset for the slot, at the time pressed', async () => {
    const { activities, checkIns, form, handlers } = await setup()
    const result = await handlers.done!(USER, slotNotification(form.id))
    expect(result).toEqual({ ok: true, revision: { body: 'Done at 08:12', title: 'Morning stack' } })
    expect(onlyCheckIn(checkIns)).toMatchObject([
      {
        answered_at: new Date('2026-11-20T07:12:00Z'),
        answers: { vitamin_d: 50 },
        scheduled_for: new Date(SLOT),
        status: 'answered',
      },
    ])
    expect(activities.size).toBe(1)
  })

  test('two Done presses at once save once; the other is a conflict', async () => {
    const { activities, checkIns, form, handlers } = await setup()
    const results = await Promise.all([
      handlers.done!(USER, slotNotification(form.id)),
      handlers.done!(USER, slotNotification(form.id)),
      handlers.skip!(USER, slotNotification(form.id)),
    ])
    expect(results.map((result) => result.ok)).toEqual([true, false, false])
    expect(results[1]).toMatchObject({ message: 'This slot is already done' })
    expect(onlyCheckIn(checkIns)).toHaveLength(1)
    expect(activities.size).toBe(1)
  })

  test('skip records the slot as skipped', async () => {
    const { checkIns, form, handlers } = await setup()
    expect(await handlers.skip!(USER, slotNotification(form.id))).toEqual({
      ok: true,
      revision: { body: 'Skipped', title: 'Morning stack' },
    })
    expect(onlyCheckIn(checkIns)).toMatchObject([{ answers: {}, status: 'skipped' }])
  })

  test.each([
    ['done', 'already done', 'Already done'],
    ['skipped', 'already skipped', 'Already skipped'],
  ] as const)('a slot %s answers a conflict to both actions', async (state, message, body) => {
    const { deps, form, handlers } = await setup()
    await submitCheckIn(deps, USER, {
      answers: {},
      form_id: form.id,
      scheduled_for: SLOT,
      ...(state === 'done' ? { use_defaults: true } : { status: 'skipped' as const }),
    })
    for (const key of ['done', 'skip']) {
      expect(await handlers[key]!(USER, slotNotification(form.id))).toEqual({
        message: `This slot is ${message}`,
        ok: false,
        revision: { body, title: 'Morning stack' },
      })
    }
  })

  test('done on a form that is no longer a routine is a conflict; skip still works', async () => {
    const { checkIns, deps, form, handlers } = await setup()
    await updateCheckInFormById(deps, USER, form.id, { questions: [{ ...vitaminD, default: undefined }] })
    expect(await handlers.done!(USER, slotNotification(form.id))).toMatchObject({
      message: expect.stringContaining('no longer a routine'),
      ok: false,
    })
    expect(checkIns.size).toBe(0)
    expect((await handlers.skip!(USER, slotNotification(form.id))).ok).toBe(true)
  })

  test('a deleted form, a slot no longer scheduled, or no slot in the data are conflicts', async () => {
    const { form, forms, handlers } = await setup()
    const noData = await handlers.done!(USER, notification({}))
    expect(noData.ok).toBe(false)
    const moved = await handlers.done!(
      USER,
      notification({ form_id: form.id, scheduled_for: '2026-11-20T07:05:00.000Z' }),
    )
    expect(moved).toMatchObject({ message: 'This slot is no longer in the schedule', ok: false })
    forms.set(form.id, { ...forms.get(form.id)!, deleted_at: new Date() })
    expect(await handlers.skip!(USER, slotNotification(form.id))).toMatchObject({
      message: 'The check-in form was deleted',
      ok: false,
    })
  })
})
