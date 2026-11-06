/**
 * What the auth middleware does on the way through: resolve the token to a
 * user, make sure that user's schema is current before the handler runs, and
 * kick off the one-shot screentime backfill and legacy retype.
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
import type { AccountGate } from '../services/account-gate.ts'

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

vi.mock('../services/retype-legacy-screentime.ts', () => ({
  retypeLegacyScreentime: vi.fn(async () => ({ deduplicated: 0, retyped: 0, skipped: true })),
}))
vi.mock('../services/redact-garmin-login-audit.ts', () => ({
  redactGarminLoginAudit: vi.fn(async () => ({ redacted: 0, skipped: true })),
}))

const db = await import('../db/index.ts')
const backfill = await import('../services/backfill-screentime-activities.ts')
const retype = await import('../services/retype-legacy-screentime.ts')
const redact = await import('../services/redact-garmin-login-audit.ts')
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
const buildApp = (isDeletedUser?: (user: string) => boolean) => {
  const httpd = express()
  httpd.use(createAuthMiddleware(auth, httpError(401, 'Unauthorized'), isDeletedUser))
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
  vi.mocked(retype.retypeLegacyScreentime).mockResolvedValue({ deduplicated: 0, retyped: 0, skipped: true })
  vi.mocked(redact.redactGarminLoginAudit).mockResolvedValue({ redacted: 0, skipped: true })
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

  test('retypes legacy screentime after the backfill, even when the backfill fails', async () => {
    const order: string[] = []
    vi.mocked(backfill.backfillScreentimeActivities).mockImplementation(async () => {
      order.push('backfill')
      throw new Error('boom')
    })
    vi.mocked(retype.retypeLegacyScreentime).mockImplementation(async () => {
      order.push('retype')
      return { deduplicated: 0, retyped: 0, skipped: true }
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await get(buildApp(), 'alice')

    await vi.waitFor(() => expect(retype.retypeLegacyScreentime).toHaveBeenCalledWith('alice'))
    expect(order).toEqual(['backfill', 'retype'])
    errorSpy.mockRestore()
  })

  test('redacts leaked Garmin login audit entries after the screentime one-shots', async () => {
    await get(buildApp(), 'alice')

    await vi.waitFor(() => expect(redact.redactGarminLoginAudit).toHaveBeenCalledWith('alice'))
  })

  test('still serves the request when the schema check fails', async () => {
    // A user whose database is broken should see the real failure from their
    // actual query, not a blanket 401 from the middleware.
    vi.mocked(db.migrateSchemaIfNeeded).mockRejectedValue(new Error('disk full'))

    const response = await get(buildApp(), 'alice')

    expect(response.status).toBe(200)
    expect(backfill.backfillScreentimeActivities).not.toHaveBeenCalled()
    expect(retype.retypeLegacyScreentime).not.toHaveBeenCalled()
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

  test("rejects a deleted user's still-valid token without touching the schema", async () => {
    const httpd = buildApp((user) => user === 'gone')

    expect((await get(httpd, 'gone')).status).toBe(401)
    expect(db.migrateSchemaIfNeeded).not.toHaveBeenCalled()
    expect((await get(httpd, 'alice')).status).toBe(200)
  })
})

describe('createAuthMiddleware with an account gate', () => {
  const refusal = {
    error: 'This account is read-only until the plan is renewed',
    payment_url: 'https://pay.example',
  }
  const gate: AccountGate = {
    getStatus: vi.fn(),
    invalidate: vi.fn(),
    isReadOnly: vi.fn(async (user: string) => user === 'expired'),
    refusal: vi.fn(async (user: string) => (user === 'expired' ? refusal : null)),
  }

  const buildGatedApp = () => {
    const httpd = express()
    const authMiddleware = createAuthMiddleware(auth, httpError(401, 'Unauthorized'), undefined, gate)
    const ok = (req: express.Request, res: express.Response) => {
      res.json({ ok: true, user: req.user })
    }
    httpd.get('/activities', authMiddleware, ok)
    httpd.post('/activities', authMiddleware, ok)
    httpd.patch('/user/settings', authMiddleware, ok)
    const exportRouter = express.Router()
    exportRouter.post('/dump-link', authMiddleware, ok)
    httpd.use('/export', exportRouter)
    const accountRouter = express.Router()
    accountRouter.delete('/', authMiddleware, ok)
    httpd.use('/account', accountRouter)
    httpd.delete('/webauthn/credentials/:id', authMiddleware, ok)
    return httpd
  }

  const as = (user: string) => ({ Authorization: `Bearer token-${user}` })

  test('answers a write by a read-only account with 402 and the payment link', async () => {
    const httpd = buildGatedApp()
    for (const response of [
      await supertest(httpd).post('/activities').set(as('expired')),
      await supertest(httpd).patch('/user/settings').set(as('expired')),
    ]) {
      expect(response.status).toBe(402)
      expect(response.body).toEqual({ ...refusal, success: false })
    }
  })

  test('lets a read-only account read, export, delete itself and manage passkeys', async () => {
    const httpd = buildGatedApp()
    expect((await supertest(httpd).get('/activities').set(as('expired'))).status).toBe(200)
    expect((await supertest(httpd).post('/export/dump-link').set(as('expired'))).status).toBe(200)
    expect((await supertest(httpd).delete('/account').set(as('expired'))).status).toBe(200)
    expect((await supertest(httpd).delete('/webauthn/credentials/abc').set(as('expired'))).status).toBe(200)
  })

  test('lets everyone else write, and never consults the gate on a read', async () => {
    const httpd = buildGatedApp()
    vi.mocked(gate.refusal).mockClear()
    expect((await supertest(httpd).get('/activities').set(as('alice'))).status).toBe(200)
    expect(gate.refusal).not.toHaveBeenCalled()
    expect((await supertest(httpd).post('/activities').set(as('alice'))).status).toBe(200)
    expect(gate.refusal).toHaveBeenCalledWith('alice')
  })

  test('fails open when the gate lookup throws', async () => {
    vi.mocked(gate.refusal).mockRejectedValueOnce(new Error('db down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await supertest(buildGatedApp()).post('/activities').set(as('expired'))).status).toBe(200)
    errorSpy.mockRestore()
  })
})
