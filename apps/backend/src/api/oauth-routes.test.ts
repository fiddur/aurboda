import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type * as dbIndex from '../db/index.ts'

vi.mock('../services/audit-log.ts', () => ({ auditError: vi.fn() }))
vi.mock('../db/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof dbIndex>()),
  resetSyncState: vi.fn(),
}))

const { auditError } = await import('../services/audit-log.ts')
const { resetSyncState } = await import('../db/index.ts')
const { registerOAuthRoutes } = await import('./oauth-routes.ts')

const password = 'hunter2 "x"'

const buildApp = ({
  centralDb = {},
  login = vi.fn(),
  oura = {},
}: {
  centralDb?: Record<string, unknown>
  login?: () => Promise<never>
  oura?: Record<string, unknown>
} = {}) => {
  const httpd = express()
  httpd.use(express.json())
  httpd.use((req, _res, next) => {
    req.user = 'alice'
    next()
  })
  registerOAuthRoutes({
    authMiddleware: ((_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next()) as never,
    centralDb: centralDb as never,
    garmin: { login } as never,
    gravl: { authCb: vi.fn(), getAuthorizeUrl: vi.fn() } as never,
    httpd,
    oura: { authCb: vi.fn(), getAuthorizeUrl: vi.fn(), ...oura } as never,
    strava: { authCb: vi.fn(), getAuthorizeUrl: vi.fn() } as never,
  })
  return httpd
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /auth/garmin/login', () => {
  test('a failure that echoes the password returns 401 without it, in body or audit log', async () => {
    const leak = `boom ${password} ${JSON.stringify(password)} ${encodeURIComponent(password)}`
    const app = buildApp({
      login: async () => {
        throw new Error(leak)
      },
    })

    const res = await supertest(app).post('/auth/garmin/login').send({ email: 'a@b.c', password })

    expect(res.status).toBe(401)
    const forms = [password, JSON.stringify(password).slice(1, -1), encodeURIComponent(password)]
    const logged = JSON.stringify(vi.mocked(auditError).mock.calls)
    for (const form of forms) {
      expect(res.body.error).not.toContain(form)
      expect(logged).not.toContain(form)
    }
    expect(res.body.error).toContain('[REDACTED]')
  })
})

describe('POST /auth/oura/disconnect', () => {
  test("removes the user's grant, sync state and webhook mapping", async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined)
    const deleteOuraUserMappingsByUsername = vi.fn().mockResolvedValue(1)
    const app = buildApp({ centralDb: { deleteOuraUserMappingsByUsername }, oura: { disconnect } })

    const res = await supertest(app).post('/auth/oura/disconnect')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(disconnect).toHaveBeenCalledWith('alice')
    expect(resetSyncState).toHaveBeenCalledWith('alice', 'oura')
    expect(deleteOuraUserMappingsByUsername).toHaveBeenCalledWith('alice')
  })

  test('responds 500 when the disconnect throws', async () => {
    const disconnect = vi.fn().mockRejectedValue(new Error('db down'))
    const deleteOuraUserMappingsByUsername = vi.fn()
    const app = buildApp({ centralDb: { deleteOuraUserMappingsByUsername }, oura: { disconnect } })

    const res = await supertest(app).post('/auth/oura/disconnect')

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'db down', success: false })
    expect(resetSyncState).not.toHaveBeenCalled()
    expect(deleteOuraUserMappingsByUsername).not.toHaveBeenCalled()
  })
})
