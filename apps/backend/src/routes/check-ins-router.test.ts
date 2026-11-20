import type { RequestHandler } from 'express'

import express from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import { fakeCheckInDeps } from '../services/__fixtures__/check-in-deps.ts'
import { createCheckInsRouter } from './check-ins-router.ts'

const MISSING = '99999999-9999-4999-8999-999999999999'

const auth: RequestHandler = (req, _res, next) => {
  req.user = 'tester'
  next()
}

const setup = () => {
  const fake = fakeCheckInDeps({ now: new Date('2026-11-20T07:10:00Z') })
  const server = express()
  server.use(express.json())
  server.use(createCheckInsRouter(auth, fake.deps))
  return { ...fake, api: supertest(server) }
}

const form = {
  name: 'Morning',
  questions: [
    {
      key: 'rested',
      logs_to: { metric: 'rested' },
      max: 5,
      min: 1,
      prompt: 'Rested?',
      required: true,
      type: 'scale',
    },
  ],
  schedule: { times: ['08:00'] },
}

describe('check-in forms', () => {
  test('create, list, get, update, delete and restore', async () => {
    const { api } = setup()
    const created = await api.post('/check-in-forms').send(form)
    expect(created.status).toBe(200)
    const id = created.body.form.id
    expect(created.body.form).toMatchObject({
      name: 'Morning',
      schedule: { day_starts_at: '04:00' },
      version: 1,
    })

    expect((await api.get('/check-in-forms')).body.forms).toHaveLength(1)
    expect((await api.get(`/check-in-forms/${id}`)).body.form.id).toBe(id)
    expect((await api.get(`/check-in-forms/${MISSING}`)).status).toBe(404)

    const patched = await api
      .patch(`/check-in-forms/${id}`)
      .send({ questions: [{ ...form.questions[0], prompt: 'How rested?' }] })
    expect(patched.body.form.version).toBe(2)

    expect((await api.delete(`/check-in-forms/${id}`)).body.form.deleted_at).not.toBeNull()
    expect((await api.get('/check-in-forms')).body.forms).toEqual([])
    expect((await api.get('/check-in-forms?deleted=true')).body.forms).toHaveLength(1)
    expect((await api.delete(`/check-in-forms/${id}`)).status).toBe(404)
    expect((await api.post(`/check-in-forms/${id}/restore`)).body.form.deleted_at).toBeNull()
    expect((await api.post(`/check-in-forms/${id}/restore`)).status).toBe(404)
  })

  test('400 for an invalid body or an unknown template', async () => {
    const { api } = setup()
    expect((await api.post('/check-in-forms').send({ name: 'No questions' })).status).toBe(400)
    const unknown = await api.post('/check-in-forms').send({ template: 'nope' })
    expect(unknown.status).toBe(400)
    expect(unknown.body.error).toContain('nope')
    expect((await api.patch(`/check-in-forms/${MISSING}`).send({ name: 'X' })).status).toBe(404)
  })

  test('templates are listed and copied', async () => {
    const { api } = setup()
    const templates = await api.get('/check-in-templates')
    expect(templates.body.templates.map((t: { id: string }) => t.id)).toEqual([
      'morning',
      'mood_energy',
      'morning_supplements',
    ])
    const copied = await api.post('/check-in-forms').send({ template: 'mood_energy' })
    expect(copied.body.form.name).toBe('Mood and energy')
  })
})

describe('check-ins', () => {
  test('submit, list, edit, delete and restore', async () => {
    const { api, points } = setup()
    const id = (await api.post('/check-in-forms').send(form)).body.form.id
    const submitted = await api.post('/check-ins').send({ answers: { rested: 4 }, form_id: id })
    expect(submitted.status).toBe(200)
    const checkIn = submitted.body.check_in
    expect(checkIn).toMatchObject({ form_name: 'Morning', logged: { rested: { metric: 'rested' } } })
    expect(points).toHaveLength(1)

    const listed = await api.get(`/check-ins?form_id=${id}&limit=10`)
    expect(listed.body).toMatchObject({ next_cursor: null, success: true })
    expect(listed.body.check_ins).toHaveLength(1)

    expect((await api.patch(`/check-ins/${checkIn.id}`).send({ answers: { rested: 9 } })).status).toBe(400)
    expect((await api.patch(`/check-ins/${checkIn.id}`).send({ note: 'ok' })).body.check_in.note).toBe('ok')
    expect((await api.delete(`/check-ins/${checkIn.id}`)).body.check_in.deleted_at).not.toBeNull()
    expect(points).toEqual([])
    expect((await api.post(`/check-ins/${checkIn.id}/restore`)).body.check_in.deleted_at).toBeNull()
    expect(points).toHaveLength(1)
    expect((await api.delete(`/check-ins/${MISSING}`)).status).toBe(404)
  })

  test('400 for a bad body, 404 for an unknown form', async () => {
    const { api } = setup()
    expect((await api.post('/check-ins').send({ form_id: 'nope' })).status).toBe(400)
    expect((await api.post('/check-ins').send({ form_id: MISSING })).status).toBe(404)
  })
})

describe('GET /due', () => {
  test("lists today's slots, and a date", async () => {
    const { api } = setup()
    await api.post('/check-in-forms').send(form)
    const due = await api.get('/due')
    expect(due.body).toMatchObject({ success: true, timezone: 'Europe/Stockholm' })
    expect(due.body.slots.map((s: { state: string; time: string }) => [s.time, s.state])).toEqual([
      ['08:00', 'due'],
    ])
    expect((await api.get('/due?date=2026-11-19')).body.slots[0].state).toBe('missed')
    expect((await api.get('/due?date=yesterday')).status).toBe(400)
  })
})

describe('routines', () => {
  const routine = {
    name: 'Morning stack',
    questions: [
      {
        default: 50,
        key: 'vitamin_d',
        logs_to: { activity_type: 'supplement', answer_field: 'dose', fields: { substance: 'vitamin D' } },
        prompt: 'Vitamin D',
        required: true,
        type: 'number',
        unit: 'µg',
      },
    ],
    schedule: { times: ['08:00'] },
  }

  test('use_defaults, skipping with its 409, and the adherence', async () => {
    const { activities, api } = setup()
    const created = (await api.post('/check-in-forms').send(routine)).body.form
    expect(created.is_routine).toBe(true)
    const done = await api.post('/check-ins').send({ form_id: created.id, use_defaults: true })
    expect(done.body.check_in.answers).toEqual({ vitamin_d: 50 })
    expect(Object.keys(done.body.check_in.activities)).toEqual(['vitamin_d'])
    expect(activities.size).toBe(1)

    const slot = '2026-11-19T07:00:00.000Z'
    const skip = { form_id: created.id, scheduled_for: slot, status: 'skipped' }
    expect((await api.post('/check-ins').send({ form_id: created.id, status: 'skipped' })).status).toBe(400)
    expect((await api.post('/check-ins').send(skip)).body.check_in.status).toBe('skipped')
    const again = await api.post('/check-ins').send(skip)
    expect(again.status).toBe(409)
    expect(again.body).toMatchObject({ error: 'This slot is already skipped', success: false })

    const adherence = await api.get(`/check-in-forms/${created.id}/adherence?from=2026-11-19&to=2026-11-20`)
    expect(adherence.status).toBe(200)
    expect(adherence.body.adherence.totals).toEqual({ done: 1, missed: 0, skipped: 1, upcoming: 0 })
    expect(
      (await api.get(`/check-in-forms/${created.id}/adherence?from=2026-11-21&to=2026-11-20`)).status,
    ).toBe(400)
    expect((await api.get(`/check-in-forms/${created.id}/adherence?from=nope`)).status).toBe(400)
    expect((await api.get(`/check-in-forms/${MISSING}/adherence`)).status).toBe(404)
  })

  test('check-ins tied to an activity', async () => {
    const { api } = setup()
    const created = (await api.post('/check-in-forms').send(routine)).body.form
    const done = (await api.post('/check-ins').send({ form_id: created.id, use_defaults: true })).body
      .check_in
    const activityId = done.activities.vitamin_d.activity_id
    const tied = await api
      .post('/check-ins')
      .send({ entity_id: activityId, entity_type: 'activity', form_id: created.id, use_defaults: true })
    expect(tied.body.check_in).toMatchObject({ entity_id: activityId, entity_type: 'activity' })
    const listed = await api.get(`/check-ins?entity_type=activity&entity_id=${activityId}`)
    expect(listed.body.check_ins.map((c: { id: string }) => c.id)).toEqual([tied.body.check_in.id])
    expect((await api.get(`/check-ins?entity_id=${activityId}`)).status).toBe(400)
  })
})
