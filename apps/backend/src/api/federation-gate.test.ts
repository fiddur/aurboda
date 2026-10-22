import { integrateFederation } from '@fedify/express'
import express, { json, type RequestHandler } from 'express'
import request from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import { gateFederation, isFederationRequest } from './federation-gate.ts'

describe('isFederationRequest', () => {
  test.each([
    '/inbox',
    '/users/alice',
    '/users/alice/inbox',
    '/users/alice/outbox',
    '/users/alice/followers',
    '/users/alice/following',
    '/users/alice/feed/abc-123',
    '/.well-known/webfinger',
    '/.well-known/nodeinfo',
    '/nodeinfo/2.1',
  ])('owns %s', (path) => {
    expect(isFederationRequest(path)).toBe(true)
  })

  test.each([
    '/sync/StepsRecord',
    '/sync/HeartRateRecord',
    '/sync/daily-aggregates',
    '/activities',
    '/mcp',
    '/login',
    '/u/alice', // SPA profile page — must NOT be captured (federation uses /users/)
    '/.well-known/assetlinks.json',
    '/.well-known/aurboda',
  ])('skips %s', (path) => {
    expect(isFederationRequest(path)).toBe(false)
  })
})

describe('gateFederation', () => {
  test('runs the wrapped middleware for a federation path', () => {
    const inner = vi.fn<RequestHandler>((_req, _res, next) => next())
    const next = vi.fn()
    gateFederation(inner)({ path: '/users/alice' } as never, {} as never, next)
    expect(inner).toHaveBeenCalledOnce()
  })

  test('skips the wrapped middleware for a non-federation path', () => {
    const inner = vi.fn<RequestHandler>((_req, _res, next) => next())
    const next = vi.fn()
    gateFederation(inner)({ path: '/sync/StepsRecord' } as never, {} as never, next)
    expect(inner).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledOnce()
  })
})

/**
 * Regression for the Health Connect sync hang: `integrateFederation` wraps
 * every non-GET body with `Readable.toWeb(req)`, so mounting it before
 * `express.json()` used to stall the body parser on any large non-federation
 * POST (>~64 KB — the socket buffer). Exercise the REAL `@fedify/express`
 * middleware in the production order; without the gate the large POST hangs and
 * this test times out.
 */
describe('federation middleware ordering (real @fedify/express)', () => {
  // Minimal stand-in for the Federation object: `integrateFederation` calls
  // `federation.fetch(request, { onNotFound, ... })`. Handle the inbox, treat
  // everything else as not-found (→ next()), mirroring the real dispatch.
  const fakeFederation = {
    fetch: async (req: Request, { onNotFound }: { onNotFound: () => Response }) => {
      if (new URL(req.url).pathname === '/inbox') return new Response('accepted', { status: 202 })
      return onNotFound()
    },
  }

  const buildApp = () => {
    const app = express()
    app.use(gateFederation(integrateFederation(fakeFederation as never, () => undefined)))
    app.use(json({ limit: '10mb' }))
    app.post('/sync/:recordType', (req, res) => {
      res.json({ count: Array.isArray(req.body?.data) ? req.body.data.length : 0, success: true })
    })
    return app
  }

  const bigBatch = (n: number) => ({
    data: Array.from({ length: n }, (_, i) => ({
      count: i,
      startTime: '2026-07-03T10:00:00Z',
      endTime: '2026-07-03T10:01:00Z',
      metadata: { id: `rec-${i}`, dataOrigin: { packageName: 'net.aurboda' } },
    })),
  })

  test('parses a small non-federation POST body', async () => {
    const res = await request(buildApp()).post('/sync/StepsRecord').send(bigBatch(5))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ count: 5, success: true })
  })

  test('parses a large (>64 KB) non-federation POST body without hanging', async () => {
    const batch = bigBatch(2000)
    expect(JSON.stringify(batch).length).toBeGreaterThan(64 * 1024)
    const res = await request(buildApp()).post('/sync/StepsRecord').send(batch)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ count: 2000, success: true })
  }, 15_000)

  test('still routes a federation inbox POST to Fedify (raw body preserved)', async () => {
    const res = await request(buildApp())
      .post('/inbox')
      .set('content-type', 'application/activity+json')
      .send({ type: 'Follow' })
    expect(res.status).toBe(202)
  })
})
