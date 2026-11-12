/**
 * `/login` behaviour: what counts as a rejected credential, what counts as a
 * server fault, and what work the route is allowed to do on the way through.
 */
import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { httpError, isHttpError } from '../http-error.ts'

vi.mock('../db/index.ts', () => ({
  initializeSchema: vi.fn(async () => {}),
  isInvalidPasswordError: vi.fn(),
  loginToUserDb: vi.fn(async () => {}),
  makeNewUserDb: vi.fn(async () => {}),
  migrateSchema: vi.fn(async () => {}),
  query: vi.fn(async () => ({ rowCount: 1, rows: [{ usename: 'alice' }] })),
  schemaInitialized: vi.fn(async () => true),
  upsertUserSettings: vi.fn(async () => ({})),
}))

vi.mock('../services/audit-log.ts', () => ({ pruneAuditLog: vi.fn(async () => {}) }))

const db = await import('../db/index.ts')
const { registerAuthRoutes } = await import('./auth-routes.ts')

const pgError = (code: string, message = 'pg failure') => Object.assign(new Error(message), { code })

const ensureUserAccount = vi.fn(async () => true)
const isUsernameDeleted = vi.fn(async (_username: string) => false)
const setUserEmail = vi.fn(async (): Promise<object | null> => ({}))

const buildApp = ({
  blogUsername = null,
  signupMode = 'closed',
  settings = {},
  users = ['fiddur'],
}: {
  blogUsername?: string | null
  signupMode?: string
  settings?: Record<string, unknown>
  users?: string[]
} = {}) => {
  const httpd = express()
  httpd.use(express.json())

  registerAuthRoutes({
    auth: { createToken: vi.fn(() => 'signed-token') } as never,
    authMiddleware: ((_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next()) as never,
    centralDb: {
      ensureUserAccount,
      getAdminCount: vi.fn(async () => 1),
      getAuditLogRetentionDays: vi.fn(async () => 30),
      getServerSetting: vi.fn(async (key: string) =>
        key === 'blog_username' ? blogUsername : (settings[key] ?? null),
      ),
      getSignupMode: vi.fn(async () => signupMode),
      isAdmin: vi.fn(async () => false),
      isUsernameDeleted,
      setUserEmail,
    } as never,
    httpd,
    invitationAuth: {} as never,
    unauthorized: httpError(401, 'Unauthorized'),
    userDb: {} as never,
    userExists: async (username) => users.includes(username),
  })

  httpd.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(isHttpError(err) ? err.status : 500).json({ error: err.message, success: false })
  })

  return httpd
}

const login = (body: unknown) =>
  supertest(buildApp())
    .post('/login')
    .send(body as object)

beforeEach(() => {
  vi.clearAllMocks()
  isUsernameDeleted.mockResolvedValue(false)
  vi.mocked(db.query).mockResolvedValue({ rowCount: 1, rows: [{ usename: 'alice' }] } as never)
  vi.mocked(db.loginToUserDb).mockResolvedValue(undefined)
  vi.mocked(db.isInvalidPasswordError).mockReturnValue(false)
})

describe('GET /status', () => {
  test('says the official feed is on when it lists a user', async () => {
    const response = await supertest(
      buildApp({
        settings: { official_feed: { remote_authors: [], tags: ['aurboda'], users: ['ghost', 'fiddur'] } },
      }),
    ).get('/status')
    expect(response.status).toBe(200)
    expect(response.body.official_feed).toBe(true)
    expect(response.body).not.toHaveProperty('blog_username')
  })

  test('says on for a feed of remote authors only, with no local user', async () => {
    const response = await supertest(
      buildApp({
        settings: {
          official_feed: { remote_authors: ['fiddur@aurboda.net'], tags: ['aurbodablog'], users: [] },
        },
        users: [],
      }),
    ).get('/status')
    expect(response.body.official_feed).toBe(true)
  })

  test('reads a legacy blog user as an official feed', async () => {
    const response = await supertest(buildApp({ blogUsername: 'fiddur' })).get('/status')
    expect(response.body.official_feed).toBe(true)
  })

  test('says off when no official feed is configured', async () => {
    const response = await supertest(buildApp()).get('/status')
    expect(response.body.official_feed).toBe(false)
  })

  test('says off when every listed user has been deleted since', async () => {
    const response = await supertest(
      buildApp({
        settings: { official_feed: { remote_authors: [], tags: [], users: ['fiddur'] } },
        users: [],
      }),
    ).get('/status')
    expect(response.status).toBe(200)
    expect(response.body.official_feed).toBe(false)
  })
})

describe('POST /login', () => {
  test('issues a token for a correct password', async () => {
    const response = await login({ password: 'secret', username: 'alice' })

    expect(response.status).toBe(200)
    expect(response.body.token).toBe('signed-token')
    expect(db.loginToUserDb).toHaveBeenCalledWith('alice', 'secret')
  })

  test('trims the username but sends the password exactly as typed', async () => {
    const response = await login({ password: ' secret ', username: ' alice ' })

    expect(response.status).toBe(200)
    expect(db.query).toHaveBeenCalledWith(expect.anything(), expect.any(String), ['alice'])
    expect(db.loginToUserDb).toHaveBeenCalledWith('alice', ' secret ')
  })

  test('rejects an unknown username without touching the database password check', async () => {
    vi.mocked(db.query).mockResolvedValue({ rowCount: 0, rows: [] } as never)

    const response = await login({ password: 'secret', username: 'nobody' })

    expect(response.status).toBe(401)
    expect(db.loginToUserDb).not.toHaveBeenCalled()
  })

  test('rejects a missing password rather than passing undefined down', async () => {
    const response = await login({ username: 'alice' })

    expect(response.status).toBe(401)
    expect(db.loginToUserDb).not.toHaveBeenCalled()
  })

  test('rejects an empty password rather than letting pg fall back to PGPASSWORD', async () => {
    // `pg` treats '' as unset and uses PGPASSWORD from the environment, so an
    // empty password would be a connection attempt as the service role.
    const response = await login({ password: '', username: 'alice' })

    expect(response.status).toBe(401)
    expect(db.loginToUserDb).not.toHaveBeenCalled()
  })

  test('answers 401 when Postgres rejects the password', async () => {
    vi.mocked(db.loginToUserDb).mockRejectedValue(pgError('28P01', 'password authentication failed'))
    vi.mocked(db.isInvalidPasswordError).mockReturnValue(true)

    const response = await login({ password: 'wrong', username: 'alice' })

    expect(response.status).toBe(401)
    expect(response.body.error).toBe('Unauthorized')
  })

  test('answers 503, not 401, when the database cannot be reached', async () => {
    // Reporting this as a bad credential is what made the outage invisible:
    // the user saw "wrong password" and the logs said nothing.
    vi.mocked(db.loginToUserDb).mockRejectedValue(pgError('08006', 'connection terminated'))
    vi.mocked(db.isInvalidPasswordError).mockReturnValue(false)

    const response = await login({ password: 'secret', username: 'alice' })

    expect(response.status).toBe(503)
    expect(response.body.error).not.toBe('Unauthorized')
  })

  test('answers 503 when a connect timeout expires', async () => {
    vi.mocked(db.loginToUserDb).mockRejectedValue(new Error('timeout expired'))

    const response = await login({ password: 'secret', username: 'alice' })

    expect(response.status).toBe(503)
  })

  test('never leaks the pg failure to an anonymous caller', async () => {
    // The central handler replies with `err.message`, and a pg failure names
    // internal hosts, database names and connection limits.
    vi.mocked(db.loginToUserDb).mockRejectedValue(pgError('08006', 'connect ECONNREFUSED 10.0.0.7:5432'))

    const response = await login({ password: 'secret', username: 'alice' })

    expect(JSON.stringify(response.body)).not.toContain('ECONNREFUSED')
    expect(JSON.stringify(response.body)).not.toContain('10.0.0.7')
  })

  test('does no schema work at all — login only authenticates', async () => {
    // migrateSchema is ~130 statements including full-table rewrites, and even
    // the cheap `schemaInitialized` check belongs to the migration triggers
    // (the deploy sweep, the auth middleware, the lazy retry), not to login.
    const response = await login({ password: 'secret', username: 'alice' })

    expect(response.status).toBe(200)
    expect(db.migrateSchema).not.toHaveBeenCalled()
    expect(db.initializeSchema).not.toHaveBeenCalled()
    expect(db.schemaInitialized).not.toHaveBeenCalled()
  })
})

describe('POST /signup', () => {
  test('trims the username but keeps the password exactly as typed', async () => {
    vi.mocked(db.query).mockResolvedValue({ rowCount: 0, rows: [] } as never)

    const response = await supertest(buildApp({ signupMode: 'open' }))
      .post('/signup')
      .send({ password: ' pass word ', username: 'alice ' })

    expect(response.status).toBe(200)
    expect(db.makeNewUserDb).toHaveBeenCalledWith(expect.anything(), 'alice', ' pass word ')
    expect(ensureUserAccount).toHaveBeenCalledWith('alice', {
      createdAt: expect.any(Date),
      plan: null,
      preExisting: false,
      trialEndsAt: null,
    })
  })

  test('starts the account on a trial while billing is enabled', async () => {
    vi.mocked(db.query).mockResolvedValue({ rowCount: 0, rows: [] } as never)

    const response = await supertest(
      buildApp({ settings: { billing_enabled: true, trial_days: 30 }, signupMode: 'open' }),
    )
      .post('/signup')
      .send({ password: 'secret', username: 'alice' })

    expect(response.status).toBe(200)
    const [, options] = ensureUserAccount.mock.lastCall as unknown as [
      string,
      { createdAt: Date; trialEndsAt: Date },
    ]
    expect(options).toMatchObject({ plan: 'trial', preExisting: false })
    expect(options.trialEndsAt.getTime() - options.createdAt.getTime()).toBe(30 * 86_400_000)
  })

  test('refuses a name whose role still exists, as during an account deletion before the name is reserved', async () => {
    vi.mocked(db.query).mockResolvedValue({ rowCount: 1, rows: [{ usename: 'leaving' }] } as never)

    const response = await supertest(buildApp({ signupMode: 'open' }))
      .post('/signup')
      .send({ password: 'secret', username: 'leaving' })

    expect(response.status).toBe(409)
    expect(response.body.error).toBe('Username already exists')
    expect(db.makeNewUserDb).not.toHaveBeenCalled()
  })

  test('answers 409 when the role appears between the check and CREATE USER', async () => {
    vi.mocked(db.query).mockResolvedValue({ rowCount: 0, rows: [] } as never)
    vi.mocked(db.makeNewUserDb).mockRejectedValueOnce(pgError('42710', 'role "racer" already exists'))

    const response = await supertest(buildApp({ signupMode: 'open' }))
      .post('/signup')
      .send({ password: 'secret', username: 'racer' })

    expect(response.status).toBe(409)
    expect(response.body.error).toBe('Username already exists')
    expect(ensureUserAccount).not.toHaveBeenCalled()
  })

  test('stores the optional display name and email it was given', async () => {
    vi.mocked(db.query).mockResolvedValue({ rowCount: 0, rows: [] } as never)

    const response = await supertest(buildApp({ signupMode: 'open' }))
      .post('/signup')
      .send({ display_name: ' Ada ', email: ' Ada@Example.com ', password: 'secret', username: 'ada' })

    expect(response.status).toBe(200)
    expect(db.upsertUserSettings).toHaveBeenCalledWith('ada', { display_name: 'Ada' })
    expect(setUserEmail).toHaveBeenCalledWith('ada', 'Ada@Example.com')
  })

  test('stores neither without them', async () => {
    vi.mocked(db.query).mockResolvedValue({ rowCount: 0, rows: [] } as never)

    const response = await supertest(buildApp({ signupMode: 'open' }))
      .post('/signup')
      .send({ display_name: '', email: '', password: 'secret', username: 'ada' })

    expect(response.status).toBe(200)
    expect(db.upsertUserSettings).not.toHaveBeenCalled()
    expect(setUserEmail).not.toHaveBeenCalled()
  })

  test('still signs up when storing the profile fails', async () => {
    vi.mocked(db.query).mockResolvedValue({ rowCount: 0, rows: [] } as never)
    setUserEmail.mockRejectedValueOnce(new Error('central down'))
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await supertest(buildApp({ signupMode: 'open' }))
      .post('/signup')
      .send({ email: 'ada@example.com', password: 'secret', username: 'ada' })

    expect(response.status).toBe(200)
    expect(response.body.token).toBe('signed-token')
    expect(errorLog).toHaveBeenCalled()
    errorLog.mockRestore()
  })

  test('signs up without the email, and logs it, when the account row is missing', async () => {
    vi.mocked(db.query).mockResolvedValue({ rowCount: 0, rows: [] } as never)
    setUserEmail.mockResolvedValueOnce(null)
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await supertest(buildApp({ signupMode: 'open' }))
      .post('/signup')
      .send({ email: 'ada@example.com', password: 'secret', username: 'ada' })

    expect(response.status).toBe(200)
    expect(errorLog).toHaveBeenCalledWith('⚠️ Failed to save the signup email for ada:', expect.any(Error))
    errorLog.mockRestore()
  })

  test('refuses a malformed email before creating the account', async () => {
    vi.mocked(db.query).mockResolvedValue({ rowCount: 0, rows: [] } as never)

    const response = await supertest(buildApp({ signupMode: 'open' }))
      .post('/signup')
      .send({ email: 'not-an-email', password: 'secret', username: 'ada' })

    expect(response.status).toBe(400)
    expect(response.body.error).toEqual({ email: ['Not a valid email address'] })
    expect(db.makeNewUserDb).not.toHaveBeenCalled()
  })

  test.each([
    ['a bidi override', 'Ada\u202Eevil'],
    ['a tab', 'Ada\tLovelace'],
  ])('refuses a display name with %s before creating the account', async (_label, display_name) => {
    vi.mocked(db.query).mockResolvedValue({ rowCount: 0, rows: [] } as never)

    const response = await supertest(buildApp({ signupMode: 'open' }))
      .post('/signup')
      .send({ display_name, password: 'secret', username: 'ada' })

    expect(response.status).toBe(400)
    expect(response.body.error).toEqual({
      display_name: ['Display name must not contain control or bidirectional formatting characters'],
    })
    expect(db.makeNewUserDb).not.toHaveBeenCalled()
  })

  test('answers 400 without a password', async () => {
    const response = await supertest(buildApp({ signupMode: 'open' }))
      .post('/signup')
      .send({ username: 'ada' })

    expect(response.status).toBe(400)
    expect(response.body.error).toHaveProperty('password')
    expect(db.makeNewUserDb).not.toHaveBeenCalled()
  })

  test('refuses the name of a deleted account as taken', async () => {
    vi.mocked(db.query).mockResolvedValue({ rowCount: 0, rows: [] } as never)
    isUsernameDeleted.mockImplementation(async (username) => username === 'gone')

    const response = await supertest(buildApp({ signupMode: 'open' }))
      .post('/signup')
      .send({ password: 'secret', username: 'gone' })

    expect(response.status).toBe(409)
    expect(response.body.error).toBe('Username already exists')
    expect(db.makeNewUserDb).not.toHaveBeenCalled()
  })
})

describe('GET /status', () => {
  test('says billing is off without trial or price', async () => {
    const response = await supertest(buildApp({ signupMode: 'open' })).get('/status')

    expect(response.body).toMatchObject({ billing_enabled: false, signup_mode: 'open', success: true })
    expect(response.body.trial_days).toBeUndefined()
    expect(response.body.price_text).toBeUndefined()
  })

  test('with billing on, carries the trial length and price for the signup page', async () => {
    const response = await supertest(
      buildApp({ settings: { billing_enabled: true, price_text: '3 € / month', trial_days: 60 } }),
    ).get('/status')

    expect(response.body).toMatchObject({ billing_enabled: true, price_text: '3 € / month', trial_days: 60 })
  })

  test('carries the admin contacts, null when unset', async () => {
    const unset = await supertest(buildApp()).get('/status')
    expect(unset.body).toMatchObject({ contact_fediverse: null, contact_reddit: null })

    const set = await supertest(
      buildApp({ settings: { contact_fediverse: 'fiddur@aurboda.net', contact_reddit: 'fiddur' } }),
    ).get('/status')
    expect(set.body).toMatchObject({ contact_fediverse: 'fiddur@aurboda.net', contact_reddit: 'fiddur' })
  })
})
