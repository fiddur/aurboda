import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { query } from '../db/connection.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { redactGarminLoginAudit } from './redact-garmin-login-audit.ts'

const CONTAINER_TIMEOUT = 120_000

const insert = (message: string, details: Record<string, unknown>) =>
  query(
    getTestUser(),
    `INSERT INTO audit_log (level, category, message, details) VALUES ('error', 'auth', $1, $2)`,
    [message, JSON.stringify(details)],
  )

const detailsByMessage = async () => {
  const { rows } = await query(getTestUser(), `SELECT message, details FROM audit_log ORDER BY message`)
  return Object.fromEntries(
    (rows as { message: string; details: unknown }[]).map((r) => [r.message, r.details]),
  )
}

describe('redactGarminLoginAudit', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    await query(getTestUser(), `DELETE FROM audit_log`)
  })

  test('drops the leaked error and response fields and leaves other entries alone', async () => {
    await insert('Garmin login failed', { email: 'a@b.c', error: 'Error: ... "password":"hunter2"' })
    await insert('Garmin login endpoint error', { error: 'Error: ... hunter2' })
    await insert('POST /auth/garmin/login', {
      email: 'a@b.c',
      password: '[REDACTED]',
      response: { error: 'hunter2' },
      status: 401,
    })
    await insert('POST /api/tags', { response: { error: 'kept' }, status: 400 })

    const result = await redactGarminLoginAudit(getTestUser())

    expect(result).toEqual({ redacted: 3, skipped: false })
    expect(await detailsByMessage()).toEqual({
      'Garmin login endpoint error': {},
      'Garmin login failed': { email: 'a@b.c' },
      'POST /api/tags': { response: { error: 'kept' }, status: 400 },
      'POST /auth/garmin/login': { email: 'a@b.c', password: '[REDACTED]', status: 401 },
    })
  })

  test('runs once per user', async () => {
    await redactGarminLoginAudit(getTestUser())
    await insert('Garmin login failed', { error: 'later' })

    expect(await redactGarminLoginAudit(getTestUser())).toEqual({ redacted: 0, skipped: true })
    expect(await detailsByMessage()).toEqual({ 'Garmin login failed': { error: 'later' } })
  })
})
