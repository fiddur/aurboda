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
const { garminOAuthClient, GARMIN_OAUTH_PROVIDER } = await import('../integrations/garmin/oauth-client.ts')
const { sealState } = await import('../services/oauth-state.ts')

const password = 'hunter2 "x"'

const buildApp = ({
  centralDb = { getServerSetting: vi.fn().mockResolvedValue(null) },
  garminOAuth = {},
  garminPersonal = {},
  gravl = {},
  login = vi.fn(),
  markNotificationsReadByType = vi.fn().mockResolvedValue(0),
  oura = {},
  signedIn = true,
  strava = {},
  verifyMfa = vi.fn(),
}: {
  centralDb?: Record<string, unknown>
  garminOAuth?: Record<string, unknown>
  garminPersonal?: Record<string, unknown>
  gravl?: Record<string, unknown>
  login?: (...args: string[]) => Promise<unknown>
  markNotificationsReadByType?: (user: string, type: string) => Promise<number>
  oura?: Record<string, unknown>
  signedIn?: boolean
  strava?: Record<string, unknown>
  verifyMfa?: (...args: string[]) => Promise<unknown>
} = {}) => {
  const httpd = express()
  httpd.use(express.json())
  httpd.use((req, _res, next) => {
    if (signedIn) req.user = 'alice'
    next()
  })
  registerOAuthRoutes({
    authMiddleware: ((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated', success: false })
        return
      }
      next()
    }) as never,
    centralDb: centralDb as never,
    garmin: { login, verifyMfa } as never,
    garminOAuth: { authCb: vi.fn(), getAuthorizeUrl: vi.fn(), ...garminOAuth } as never,
    garminPersonal: garminPersonal as never,
    gravl: { authCb: vi.fn(), getAuthorizeUrl: vi.fn(), ...gravl } as never,
    httpd,
    markNotificationsReadByType,
    oura: { authCb: vi.fn(), getAuthorizeUrl: vi.fn(), ...oura } as never,
    strava: { authCb: vi.fn(), getAuthorizeUrl: vi.fn(), ...strava } as never,
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

  test("marks the earlier key's reminders read after connecting", async () => {
    const markNotificationsReadByType = vi.fn().mockResolvedValue(2)
    const app = buildApp({
      garminPersonal: { connect: vi.fn().mockResolvedValue(undefined) },
      markNotificationsReadByType,
    })

    const res = await supertest(app)
      .post('/auth/garmin/personal-key')
      .send({ api_key: apiKey, expires_at: future })

    expect(res.status).toBe(200)
    expect(markNotificationsReadByType).toHaveBeenCalledWith('alice', 'garmin_key_expiring')
  })

  test('still answers 200 when marking the reminders read fails, and audits it', async () => {
    const app = buildApp({
      garminPersonal: { connect: vi.fn().mockResolvedValue(undefined) },
      markNotificationsReadByType: vi.fn().mockRejectedValue(new Error('db down')),
    })

    const res = await supertest(app)
      .post('/auth/garmin/personal-key')
      .send({ api_key: apiKey, expires_at: future })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(auditError).toHaveBeenCalledWith('alice', 'auth', 'Could not mark Garmin key reminders read', {
      error: 'Error: db down',
    })
    expect(JSON.stringify(vi.mocked(auditError).mock.calls)).not.toContain('fake-personal-key')
  })

  test('answers 401 when Garmin refuses the key, leaving the reminders unread', async () => {
    const connect = vi.fn().mockRejectedValue(new GarminKeyRefusedError())
    const markNotificationsReadByType = vi.fn()
    const app = buildApp({ garminPersonal: { connect }, markNotificationsReadByType })

    const res = await supertest(app)
      .post('/auth/garmin/personal-key')
      .send({ api_key: apiKey, expires_at: future })

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Garmin refused the key', success: false })
    expect(markNotificationsReadByType).not.toHaveBeenCalled()
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
  test('removes the key and marks its reminders read', async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined)
    const markNotificationsReadByType = vi.fn().mockResolvedValue(1)
    const app = buildApp({ garminPersonal: { disconnect }, markNotificationsReadByType })

    const res = await supertest(app).post('/auth/garmin/personal-key/disconnect')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(disconnect).toHaveBeenCalledWith('alice')
    expect(markNotificationsReadByType).toHaveBeenCalledWith('alice', 'garmin_key_expiring')
  })

  test('still answers 200 when marking the reminders read fails', async () => {
    const app = buildApp({
      garminPersonal: { disconnect: vi.fn().mockResolvedValue(undefined) },
      markNotificationsReadByType: vi.fn().mockRejectedValue(new Error('db down')),
    })

    const res = await supertest(app).post('/auth/garmin/personal-key/disconnect')

    expect(res.status).toBe(200)
    expect(auditError).toHaveBeenCalledWith('alice', 'auth', 'Could not mark Garmin key reminders read', {
      error: 'Error: db down',
    })
  })

  test('answers 500 and leaves the reminders when the disconnect fails', async () => {
    const markNotificationsReadByType = vi.fn()
    const app = buildApp({
      garminPersonal: { disconnect: vi.fn().mockRejectedValue(new Error('db down')) },
      markNotificationsReadByType,
    })

    const res = await supertest(app).post('/auth/garmin/personal-key/disconnect')

    expect(res.status).toBe(500)
    expect(markNotificationsReadByType).not.toHaveBeenCalled()
  })
})

describe('Connect with Garmin routes', () => {
  const FAKE_SECRET = 'fake-garmin-client-secret'
  const NOW = new Date('2026-11-10T10:00:00Z')

  const makeGarminOAuth = ({
    configured = true,
    grant = null,
  }: { configured?: boolean; grant?: Record<string, unknown> | null } = {}) => {
    const http = {
      delete: vi.fn().mockResolvedValue({ data: '' }),
      get: vi.fn(async (url: string) =>
        url.endsWith('/user/id') ? { data: { userId: 'fake-garmin-user' } } : { data: ['HEALTH_EXPORT'] },
      ),
      post: vi.fn().mockResolvedValue({
        data: { access_token: 'fake-access', expires_in: 86400, refresh_token: 'fake-refresh' },
      }),
    }
    const upsertOAuthToken = vi.fn()
    const deleteGarminUserMappingByUsername = vi.fn().mockResolvedValue(true)
    const deleteOAuthToken = vi.fn().mockResolvedValue(true)
    const client = garminOAuthClient(
      async () => (configured ? { clientId: 'fake-garmin-client-id', clientSecret: FAKE_SECRET } : null),
      'https://api.example.test',
      {
        auditInfo: vi.fn(),
        auditWarn: vi.fn(),
        deleteGarminUserMappingByUsername,
        deleteOAuthToken,
        ensureUserSchema: vi.fn(),
        getGarminUserIdByUsername: vi.fn().mockResolvedValue(null),
        getOAuthToken: async () => grant as never,
        http: http as never,
        markOAuthTokenRefused: vi.fn(),
        now: () => NOW,
        upsertGarminUserMapping: vi.fn().mockResolvedValue(null),
        upsertOAuthToken,
      },
    )
    return { client, deleteGarminUserMappingByUsername, deleteOAuthToken, http, upsertOAuthToken }
  }

  test('GET /auth/garmin/oauth/connect answers the consent URL', async () => {
    const { client } = makeGarminOAuth()
    const res = await supertest(buildApp({ garminOAuth: client })).get('/auth/garmin/oauth/connect')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.url).toMatch(/^https:\/\/connect\.garmin\.com\/oauth2Confirm\?/)
    expect(JSON.stringify(res.body)).not.toContain(FAKE_SECRET)
  })

  test('GET /auth/garmin/oauth/connect answers 400 when the server has no credentials', async () => {
    const { client } = makeGarminOAuth({ configured: false })
    const res = await supertest(buildApp({ garminOAuth: client })).get('/auth/garmin/oauth/connect')
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })

  const stateFor = (user: string) =>
    sealState({ iat: NOW.getTime(), user, verifier: 'fake-verifier' }, FAKE_SECRET)

  test('GET /auth/garmincb hands the code and state to the page without linking anything', async () => {
    const { client, http, upsertOAuthToken } = makeGarminOAuth()
    const app = buildApp({ garminOAuth: client })
    const state = stateFor('alice')

    const ok = await supertest(app).get('/auth/garmincb').query({ code: 'fake-code', state })
    expect(ok.status).toBe(302)
    const target = new URL(ok.headers.location, 'https://web.example.test')
    expect(target.pathname).toBe('/data-sources/garmin')
    expect(target.searchParams.get('garmin_code')).toBe('fake-code')
    expect(target.searchParams.get('garmin_state')).toBe(state)
    expect(http.post).not.toHaveBeenCalled()
    expect(upsertOAuthToken).not.toHaveBeenCalled()

    const bad = await supertest(app).get('/auth/garmincb').query({ code: 'fake-code', state: 'garbage' })
    expect(bad.headers.location).toBe('/data-sources/garmin?error=invalid_state')

    const denied = await supertest(app).get('/auth/garmincb').query({ error: 'access_denied' })
    expect(denied.headers.location).toBe('/data-sources/garmin?error=auth_failed')
  })

  test('POST /auth/garmin/oauth/complete links the Garmin account to the signed-in user', async () => {
    const { client, upsertOAuthToken } = makeGarminOAuth()
    const res = await supertest(buildApp({ garminOAuth: client }))
      .post('/auth/garmin/oauth/complete')
      .send({ code: 'fake-code', state: stateFor('alice') })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(upsertOAuthToken).toHaveBeenCalledWith(
      'alice',
      expect.objectContaining({ provider: GARMIN_OAUTH_PROVIDER }),
    )
  })

  test('POST /auth/garmin/oauth/complete answers 403 for a sign-in started by another account', async () => {
    const { client, http, upsertOAuthToken } = makeGarminOAuth()
    const res = await supertest(buildApp({ garminOAuth: client }))
      .post('/auth/garmin/oauth/complete')
      .send({ code: 'fake-code', state: stateFor('bob') })
    expect(res.status).toBe(403)
    expect(res.body).toEqual({
      error:
        'This Garmin sign-in was started from another Aurboda account. Start it again from this account.',
      success: false,
    })
    expect(http.post).not.toHaveBeenCalled()
    expect(upsertOAuthToken).not.toHaveBeenCalled()
  })

  test('POST /auth/garmin/oauth/complete answers 400 for an expired state, no credentials or a failed exchange', async () => {
    const expired = await supertest(buildApp({ garminOAuth: makeGarminOAuth().client }))
      .post('/auth/garmin/oauth/complete')
      .send({ code: 'fake-code', state: 'garbage' })
    expect(expired.status).toBe(400)
    expect(expired.body).toEqual({ error: 'The Garmin sign-in expired. Start it again.', success: false })

    const unconfigured = await supertest(
      buildApp({ garminOAuth: makeGarminOAuth({ configured: false }).client }),
    )
      .post('/auth/garmin/oauth/complete')
      .send({ code: 'fake-code', state: stateFor('alice') })
    expect(unconfigured.status).toBe(400)
    expect(unconfigured.body).toEqual({
      error: 'Garmin sign-in is not set up on this server.',
      success: false,
    })

    const failing = makeGarminOAuth()
    failing.http.post.mockRejectedValue(new Error(`exchange failed for fake-code ${FAKE_SECRET}`))
    const failed = await supertest(buildApp({ garminOAuth: failing.client }))
      .post('/auth/garmin/oauth/complete')
      .send({ code: 'fake-code', state: stateFor('alice') })
    expect(failed.status).toBe(400)
    expect(failed.body).toEqual({
      error: 'Garmin did not complete the connection. Try again.',
      success: false,
    })
  })

  test('POST /auth/garmin/oauth/complete rejects a body without a state', async () => {
    const complete = vi.fn()
    const res = await supertest(buildApp({ garminOAuth: { complete } }))
      .post('/auth/garmin/oauth/complete')
      .send({ code: 'fake-code' })
    expect(res.status).toBe(400)
    expect(complete).not.toHaveBeenCalled()
  })

  test('POST /auth/garmin/oauth/disconnect deregisters and clears the grant', async () => {
    const { client, deleteGarminUserMappingByUsername, deleteOAuthToken, http } = makeGarminOAuth({
      grant: {
        access_token: 'fake-access',
        expires_at: new Date('2026-11-11T10:00:00Z'),
        provider: GARMIN_OAUTH_PROVIDER,
      },
    })
    const res = await supertest(buildApp({ garminOAuth: client })).post('/auth/garmin/oauth/disconnect')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(http.delete).toHaveBeenCalled()
    expect(deleteOAuthToken).toHaveBeenCalledWith('alice', GARMIN_OAUTH_PROVIDER)
    expect(deleteGarminUserMappingByUsername).toHaveBeenCalledWith('alice')
  })

  test('POST /auth/garmin/oauth/disconnect answers 500 when the disconnect fails', async () => {
    const app = buildApp({ garminOAuth: { disconnect: vi.fn().mockRejectedValue(new Error('db down')) } })
    const res = await supertest(app).post('/auth/garmin/oauth/disconnect')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'db down', success: false })
  })
})

describe.each([
  ['oura', 'Oura', '/auth/oura/complete'],
  ['strava', 'Strava', '/auth/strava/complete'],
  ['gravl', 'Gravl', '/auth/gravl/complete'],
] as const)('POST the %s sign-in completion', (provider, name, path) => {
  const appWith = (complete: ReturnType<typeof vi.fn>, signedIn = true) =>
    buildApp({ [provider]: { complete }, signedIn })

  test('finishes the sign-in for the signed-in user', async () => {
    const complete = vi.fn().mockResolvedValue({ ok: true })
    const res = await supertest(appWith(complete)).post(path).send({ code: 'fake-code', state: 'fake-state' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(complete).toHaveBeenCalledWith('alice', 'fake-code', 'fake-state')
  })

  test('answers 403 for a sign-in started by another account', async () => {
    const complete = vi.fn().mockResolvedValue({ ok: false, reason: 'wrong_user' })
    const res = await supertest(appWith(complete)).post(path).send({ code: 'fake-code', state: 'fake-state' })
    expect(res.status).toBe(403)
    expect(res.body).toEqual({
      error: `This ${name} sign-in was started from another Aurboda account. Start it again from this account.`,
      success: false,
    })
  })

  test.each([
    ['invalid_state', `The ${name} sign-in expired. Start it again.`],
    ['not_configured', `${name} sign-in is not set up on this server.`],
    ['auth_failed', `${name} did not complete the connection. Try again.`],
  ])('answers 400 for %s', async (reason, error) => {
    const complete = vi.fn().mockResolvedValue({ ok: false, reason })
    const res = await supertest(appWith(complete)).post(path).send({ code: 'fake-code', state: 'fake-state' })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error, success: false })
  })

  test('answers 401 without a login and 400 for a body without a state, finishing nothing', async () => {
    const complete = vi.fn()
    const anonymous = await supertest(appWith(complete, false))
      .post(path)
      .send({ code: 'fake-code', state: 'fake-state' })
    expect(anonymous.status).toBe(401)
    const invalid = await supertest(appWith(complete)).post(path).send({ code: 'fake-code' })
    expect(invalid.status).toBe(400)
    expect(complete).not.toHaveBeenCalled()
  })
})
