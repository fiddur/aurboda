import express from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import type { RouteOps } from '../services/routes.ts'

import { createRoutesRouter } from './routes-router.ts'

const ROUTE_ID = '6f1c3b2a-4d5e-4f60-8a7b-9c0d1e2f3a4b'
const OTHER_ID = '2f1c8a34-1f4e-4a2f-9d7c-6b1e5a0c3d21'

const route = {
  activity_count: 3,
  activity_type: 'running',
  canonical_activity_id: null,
  created_at: '2026-06-01T07:00:00.000Z',
  end: { lat: 59.31, lon: 18.08 },
  id: ROUTE_ID,
  last_activity_at: '2026-06-08T07:00:00.000Z',
  length_m: 2000,
  name: 'Route · 2.0 km',
  start: { lat: 59.3, lon: 18.07 },
  updated_at: '2026-06-01T07:00:00.000Z',
}

const buildApp = (overrides: Partial<RouteOps> = {}) => {
  const ops: RouteOps = {
    detail: vi.fn(async () => ({ ...route, efforts: [], points: [] })),
    list: vi.fn(async () => [route]),
    match: vi.fn(async () => ({ created: 1, matched: 2 })),
    merge: vi.fn(async () => ({ moved: 4, route })),
    remove: vi.fn(async () => true),
    rename: vi.fn(async (_u: string, _id: string, name: string) => ({ ...route, name })),
    ...overrides,
  }
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use('/routes', createRoutesRouter(auth, ops) as unknown as express.RequestHandler)
  return { app, ops }
}

describe('routes router', () => {
  test('GET / lists the routes', async () => {
    const { app, ops } = buildApp()
    const res = await supertest(app).get('/routes')
    expect(res.body).toEqual({ data: [route], success: true })
    expect(ops.list).toHaveBeenCalledWith('tester')
  })

  test('GET /:id returns the detail, 404s for an unknown or malformed id', async () => {
    const { app } = buildApp()
    const res = await supertest(app).get(`/routes/${ROUTE_ID}`)
    expect(res.body.data).toMatchObject({ efforts: [], id: ROUTE_ID, points: [] })

    const missing = buildApp({ detail: vi.fn(async () => null) })
    expect((await supertest(missing.app).get(`/routes/${OTHER_ID}`)).status).toBe(404)

    const malformed = buildApp()
    expect((await supertest(malformed.app).get('/routes/not-a-uuid')).status).toBe(404)
    expect(malformed.ops.detail).not.toHaveBeenCalled()
  })

  test('PATCH /:id renames, and validates the name', async () => {
    const { app, ops } = buildApp()
    const res = await supertest(app).patch(`/routes/${ROUTE_ID}`).send({ name: ' Hill loop ' })
    expect(res.body.data.name).toBe('Hill loop')
    expect(ops.rename).toHaveBeenCalledWith('tester', ROUTE_ID, 'Hill loop')

    expect((await supertest(app).patch(`/routes/${ROUTE_ID}`).send({ name: '' })).status).toBe(400)
  })

  test('DELETE /:id deletes, 404 when missing', async () => {
    const { app } = buildApp()
    expect((await supertest(app).delete(`/routes/${ROUTE_ID}`)).body).toEqual({ success: true })

    const missing = buildApp({ remove: vi.fn(async () => false) })
    expect((await supertest(missing.app).delete(`/routes/${ROUTE_ID}`)).status).toBe(404)
  })

  test('POST /:id/merge merges the source into the target', async () => {
    const { app, ops } = buildApp()
    const res = await supertest(app).post(`/routes/${ROUTE_ID}/merge`).send({ source_route_id: OTHER_ID })
    expect(res.body).toEqual({ data: { moved: 4, route }, success: true })
    expect(ops.merge).toHaveBeenCalledWith('tester', ROUTE_ID, OTHER_ID)

    const missing = buildApp({ merge: vi.fn(async () => null) })
    const notFound = await supertest(missing.app)
      .post(`/routes/${ROUTE_ID}/merge`)
      .send({ source_route_id: OTHER_ID })
    expect(notFound.status).toBe(404)
  })

  test('POST /match runs the matching pass', async () => {
    const { app, ops } = buildApp()
    const res = await supertest(app).post('/routes/match')
    expect(res.body).toEqual({ data: { created: 1, matched: 2 }, success: true })
    expect(ops.match).toHaveBeenCalledWith('tester')
  })
})
