import express from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import type { SegmentOps } from '../services/segments.ts'
import type { SuggestedSegmentOps } from '../services/suggested-segments.ts'

import { createSegmentsRouter } from './segments-router.ts'

const SEGMENT_ID = '6f1c3b2a-4d5e-4f60-8a7b-9c0d1e2f3a4b'
const ACTIVITY_ID = '2f1c8a34-1f4e-4a2f-9d7c-6b1e5a0c3d21'

const segment = {
  activity_type: 'running',
  best_elapsed_s: 125,
  created_at: '2026-06-01T07:00:00.000Z',
  effort_count: 3,
  id: SEGMENT_ID,
  last_effort_at: '2026-06-08T07:00:00.000Z',
  length_m: 800,
  name: 'Hammarbybacken · 0.8 km',
  updated_at: '2026-06-01T07:00:00.000Z',
}

const detail = {
  ...segment,
  created_from_activity_id: ACTIVITY_ID,
  created_from_route_id: null,
  efforts: [],
  near_named_location: { end: null, start: null },
  points: [],
}

const SUGGESTION_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

const suggestion = {
  activity_count: 4,
  activity_type: 'running',
  created_at: '2026-06-01T07:00:00.000Z',
  id: SUGGESTION_ID,
  length_m: 1200,
  near_name: null,
  points: [],
  source_activity_id: ACTIVITY_ID,
}

const buildApp = (
  overrides: Partial<SegmentOps> = {},
  suggestedOverrides: Partial<SuggestedSegmentOps> = {},
) => {
  const ops: SegmentOps = {
    create: vi.fn(async () => ({ ok: true as const, segment: detail })),
    detail: vi.fn(async () => detail),
    list: vi.fn(async () => [segment]),
    match: vi.fn(async () => ({ activities: 2, efforts: 3 })),
    remove: vi.fn(async () => true),
    rename: vi.fn(async (_u: string, _id: string, name: string) => ({ ...segment, name })),
    ...overrides,
  }
  const suggestedOps: SuggestedSegmentOps = {
    dismiss: vi.fn(async () => true),
    list: vi.fn(async () => [suggestion]),
    promote: vi.fn(async () => ({ ok: true as const, segment: detail })),
    scan: vi.fn(async () => ({ remaining: 0, scanned: 3, suggested: 1 })),
    ...suggestedOverrides,
  }
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use('/segments', createSegmentsRouter(auth, ops, suggestedOps) as unknown as express.RequestHandler)
  return { app, ops, suggestedOps }
}

describe('segments router', () => {
  test('GET / lists the segments with the type filter and sort order, and rejects an unknown sort', async () => {
    const { app, ops } = buildApp()
    expect((await supertest(app).get('/segments')).body).toEqual({ data: [segment], success: true })
    expect(ops.list).toHaveBeenCalledWith('tester', { sort: 'last_effort' })

    await supertest(app).get('/segments?activity_type=running&sort=efforts')
    expect(ops.list).toHaveBeenLastCalledWith('tester', { activity_type: 'running', sort: 'efforts' })

    const bad = buildApp()
    expect((await supertest(bad.app).get('/segments?sort=fastest')).status).toBe(400)
    expect(bad.ops.list).not.toHaveBeenCalled()
  })

  test('POST / creates from an activity or a route', async () => {
    const { app, ops } = buildApp()
    const body = { activity_id: ACTIVITY_ID, end_offset_s: 300, start_offset_s: 120 }
    const res = await supertest(app).post('/segments').send(body)
    expect(res.body).toEqual({ data: detail, success: true })
    expect(ops.create).toHaveBeenCalledWith('tester', body)

    const fromRoute = await supertest(app)
      .post('/segments')
      .send({ end_km: 4.5, name: 'Climb', route_id: SEGMENT_ID, start_km: 2 })
    expect(fromRoute.status).toBe(200)
  })

  test('POST / rejects a body that is neither or both, incomplete, or reversed', async () => {
    const { app, ops } = buildApp()
    const bodies = [
      {},
      {
        activity_id: ACTIVITY_ID,
        end_offset_s: 300,
        end_km: 2,
        route_id: SEGMENT_ID,
        start_km: 1,
        start_offset_s: 1,
      },
      { activity_id: ACTIVITY_ID, start_offset_s: 1 },
      { end_km: 1, route_id: SEGMENT_ID, start_km: 2 },
    ]
    for (const body of bodies) expect((await supertest(app).post('/segments').send(body)).status).toBe(400)
    expect(ops.create).not.toHaveBeenCalled()
  })

  test('POST / answers a refused cut with 400 and its message', async () => {
    const { app } = buildApp({
      create: vi.fn(async () => ({
        error: 'A segment must be at least 100 m long (this one is 80 m)',
        ok: false as const,
      })),
    })
    const res = await supertest(app)
      .post('/segments')
      .send({ activity_id: ACTIVITY_ID, end_offset_s: 30, start_offset_s: 10 })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({
      error: 'A segment must be at least 100 m long (this one is 80 m)',
      success: false,
    })
  })

  test('GET /:id returns the detail, 404s for an unknown or malformed id', async () => {
    const { app } = buildApp()
    expect((await supertest(app).get(`/segments/${SEGMENT_ID}`)).body.data).toEqual(detail)

    const missing = buildApp({ detail: vi.fn(async () => null) })
    expect((await supertest(missing.app).get(`/segments/${SEGMENT_ID}`)).status).toBe(404)

    const malformed = buildApp()
    expect((await supertest(malformed.app).get('/segments/not-a-uuid')).status).toBe(404)
    expect(malformed.ops.detail).not.toHaveBeenCalled()
  })

  test('PATCH /:id renames, and validates the name', async () => {
    const { app, ops } = buildApp()
    const res = await supertest(app).patch(`/segments/${SEGMENT_ID}`).send({ name: ' The hill ' })
    expect(res.body.data.name).toBe('The hill')
    expect(ops.rename).toHaveBeenCalledWith('tester', SEGMENT_ID, 'The hill')
    expect((await supertest(app).patch(`/segments/${SEGMENT_ID}`).send({ name: '' })).status).toBe(400)
  })

  test('DELETE /:id deletes, 404 when missing', async () => {
    const { app } = buildApp()
    expect((await supertest(app).delete(`/segments/${SEGMENT_ID}`)).body).toEqual({ success: true })

    const missing = buildApp({ remove: vi.fn(async () => false) })
    expect((await supertest(missing.app).delete(`/segments/${SEGMENT_ID}`)).status).toBe(404)
  })

  test('POST /:id/match re-times the segment, 404 when missing', async () => {
    const { app, ops } = buildApp()
    const res = await supertest(app).post(`/segments/${SEGMENT_ID}/match`)
    expect(res.body).toEqual({ data: { activities: 2, efforts: 3 }, success: true })
    expect(ops.match).toHaveBeenCalledWith('tester', SEGMENT_ID)

    const missing = buildApp({ match: vi.fn(async () => null) })
    expect((await supertest(missing.app).post(`/segments/${SEGMENT_ID}/match`)).status).toBe(404)
  })

  test('GET /suggested lists the pending suggestions (not taken for a segment id)', async () => {
    const { app, ops, suggestedOps } = buildApp()
    expect((await supertest(app).get('/segments/suggested')).body).toEqual({
      data: [suggestion],
      success: true,
    })
    expect(suggestedOps.list).toHaveBeenCalledWith('tester')
    expect(ops.detail).not.toHaveBeenCalled()
  })

  test('POST /suggested/scan runs one scan', async () => {
    const { app, suggestedOps } = buildApp()
    const res = await supertest(app).post('/segments/suggested/scan')
    expect(res.body).toEqual({ data: { remaining: 0, scanned: 3, suggested: 1 }, success: true })
    expect(suggestedOps.scan).toHaveBeenCalledWith('tester')
  })

  test('POST /suggested/:id/promote adds it, validates the trim, 400 with the sentence, 404', async () => {
    const { app, suggestedOps } = buildApp()
    const body = { end_km: 0.9, name: 'Hill', start_km: 0.1 }
    const res = await supertest(app).post(`/segments/suggested/${SUGGESTION_ID}/promote`).send(body)
    expect(res.body).toEqual({ data: detail, success: true })
    expect(suggestedOps.promote).toHaveBeenCalledWith('tester', SUGGESTION_ID, body)
    expect((await supertest(app).post(`/segments/suggested/${SUGGESTION_ID}/promote`).send({})).status).toBe(
      200,
    )

    for (const bad of [{ start_km: 0.1 }, { end_km: 0.1, start_km: 0.5 }]) {
      expect(
        (await supertest(app).post(`/segments/suggested/${SUGGESTION_ID}/promote`).send(bad)).status,
      ).toBe(400)
    }

    const refused = buildApp(
      {},
      {
        promote: vi.fn(async () => ({ error: 'A segment must be at least 100 m long', ok: false as const })),
      },
    )
    const r = await supertest(refused.app).post(`/segments/suggested/${SUGGESTION_ID}/promote`).send({})
    expect(r.status).toBe(400)
    expect(r.body).toEqual({ error: 'A segment must be at least 100 m long', success: false })

    const missing = buildApp({}, { promote: vi.fn(async () => null) })
    expect(
      (await supertest(missing.app).post(`/segments/suggested/${SUGGESTION_ID}/promote`).send({})).status,
    ).toBe(404)
    expect((await supertest(app).post('/segments/suggested/nope/promote').send({})).status).toBe(404)
  })

  test('POST /suggested/:id/dismiss dismisses, 404 when not pending', async () => {
    const { app, suggestedOps } = buildApp()
    expect((await supertest(app).post(`/segments/suggested/${SUGGESTION_ID}/dismiss`)).body).toEqual({
      success: true,
    })
    expect(suggestedOps.dismiss).toHaveBeenCalledWith('tester', SUGGESTION_ID)
    const missing = buildApp({}, { dismiss: vi.fn(async () => false) })
    expect((await supertest(missing.app).post(`/segments/suggested/${SUGGESTION_ID}/dismiss`)).status).toBe(
      404,
    )
  })
})
