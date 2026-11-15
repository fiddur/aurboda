import express from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import type { AccountRecovery } from '../services/account-recovery.ts'

import { createAccountRecoveryRouter, INVALID_LINK_ERROR } from './account-recovery-router.ts'

const build = (overrides: Partial<AccountRecovery> = {}) => {
  const recovery: AccountRecovery = {
    completeRecovery: vi.fn(async () => ({
      is_admin: false,
      ok: true as const,
      token: 'session',
      username: 'alice',
    })),
    requestRecovery: vi.fn(async () => {}),
    sendVerification: vi.fn(async () => 'sent' as const),
    verifyEmail: vi.fn(async () => true),
    ...overrides,
  }
  const app = express()
  app.use(express.json())
  app.use('/account', createAccountRecoveryRouter(recovery))
  return { app, recovery }
}

describe('POST /account/recovery/request', () => {
  test('answers the same whatever the identifier, before the lookup finishes', async () => {
    let finish = () => {}
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const { app, recovery } = build({ requestRecovery: vi.fn(() => pending) })
    const known = await supertest(app).post('/account/recovery/request').send({ identifier: 'alice' })
    const unknown = await supertest(app)
      .post('/account/recovery/request')
      .send({ identifier: 'nobody@example.com' })
    finish()
    expect(known.status).toBe(200)
    expect(unknown.status).toBe(200)
    expect(known.body).toEqual(unknown.body)
    expect(known.body).toEqual({
      message: 'If an account with a verified email matches, a link is on its way.',
      success: true,
    })
    expect(recovery.requestRecovery).toHaveBeenCalledWith('alice')
    expect(recovery.requestRecovery).toHaveBeenCalledWith('nobody@example.com')
  })

  test('is a 400 without an identifier', async () => {
    const res = await supertest(build().app).post('/account/recovery/request').send({ identifier: '  ' })
    expect(res.status).toBe(400)
  })
})

describe('POST /account/recovery/complete', () => {
  test('answers like /login, with the username', async () => {
    const { app, recovery } = build()
    const res = await supertest(app)
      .post('/account/recovery/complete')
      .send({ new_password: 'secret', token: 'abc' })
    expect(res.body).toEqual({ is_admin: false, token: 'session', username: 'alice' })
    expect(recovery.completeRecovery).toHaveBeenCalledWith('abc', 'secret')
  })

  test('passes no password when none is given', async () => {
    const { app, recovery } = build()
    await supertest(app).post('/account/recovery/complete').send({ token: 'abc' })
    expect(recovery.completeRecovery).toHaveBeenCalledWith('abc', undefined)
  })

  test('refuses an empty password by the signup rule', async () => {
    const { app, recovery } = build()
    const res = await supertest(app)
      .post('/account/recovery/complete')
      .send({ new_password: '', token: 'abc' })
    expect(res.status).toBe(400)
    expect(recovery.completeRecovery).not.toHaveBeenCalled()
  })

  test('a refused link is a 400 with the generic message', async () => {
    const { app } = build({ completeRecovery: vi.fn(async () => ({ ok: false as const })) })
    const res = await supertest(app).post('/account/recovery/complete').send({ token: 'abc' })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: INVALID_LINK_ERROR, success: false })
  })
})

describe('POST /account/email/verify', () => {
  test('verifies, or answers the generic failure', async () => {
    expect((await supertest(build().app).post('/account/email/verify').send({ token: 'abc' })).body).toEqual({
      success: true,
    })
    const refused = await supertest(build({ verifyEmail: vi.fn(async () => false) }).app)
      .post('/account/email/verify')
      .send({ token: 'abc' })
    expect(refused.status).toBe(400)
    expect(refused.body).toEqual({ error: INVALID_LINK_ERROR, success: false })
  })
})
