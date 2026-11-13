import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type * as dbIndex from '../db/index.ts'

vi.mock('../services/audit-log.ts', () => ({ auditError: vi.fn(), auditInfo: vi.fn(), auditWarn: vi.fn() }))
vi.mock('../db/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof dbIndex>()),
  resetSyncState: vi.fn(),
}))

const { auditError, auditInfo } = await import('../services/audit-log.ts')
const { GarminKeyRefusedError, GarminPersonalApiError } =
  await import('../integrations/garmin/personal-client.ts')
const { resetSyncState } = await import('../db/index.ts')
const { registerOAuthRoutes } = await import('./oauth-routes.ts')

const password = 'hunter2 "x"'

const buildApp = ({
  centralDb = { getServerSetting: vi.fn().mockResolvedValue(null) },
  garminPersonal = {},
  login = vi.fn(),
  oura = {},
  verifyMfa = vi.fn(),
}: {
  centralDb?: Record<string, unknown>
  garminPersonal?: Record<string, unknown>
  login?: (...args: string[]) => Promise<unknown>
  oura?: Record<string, unknown>
  verifyMfa?: (...args: string[]) => Promise<unknown>
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
    garmin: { login, verifyMfa } as never,
    garminPersonal: garminPersonal as never,
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

describe('Garmin login input', () => {
  test('trims the email but sends the password exactly as typed', async () => {
    const login = vi.fn().mockResolvedValue({ success: true })
    const app = buildApp({ login })

    const res = await supertest(app).post('/auth/garmin/login').send({ email: ' a@b.c ', password: ' pw ' })

    expect(res.status).toBe(200)
    expect(login).toHaveBeenCalledWith('alice', 'a@b.c', ' pw ')
  })

  test('trims the MFA code', async () => {
    const verifyMfa = vi.fn().mockResolvedValue({ success: true })
    const app = buildApp({ verifyMfa })

    const res = await supertest(app).post('/auth/garmin/mfa').send({ mfa_code: '123456 ' })

    expect(res.status).toBe(200)
    expect(verifyMfa).toHaveBeenCalledWith('alice', '123456')
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

describe('POST /auth/garmin/personal-key', () => {
  const apiKey = 'fake-personal-key "x"'
  const future = '2099-01-01'

  test('connects with the key and the expiry, auditing the date only', async () => {
    const connect = vi.fn().mockResolvedValue(undefined)
    const app = buildApp({ garminPersonal: { connect } })

    const res = await supertest(app)
      .post('/auth/garmin/personal-key')
      .send({ api_key: ` ${apiKey} `, expires_at: future })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(connect).toHaveBeenCalledWith('alice', apiKey, new Date('2099-01-01T00:00:00Z'))
    expect(auditInfo).toHaveBeenCalledWith('alice', 'auth', 'Garmin Personal API key connected', {
      expires_at: future,
    })
    expect(JSON.stringify(vi.mocked(auditInfo).mock.calls)).not.toContain('fake-personal-key')
  })

  test('answers 401 when Garmin refuses the key', async () => {
    const connect = vi.fn().mockRejectedValue(new GarminKeyRefusedError())
    const app = buildApp({ garminPersonal: { connect } })

    const res = await supertest(app)
      .post('/auth/garmin/personal-key')
      .send({ api_key: apiKey, expires_at: future })

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Garmin refused the key', success: false })
  })

  test('answers 502 on another Garmin failure, without the key in body or audit log', async () => {
    const connect = vi.fn().mockRejectedValue(new Error(`upstream echoed ${apiKey}`))
    const app = buildApp({ garminPersonal: { connect } })

    const res = await supertest(app)
      .post('/auth/garmin/personal-key')
      .send({ api_key: apiKey, expires_at: future })

    expect(res.status).toBe(502)
    expect(res.body.error).not.toContain(apiKey)
    expect(JSON.stringify(vi.mocked(auditError).mock.calls)).not.toContain('fake-personal-key')
  })

  test('answers 502 with the status for a Garmin API error', async () => {
    const connect = vi.fn().mockRejectedValue(new GarminPersonalApiError(500, '/token'))
    const app = buildApp({ garminPersonal: { connect } })

    const res = await supertest(app)
      .post('/auth/garmin/personal-key')
      .send({ api_key: apiKey, expires_at: future })

    expect(res.status).toBe(502)
    expect(res.body.error).toBe('Garmin Personal API 500 for /token')
  })

  test('answers 403 and does not call Garmin when the admin switch is off', async () => {
    const connect = vi.fn()
    const app = buildApp({
      centralDb: { getServerSetting: vi.fn().mockResolvedValue(false) },
      garminPersonal: { connect },
    })

    const res = await supertest(app)
      .post('/auth/garmin/personal-key')
      .send({ api_key: apiKey, expires_at: future })

    expect(res.status).toBe(403)
    expect(res.body.success).toBe(false)
    expect(connect).not.toHaveBeenCalled()
  })

  test('answers 400 for an expiry in the past, and for a missing key', async () => {
    const connect = vi.fn()
    const app = buildApp({ garminPersonal: { connect } })

    const past = await supertest(app)
      .post('/auth/garmin/personal-key')
      .send({ api_key: apiKey, expires_at: '2020-01-01' })
    const missing = await supertest(app)
      .post('/auth/garmin/personal-key')
      .send({ api_key: ' ', expires_at: future })

    expect(past.status).toBe(400)
    expect(missing.status).toBe(400)
    expect(connect).not.toHaveBeenCalled()
  })
})

describe('POST /auth/garmin/personal-key/disconnect', () => {
  test('removes the key', async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined)
    const app = buildApp({ garminPersonal: { disconnect } })

    const res = await supertest(app).post('/auth/garmin/personal-key/disconnect')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(disconnect).toHaveBeenCalledWith('alice')
  })
})
