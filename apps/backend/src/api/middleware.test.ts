/**
 * What the auth middleware does on the way through: resolve the token to a
 * user, make sure that user's schema is current before the handler runs, and
 * kick off the one-shot screentime backfill.
 *
 * The schema check is gated by the schema fingerprint (#1125), so it is
 * normally one `SELECT` — but the middleware must still go through
 * `migrateSchemaIfNeeded`, never the unconditional sweep, and still only once
 * per user per instance.
 */
import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { Auth } from '../auth.ts'

import { httpError } from '../http-error.ts'

vi.mock('../db/index.ts', () => ({ migrateSchemaIfNeeded: vi.fn(async () => {}) }))
vi.mock('../services/audit-log.ts', () => ({
  auditError: vi.fn(),
  auditInfo: vi.fn(),
  auditWarn: vi.fn(),
}))
vi.mock('../services/backfill-screentime-activities.ts', () => ({
  backfillScreentimeActivities: vi.fn(async () => ({ created: 0, skipped: true })),
}))

const db = await import('../db/index.ts')
const backfill = await import('../services/backfill-screentime-activities.ts')
const { createAuthMiddleware } = await import('./middleware.ts')

/** Tokens are `token-<user>`; anything else is rejected, as a bad token is. */
const auth: Auth = {
  createToken: (user) => `token-${user}`,
  getUsernameFromToken: (token) => {
    if (!token.startsWith('token-')) throw new Error('unauthenticated')
    return token.slice('token-'.length)
  },
}

/** One app per test, so the middleware's per-instance map starts empty. */
const buildApp = () => {
  const httpd = express()
  httpd.use(createAuthMiddleware(auth, httpError(401, 'Unauthorized')))
  httpd.get('/who', (req, res) => {
    res.json({ user: req.user })
  })
  httpd.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(401).json({ error: err.message })
  })
  return httpd
}

const get = (httpd: express.Express, user: string) =>
  supertest(httpd).get('/who').set('Authorization', `Bearer token-${user}`)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(db.migrateSchemaIfNeeded).mockResolvedValue(undefined)
  vi.mocked(backfill.backfillScreentimeActivities).mockResolvedValue({ created: 0, skipped: true })
})

describe('createAuthMiddleware', () => {
  test('resolves the token to a user and lets the request through', async () => {
    const response = await get(buildApp(), 'alice')

    expect(response.status).toBe(200)
    expect(response.body.user).toBe('alice')
  })

  test('checks the schema through the gated entry point, not a forced sweep', async () => {
    await get(buildApp(), 'alice')

    expect(db.migrateSchemaIfNeeded).toHaveBeenCalledWith('alice')
  })

  test('checks once per user per instance, not once per request', async () => {
    const httpd = buildApp()

    await get(httpd, 'alice')
    await get(httpd, 'alice')
    await get(httpd, 'bob')

    expect(vi.mocked(db.migrateSchemaIfNeeded).mock.calls).toEqual([['alice'], ['bob']])
  })

  test('a new server instance checks again — the map is per process', async () => {
    await get(buildApp(), 'alice')
    await get(buildApp(), 'alice')

    expect(db.migrateSchemaIfNeeded).toHaveBeenCalledTimes(2)
  })

  test('triggers the screentime backfill after the schema check', async () => {
    await get(buildApp(), 'alice')

    expect(backfill.backfillScreentimeActivities).toHaveBeenCalledWith('alice')
  })

  test('still serves the request when the schema check fails', async () => {
    // A user whose database is broken should see the real failure from their
    // actual query, not a blanket 401 from the middleware.
    vi.mocked(db.migrateSchemaIfNeeded).mockRejectedValue(new Error('disk full'))

    const response = await get(buildApp(), 'alice')

    expect(response.status).toBe(200)
    expect(backfill.backfillScreentimeActivities).not.toHaveBeenCalled()
  })

  test('rejects a request with no Authorization header', async () => {
    const response = await supertest(buildApp()).get('/who')

    expect(response.status).toBe(401)
    expect(db.migrateSchemaIfNeeded).not.toHaveBeenCalled()
  })

  test('rejects an unparseable token without touching the schema', async () => {
    const response = await supertest(buildApp()).get('/who').set('Authorization', 'Bearer nonsense')

    expect(response.status).toBe(401)
    expect(db.migrateSchemaIfNeeded).not.toHaveBeenCalled()
  })
})
