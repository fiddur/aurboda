import express, { type RequestHandler } from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import type { AccountDeleter } from '../services/account-deletion.ts'

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
