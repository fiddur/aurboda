import express, { type RequestHandler } from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import type { AccountDeleter } from '../services/account-deletion.ts'
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
  const buildEmailApp = (initial: string | null, hasRow = true) => {
    let stored = initial
    const accountEmailDb = {
      getUserAccount: vi.fn(async (_username: string) => (hasRow ? account(stored) : null)),
      setUserEmail: vi.fn(async (_username: string, email: string | null) => {
        if (!hasRow) return null
        stored = email
        return account(stored)
      }),
    }
    const app = express()
    app.use(express.json())
    app.use('/account', createAccountRouter(asAlice, vi.fn<AccountDeleter>(), undefined, accountEmailDb))
    return { accountEmailDb, app }
  }

  const account = (email: string | null): UserAccount => ({
    created_at: null,
    email,
    inserted_at: new Date('2026-11-01T00:00:00Z'),
    paid_until: null,
    plan: null,
    plan_note: null,
    pre_existing: false,
    trial_ends_at: null,
    username: 'alice',
  })

  test("GET returns the caller's email, or null", async () => {
    expect((await supertest(buildEmailApp('alice@example.com').app).get('/account/email')).body).toEqual({
      email: 'alice@example.com',
      success: true,
    })
    expect((await supertest(buildEmailApp(null).app).get('/account/email')).body).toEqual({
      email: null,
      success: true,
    })
  })

  test('PUT stores the trimmed address as typed', async () => {
    const { accountEmailDb, app } = buildEmailApp(null)
    const res = await supertest(app).put('/account/email').send({ email: '  Alice@Example.com ' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ email: 'Alice@Example.com', success: true })
    expect(accountEmailDb.setUserEmail).toHaveBeenCalledWith('alice', 'Alice@Example.com')
  })

  test.each([null, '', '   '])('PUT %j clears the address', async (email) => {
    const { accountEmailDb, app } = buildEmailApp('alice@example.com')
    const res = await supertest(app).put('/account/email').send({ email })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ email: null, success: true })
    expect(accountEmailDb.setUserEmail).toHaveBeenCalledWith('alice', null)
  })

  test('PUT is a 409 for an account without a row yet', async () => {
    const { app } = buildEmailApp(null, false)
    const res = await supertest(app).put('/account/email').send({ email: 'alice@example.com' })

    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ email: null, success: false })
    expect(res.body.error).toContain("isn't fully set up yet")
  })

  test.each([{ email: 'not-an-email' }, { email: `${'a'.repeat(250)}@example.com` }, {}])(
    'PUT %j is a 400',
    async (body) => {
      const { accountEmailDb, app } = buildEmailApp(null)
      const res = await supertest(app).put('/account/email').send(body)

      expect(res.status).toBe(400)
      expect(accountEmailDb.setUserEmail).not.toHaveBeenCalled()
    },
  )
})
