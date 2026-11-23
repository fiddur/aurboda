import express from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import type { StrengthPlanRecord, StrengthPlanSessionRecord } from '../db/index.ts'

import { loadExerciseCatalog } from '../services/exercise-catalog.ts'
import { createStrengthPlansService, type StrengthPlanStore } from '../services/strength-plans.ts'
import { createStrengthPlansRouter } from './strength-plans-router.ts'

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

const memoryStore = () => {
  const plans = new Map<string, StrengthPlanRecord>()
  const sessions: (StrengthPlanSessionRecord & { plan_id: string })[] = []
  let n = 0
  const store: StrengthPlanStore = {
    create: async (_user, input) => {
      n += 1
      const at = new Date(Date.UTC(2026, 10, 1, 10, n))
      const record = {
        ...input,
        created_at: at,
        id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        updated_at: at,
      }
      plans.set(record.id, record)
      return record
    },
    delete: async (_user, id) => plans.delete(id),
    get: async (_user, id) => plans.get(id) ?? null,
    list: async () => [...plans.values()],
    sessions: async (_user, ids) => {
      const byPlan = new Map<string, StrengthPlanSessionRecord[]>()
      for (const { plan_id, ...s } of sessions.toSorted(
        (a, b) => b.start_time.getTime() - a.start_time.getTime(),
      )) {
        if (ids && !ids.includes(plan_id)) continue
        byPlan.set(plan_id, [...(byPlan.get(plan_id) ?? []), s])
      }
      return byPlan
    },
    update: async (_user, id, patch) => {
      const existing = plans.get(id)
      if (!existing) return null
      const record = { ...existing, ...patch }
      plans.set(id, record)
      return record
    },
  }
  return { sessions, store }
}

const buildApp = () => {
  const memory = memoryStore()
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'alice'
    next()
  }
  app.use(
    '/strength-plans',
    createStrengthPlansRouter(
      auth,
      createStrengthPlansService(memory.store, loadExerciseCatalog, async () => undefined),
    ) as unknown as express.RequestHandler,
  )
  return { request: supertest(app), sessions: memory.sessions }
}

const sets = [
  { exercise: 'Bench Press', exercise_key: 'barbell_bench_press', reps: 8, weight: 60 },
  { exercise: 'Plank', time: 45 },
]

describe('strength plans router', () => {
  test('creates a plan with 201 and reads it back', async () => {
    const { request } = buildApp()
    const created = await request
      .post('/strength-plans')
      .send({ name: '  Push day ', note: 'Go heavy', planned_for: '2026-11-19', sets })
    expect(created.status).toBe(201)
    expect(created.body.data).toMatchObject({
      name: 'Push day',
      note: 'Go heavy',
      planned_for: '2026-11-19',
      muscle_groups: ['shoulders', 'chest', 'triceps'],
      sessions: [],
      sets,
    })

    const fetched = await request.get(`/strength-plans/${created.body.data.id}`)
    expect(fetched.status).toBe(200)
    expect(fetched.body).toEqual({ data: created.body.data, success: true })
  })

  test('a routine is created without a day or note', async () => {
    const { request } = buildApp()
    const created = await request.post('/strength-plans').send({ name: 'Full body', sets })
    expect(created.body.data).toMatchObject({ note: null, planned_for: null })
  })

  test('refuses an unknown exercise key, naming the set', async () => {
    const { request } = buildApp()
    const res = await request
      .post('/strength-plans')
      .send({ name: 'X', sets: [{ exercise: 'A' }, { exercise: 'B', exercise_key: 'nope' }] })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({
      error: 'sets[1].exercise_key: unknown exercise catalogue key "nope"',
      success: false,
    })
  })

  test('refuses empty sets and a malformed day', async () => {
    const { request } = buildApp()
    expect((await request.post('/strength-plans').send({ name: 'X', sets: [] })).status).toBe(400)
    expect(
      (await request.post('/strength-plans').send({ name: 'X', planned_for: '2026-13-01', sets })).status,
    ).toBe(400)
  })

  test('lists open plans by default and every plan with status all, in order', async () => {
    const { request, sessions } = buildApp()
    const post = async (body: object) =>
      (await request.post('/strength-plans').send({ sets, ...body })).body.data.id
    const routineB = await post({ name: 'beta' })
    const later = await post({ name: 'Later', planned_for: '2026-11-20' })
    const done = await post({ name: 'Done', planned_for: '2026-11-10' })
    const routineA = await post({ name: 'Alpha' })
    sessions.push({ activity_id: 'a1', plan_id: done, start_time: new Date('2026-11-10T08:00:00Z') })
    sessions.push({ activity_id: 'a2', plan_id: routineB, start_time: new Date('2026-11-11T08:00:00Z') })

    const open = await request.get('/strength-plans')
    expect(open.status).toBe(200)
    expect(open.body.data.map((p: { id: string }) => p.id)).toEqual([later, routineA, routineB])

    const all = await request.get('/strength-plans?status=all')
    expect(all.body.data.map((p: { id: string }) => p.id)).toEqual([done, later, routineA, routineB])
    expect(all.body.data[0].sessions).toEqual([{ activity_id: 'a1', start_time: '2026-11-10T08:00:00.000Z' }])

    expect((await request.get('/strength-plans?status=nope')).status).toBe(400)
  })

  test('patches the given fields, clears with null, replaces the sets', async () => {
    const { request } = buildApp()
    const id = (
      await request
        .post('/strength-plans')
        .send({ name: 'Push', note: 'Heavy', planned_for: '2026-11-19', sets })
    ).body.data.id

    const renamed = await request.patch(`/strength-plans/${id}`).send({ name: 'Push 2' })
    expect(renamed.status).toBe(200)
    expect(renamed.body.data).toMatchObject({
      name: 'Push 2',
      note: 'Heavy',
      planned_for: '2026-11-19',
      sets,
    })

    const cleared = await request
      .patch(`/strength-plans/${id}`)
      .send({ note: null, planned_for: null, sets: [{ exercise: 'Squat', reps: 5 }] })
    expect(cleared.body.data).toMatchObject({
      note: null,
      planned_for: null,
      sets: [{ exercise: 'Squat', reps: 5 }],
    })
  })

  test('patch errors: empty body, unknown key, empty sets, missing plan', async () => {
    const { request } = buildApp()
    const id = (await request.post('/strength-plans').send({ name: 'Push', sets })).body.data.id

    const empty = await request.patch(`/strength-plans/${id}`).send({})
    expect(empty.status).toBe(400)
    expect(empty.body).toEqual({ error: 'Nothing to update', success: false })

    const unknown = await request
      .patch(`/strength-plans/${id}`)
      .send({ sets: [{ exercise: 'A', exercise_key: 'nope' }] })
    expect(unknown.status).toBe(400)
    expect(unknown.body.error).toBe('sets[0].exercise_key: unknown exercise catalogue key "nope"')

    expect((await request.patch(`/strength-plans/${id}`).send({ sets: [] })).status).toBe(400)

    for (const missing of [MISSING_ID, 'not-a-uuid']) {
      const res = await request.patch(`/strength-plans/${missing}`).send({ name: 'X' })
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Plan not found', success: false })
    }
  })

  test('get and delete answer 404 for a missing plan or an id that is no UUID', async () => {
    const { request } = buildApp()
    for (const missing of [MISSING_ID, 'not-a-uuid']) {
      const got = await request.get(`/strength-plans/${missing}`)
      expect(got.status).toBe(404)
      expect(got.body).toEqual({ error: 'Plan not found', success: false })
      expect((await request.delete(`/strength-plans/${missing}`)).status).toBe(404)
    }
  })

  test('deletes a plan', async () => {
    const { request } = buildApp()
    const id = (await request.post('/strength-plans').send({ name: 'Push', sets })).body.data.id
    const res = await request.delete(`/strength-plans/${id}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect((await request.get(`/strength-plans/${id}`)).status).toBe(404)
  })
})
