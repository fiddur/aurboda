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
}))

vi.mock('../services/audit-log.ts', () => ({ pruneAuditLog: vi.fn(async () => {}) }))

const db = await import('../db/index.ts')
const { registerAuthRoutes } = await import('./auth-routes.ts')

const pgError = (code: string, message = 'pg failure') => Object.assign(new Error(message), { code })

const buildApp = () => {
  const httpd = express()
  httpd.use(express.json())

  registerAuthRoutes({
    auth: { createToken: vi.fn(() => 'signed-token') } as never,
    authMiddleware: ((_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next()) as never,
    centralDb: {
      getAdminCount: vi.fn(async () => 1),
      getAuditLogRetentionDays: vi.fn(async () => 30),
      getSignupMode: vi.fn(async () => 'closed'),
      isAdmin: vi.fn(async () => false),
    } as never,
    httpd,
    invitationAuth: {} as never,
    unauthorized: httpError(401, 'Unauthorized'),
    userDb: {} as never,
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
  vi.mocked(db.query).mockResolvedValue({ rowCount: 1, rows: [{ usename: 'alice' }] } as never)
  vi.mocked(db.loginToUserDb).mockResolvedValue(undefined)
  vi.mocked(db.isInvalidPasswordError).mockReturnValue(false)
})

describe('POST /login', () => {
  test('issues a token for a correct password', async () => {
    const response = await login({ password: 'secret', username: 'alice' })

    expect(response.status).toBe(200)
    expect(response.body.token).toBe('signed-token')
    expect(db.loginToUserDb).toHaveBeenCalledWith('alice', 'secret')
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
