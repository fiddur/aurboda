import express from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../services/audit-log.ts', () => ({ auditError: vi.fn() }))

const { auditError } = await import('../services/audit-log.ts')
const { registerOAuthRoutes } = await import('./oauth-routes.ts')

const password = 'hunter2 "x"'

const buildApp = (login: () => Promise<never>) => {
  const httpd = express()
  httpd.use(express.json())
  httpd.use((req, _res, next) => {
    req.user = 'alice'
    next()
  })
  registerOAuthRoutes({
    authMiddleware: ((_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next()) as never,
    centralDb: {} as never,
    garmin: { login } as never,
    gravl: { authCb: vi.fn(), getAuthorizeUrl: vi.fn() } as never,
    httpd,
    oura: { authCb: vi.fn(), getAuthorizeUrl: vi.fn() } as never,
    strava: { authCb: vi.fn(), getAuthorizeUrl: vi.fn() } as never,
  })
  return httpd
}

describe('POST /auth/garmin/login', () => {
  test('a failure that echoes the password returns 401 without it, in body or audit log', async () => {
    const leak = `boom ${password} ${JSON.stringify(password)} ${encodeURIComponent(password)}`
    const app = buildApp(async () => {
      throw new Error(leak)
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
