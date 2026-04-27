/**
 * Router-level tests for `/webauthn/*`.
 *
 * Mocked deps verify status-code selection, auth gating, JSON parsing, and
 * that the router never echoes raw verifier errors back to clients.
 */
import express, { type RequestHandler } from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { Auth } from '../auth.ts'
import type { CentralDb } from '../services/central-db.ts'
import type { WebAuthnService } from '../services/webauthn.ts'

import { createWebAuthnRouter } from './webauthn-router.ts'

const buildApp = (
  webAuthn: Partial<WebAuthnService>,
  options: {
    auth?: Partial<Auth>
    centralDb?: Partial<CentralDb>
    authenticatedUser?: string | null
  } = {},
) => {
  const app = express()
  app.use(express.json())
  const authMiddleware: RequestHandler = (req, _res, next) => {
    if (options.authenticatedUser !== undefined && options.authenticatedUser !== null) {
      req.user = options.authenticatedUser
    }
    if (options.authenticatedUser === null) {
      // Unauthenticated for routes that require auth
      return next(new Error('Unauthorized'))
    }
    next()
  }
  app.use(
    '/webauthn',
    createWebAuthnRouter({
      auth: { createToken: vi.fn(() => 'fake-token'), ...options.auth } as Auth,
      authMiddleware,
      centralDb: { isAdmin: vi.fn(async () => false), ...options.centralDb } as unknown as CentralDb,
      webAuthn: webAuthn as WebAuthnService,
    }),
  )
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /webauthn/auth/options', () => {
  test('returns options_json on success (no body required)', async () => {
    const webAuthn: Partial<WebAuthnService> = {
      getAuthenticationOptions: vi.fn(async () => ({ challenge: 'c1' }) as never),
    }
    const app = buildApp(webAuthn)
    const res = await supertest(app).post('/webauthn/auth/options').send({})
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(JSON.parse(res.body.options_json)).toEqual({ challenge: 'c1' })
  })
})

describe('POST /webauthn/auth/verify', () => {
  test('400 on invalid response_json', async () => {
    const app = buildApp({})
    const res = await supertest(app).post('/webauthn/auth/verify').send({ response_json: '{not-json' })
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ success: false, verified: false })
  })

  test('401 with generic message when verification fails', async () => {
    const webAuthn: Partial<WebAuthnService> = {
      verifyAuthentication: vi.fn(async () => ({ verified: false })),
    }
    const app = buildApp(webAuthn)
    const res = await supertest(app).post('/webauthn/auth/verify').send({ response_json: '{}' })
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Verification failed', success: false, verified: false })
  })

  test('401 with generic message when service throws — does not leak internal details', async () => {
    const webAuthn: Partial<WebAuthnService> = {
      verifyAuthentication: vi.fn(async () => {
        throw new Error('attestation parsing failed: invalid CBOR at byte 17')
      }),
    }
    const app = buildApp(webAuthn)
    const res = await supertest(app).post('/webauthn/auth/verify').send({ response_json: '{}' })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Verification failed')
    expect(JSON.stringify(res.body)).not.toContain('CBOR')
  })

  test('200 with token + username on success', async () => {
    const webAuthn: Partial<WebAuthnService> = {
      verifyAuthentication: vi.fn(async () => ({ user: 'alice', verified: true })),
    }
    const auth = { createToken: vi.fn(() => 'token-for-alice') }
    const centralDb = { isAdmin: vi.fn(async () => true) }
    const app = buildApp(webAuthn, { auth, centralDb })
    const res = await supertest(app).post('/webauthn/auth/verify').send({ response_json: '{}' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      is_admin: true,
      success: true,
      token: 'token-for-alice',
      username: 'alice',
      verified: true,
    })
    expect(auth.createToken).toHaveBeenCalledWith('alice')
    // The response must not contain a refresh field — it was deliberately removed.
    expect(res.body).not.toHaveProperty('refresh')
  })
})

describe('POST /webauthn/register/options (auth required)', () => {
  test('returns options_json for authenticated user', async () => {
    const webAuthn: Partial<WebAuthnService> = {
      getRegistrationOptions: vi.fn(async () => ({ challenge: 'reg' }) as never),
    }
    const app = buildApp(webAuthn, { authenticatedUser: 'alice' })
    const res = await supertest(app).post('/webauthn/register/options').send({})
    expect(res.status).toBe(200)
    expect(webAuthn.getRegistrationOptions).toHaveBeenCalledWith('alice')
    expect(JSON.parse(res.body.options_json)).toEqual({ challenge: 'reg' })
  })
})

describe('POST /webauthn/register/verify', () => {
  test('400 on invalid response_json', async () => {
    const app = buildApp({}, { authenticatedUser: 'alice' })
    const res = await supertest(app).post('/webauthn/register/verify').send({ response_json: 'not-json' })
    expect(res.status).toBe(400)
  })

  test('200 on success returns credential_id', async () => {
    const webAuthn: Partial<WebAuthnService> = {
      verifyRegistration: vi.fn(async () => ({ credentialId: 'cred-1', verified: true })),
    }
    const app = buildApp(webAuthn, { authenticatedUser: 'alice' })
    const res = await supertest(app).post('/webauthn/register/verify').send({ response_json: '{}' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ credential_id: 'cred-1', success: true, verified: true })
  })

  test('400 with generic error when verification rejects', async () => {
    const webAuthn: Partial<WebAuthnService> = {
      verifyRegistration: vi.fn(async () => ({ verified: false })),
    }
    const app = buildApp(webAuthn, { authenticatedUser: 'alice' })
    const res = await supertest(app).post('/webauthn/register/verify').send({ response_json: '{}' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Verification failed')
  })
})

describe('GET /webauthn/credentials', () => {
  test("returns the user's credentials", async () => {
    const webAuthn: Partial<WebAuthnService> = {
      listCredentials: vi.fn(async () => [
        {
          backed_up: true,
          created_at: '2025-01-01T00:00:00.000Z',
          credential_id: 'cred-1',
          device_type: 'multiDevice',
          last_used_at: null,
          nickname: 'Phone',
          transports: ['internal'],
        },
      ]),
    }
    const app = buildApp(webAuthn, { authenticatedUser: 'alice' })
    const res = await supertest(app).get('/webauthn/credentials')
    expect(res.status).toBe(200)
    expect(res.body.credentials).toHaveLength(1)
    expect(webAuthn.listCredentials).toHaveBeenCalledWith('alice')
  })
})

describe('PATCH /webauthn/credentials/:id', () => {
  test('404 when not found', async () => {
    const webAuthn: Partial<WebAuthnService> = {
      renameCredential: vi.fn(async () => false),
    }
    const app = buildApp(webAuthn, { authenticatedUser: 'alice' })
    const res = await supertest(app).patch('/webauthn/credentials/missing').send({ nickname: 'New' })
    expect(res.status).toBe(404)
  })

  test('200 on success', async () => {
    const webAuthn: Partial<WebAuthnService> = {
      renameCredential: vi.fn(async () => true),
    }
    const app = buildApp(webAuthn, { authenticatedUser: 'alice' })
    const res = await supertest(app).patch('/webauthn/credentials/cred-1').send({ nickname: 'New' })
    expect(res.status).toBe(200)
    expect(webAuthn.renameCredential).toHaveBeenCalledWith('alice', 'cred-1', 'New')
  })
})

describe('DELETE /webauthn/credentials/:id', () => {
  test('404 when not found', async () => {
    const webAuthn: Partial<WebAuthnService> = {
      deleteCredential: vi.fn(async () => false),
    }
    const app = buildApp(webAuthn, { authenticatedUser: 'alice' })
    const res = await supertest(app).delete('/webauthn/credentials/missing')
    expect(res.status).toBe(404)
  })

  test('200 on success', async () => {
    const webAuthn: Partial<WebAuthnService> = {
      deleteCredential: vi.fn(async () => true),
    }
    const app = buildApp(webAuthn, { authenticatedUser: 'alice' })
    const res = await supertest(app).delete('/webauthn/credentials/cred-1')
    expect(res.status).toBe(200)
  })
})
