import express, { type RequestHandler } from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import type { AccountDeleter } from '../services/account-deletion.ts'
import type { VerificationSendResult } from '../services/account-recovery.ts'
import type { UserAccount } from '../services/central-user-accounts.ts'

import { createAccountRouter } from './account-router.ts'

const asAlice: RequestHandler = (req, _res, next) => {
  req.user = 'alice'
  next()
}

const buildApp = (deleteAccount: AccountDeleter) => {
  const app = express()
  app.use(express.json())
  app.use('/account', createAccountRouter(asAlice, deleteAccount))
  return app
}

describe('DELETE /account', () => {
  test('deletes the caller with the typed confirmation', async () => {
    const deleteAccount = vi.fn<AccountDeleter>(async () => ({ ok: true }))
    const res = await supertest(buildApp(deleteAccount))
      .delete('/account')
      .send({ confirm_username: 'alice' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(deleteAccount).toHaveBeenCalledWith('alice', { actor: 'alice', confirmUsername: 'alice' })
  })

  test.each([
    ['confirmation_mismatch', 400],
    ['not_found', 404],
    ['last_admin', 409],
    ['drop_failed', 500],
  ] as const)('maps %s to %i', async (error, status) => {
    const deleteAccount: AccountDeleter = async () => ({ error, message: `nope: ${error}`, ok: false })
    const res = await supertest(buildApp(deleteAccount)).delete('/account').send({ confirm_username: 'bob' })

    expect(res.status).toBe(status)
    expect(res.body).toEqual({ error: `nope: ${error}`, success: false })
  })

  test('400 without a confirmation', async () => {
    const deleteAccount = vi.fn<AccountDeleter>(async () => ({ ok: true }))
    const res = await supertest(buildApp(deleteAccount)).delete('/account').send({})

    expect(res.status).toBe(400)
    expect(deleteAccount).not.toHaveBeenCalled()
  })
})

describe('GET /account/plan', () => {
  test("returns the caller's plan", async () => {
    const plan = {
      billing_enabled: true,
      ends_at: '2027-02-04T00:00:00.000Z',
      expiring_soon: false,
      payment_url: 'https://pay.example',
      plan: 'trial' as const,
      price_text: '3 € / month',
      read_only_at: '2027-02-18T00:00:00.000Z',
      state: 'trial' as const,
    }
    const getMyPlan = vi.fn(async () => plan)
    const app = express()
    app.use(express.json())
    app.use('/account', createAccountRouter(asAlice, vi.fn<AccountDeleter>(), { getMyPlan }))

    const res = await supertest(app).get('/account/plan')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, ...plan })
    expect(getMyPlan).toHaveBeenCalledWith('alice')
  })
})

describe('/account/email', () => {
  const account = (email: string | null, verified = false): UserAccount => ({
    created_at: null,
    email,
    email_verified_at: verified ? new Date('2026-11-02T00:00:00Z') : null,
    inserted_at: new Date('2026-11-01T00:00:00Z'),
    paid_until: null,
    plan: null,
    plan_note: null,
    pre_existing: false,
    trial_ends_at: null,
    username: 'alice',
  })

  const buildEmailApp = (
    initial: string | null,
    {
      hasRow = true,
      verified = false,
      emailEnabled = true,
      sendResult = 'sent' as VerificationSendResult,
    } = {},
  ) => {
    let stored = account(initial, verified)
    const centralDb = {
      getUserAccount: vi.fn(async (_username: string) => (hasRow ? stored : null)),
      setUserEmail: vi.fn(async (_username: string, email: string | null) => {
        if (!hasRow) return null
        stored = account(email, email === stored.email && stored.email_verified_at !== null)
        return stored
      }),
    }
    const sendVerification = vi.fn(async (_username: string) => sendResult)
    const app = express()
    app.use(express.json())
    app.use(
      '/account',
      createAccountRouter(asAlice, vi.fn<AccountDeleter>(), undefined, {
        centralDb,
        emailEnabled: async () => emailEnabled,
        sendVerification,
      }),
    )
    return { app, centralDb, sendVerification }
  }

  test("GET returns the caller's email, whether it is verified and whether email is on", async () => {
    expect(
      (await supertest(buildEmailApp('alice@example.com', { verified: true }).app).get('/account/email'))
        .body,
    ).toEqual({ email: 'alice@example.com', email_enabled: true, success: true, verified: true })
    expect(
      (await supertest(buildEmailApp(null, { emailEnabled: false }).app).get('/account/email')).body,
    ).toEqual({ email: null, email_enabled: false, success: true, verified: false })
  })

  test('PUT stores the trimmed address as typed and sends it a verification link', async () => {
    const { centralDb, app, sendVerification } = buildEmailApp(null)
    const res = await supertest(app).put('/account/email').send({ email: '  Alice@Example.com ' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      email: 'Alice@Example.com',
      email_enabled: true,
      success: true,
      verified: false,
    })
    expect(centralDb.setUserEmail).toHaveBeenCalledWith('alice', 'Alice@Example.com')
    expect(sendVerification).toHaveBeenCalledWith('alice')
  })

  test('PUT of the same verified address keeps it verified and sends nothing', async () => {
    const { app, sendVerification } = buildEmailApp('alice@example.com', { verified: true })
    const res = await supertest(app).put('/account/email').send({ email: 'alice@example.com' })

    expect(res.body).toMatchObject({ email: 'alice@example.com', verified: true })
    expect(sendVerification).not.toHaveBeenCalled()
  })

  test.each([null, '', '   '])('PUT %j clears the address and sends nothing', async (email) => {
    const { centralDb, app, sendVerification } = buildEmailApp('alice@example.com', { verified: true })
    const res = await supertest(app).put('/account/email').send({ email })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ email: null, email_enabled: true, success: true, verified: false })
    expect(centralDb.setUserEmail).toHaveBeenCalledWith('alice', null)
    expect(sendVerification).not.toHaveBeenCalled()
  })

  test('PUT is a 409 for an account without a row yet', async () => {
    const { app } = buildEmailApp(null, { hasRow: false })
    const res = await supertest(app).put('/account/email').send({ email: 'alice@example.com' })

    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ success: false })
    expect(res.body.error).toContain("isn't fully set up yet")
  })

  test.each([{ email: 'not-an-email' }, { email: `${'a'.repeat(250)}@example.com` }, {}])(
    'PUT %j is a 400',
    async (body) => {
      const { centralDb, app } = buildEmailApp(null)
      const res = await supertest(app).put('/account/email').send(body)

      expect(res.status).toBe(400)
      expect(centralDb.setUserEmail).not.toHaveBeenCalled()
    },
  )

  test.each([
    ['sent', 200],
    ['already_verified', 200],
  ] as const)('POST /email/verification answers %s', async (result, status) => {
    const { app } = buildEmailApp('alice@example.com', { sendResult: result })
    const res = await supertest(app).post('/account/email/verification')
    expect(res.status).toBe(status)
    expect(res.body).toEqual({ status: result, success: true })
  })

  test.each([
    ['no_email', 400],
    ['not_configured', 409],
    ['rate_limited', 429],
    ['failed', 502],
  ] as const)('POST /email/verification maps %s to %i', async (result, status) => {
    const { app } = buildEmailApp('alice@example.com', { sendResult: result })
    const res = await supertest(app).post('/account/email/verification')
    expect(res.status).toBe(status)
    expect(res.body.success).toBe(false)
  })
})
