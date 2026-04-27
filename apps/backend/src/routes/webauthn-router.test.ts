import type { Client } from 'pg'

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
import type { InvitationAuth } from '../services/invitation.ts'
import type { WebAuthnService } from '../services/webauthn.ts'

import * as dbIndex from '../db/index.ts'
import * as webauthnDb from '../db/webauthn.ts'
import { createWebAuthnRouter } from './webauthn-router.ts'

vi.mock('../db/index.ts', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return {
    ...orig,
    dropUserDb: vi.fn().mockResolvedValue(undefined),
    makeNewUserDb: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
  }
})

vi.mock('../db/webauthn.ts', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return {
    ...orig,
    insertWebAuthnCredential: vi.fn().mockResolvedValue(undefined),
  }
})

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
      invitationAuth: {
        validateInvitationToken: vi.fn(() => ({ valid: true })),
      } as unknown as InvitationAuth,
      userDb: {} as Client,
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

describe('POST /webauthn/signup/options', () => {
  test('403 when signup is closed', async () => {
    const app = buildApp({}, { centralDb: { getSignupMode: vi.fn(async (): Promise<'closed'> => 'closed') } })
    const res = await supertest(app).post('/webauthn/signup/options').send({ username: 'alice' })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/closed/i)
  })

  test('403 when invite_only and no invitation provided', async () => {
    const app = buildApp({}, { centralDb: { getSignupMode: vi.fn(async (): Promise<'invite_only'> => 'invite_only') } })
    const res = await supertest(app).post('/webauthn/signup/options').send({ username: 'alice' })
    expect(res.status).toBe(403)
  })

  test('400 when username is invalid', async () => {
    const webAuthn: Partial<WebAuthnService> = {
      getSignupOptions: vi.fn(async () => ({ challenge: 'c' }) as never),
    }
    const app = buildApp(webAuthn, { centralDb: { getSignupMode: vi.fn(async (): Promise<'open'> => 'open') } })
    const res = await supertest(app).post('/webauthn/signup/options').send({ username: 'A!' })
    expect(res.status).toBe(400)
    expect(webAuthn.getSignupOptions).not.toHaveBeenCalled()
  })

  test('400 when username is reserved', async () => {
    const webAuthn: Partial<WebAuthnService> = {
      getSignupOptions: vi.fn(async () => ({ challenge: 'c' }) as never),
    }
    const app = buildApp(webAuthn, { centralDb: { getSignupMode: vi.fn(async (): Promise<'open'> => 'open') } })
    const res = await supertest(app).post('/webauthn/signup/options').send({ username: 'admin' })
    expect(res.status).toBe(400)
    expect(webAuthn.getSignupOptions).not.toHaveBeenCalled()
  })

  test('409 when username already exists', async () => {
    vi.mocked(dbIndex.query).mockResolvedValue({ rowCount: 1, rows: [{ usename: 'alice' }] } as never)
    const webAuthn: Partial<WebAuthnService> = {
      getSignupOptions: vi.fn(async () => ({ challenge: 'c' }) as never),
    }
    const app = buildApp(webAuthn, { centralDb: { getSignupMode: vi.fn(async (): Promise<'open'> => 'open') } })
    const res = await supertest(app).post('/webauthn/signup/options').send({ username: 'alice' })
    expect(res.status).toBe(409)
    expect(webAuthn.getSignupOptions).not.toHaveBeenCalled()
  })

  test('200 with options_json on success', async () => {
    vi.mocked(dbIndex.query).mockResolvedValue({ rowCount: 0, rows: [] } as never)
    const webAuthn: Partial<WebAuthnService> = {
      getSignupOptions: vi.fn(async () => ({ challenge: 'sign-c' }) as never),
    }
    const app = buildApp(webAuthn, { centralDb: { getSignupMode: vi.fn(async (): Promise<'open'> => 'open') } })
    const res = await supertest(app).post('/webauthn/signup/options').send({ username: 'alice' })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body.options_json)).toEqual({ challenge: 'sign-c' })
    expect(webAuthn.getSignupOptions).toHaveBeenCalledWith('alice', expect.any(String))
  })
})

describe('POST /webauthn/signup/verify', () => {
  test('400 on invalid response_json', async () => {
    const app = buildApp({})
    const res = await supertest(app)
      .post('/webauthn/signup/verify')
      .send({ username: 'alice', response_json: 'nope' })
    expect(res.status).toBe(400)
  })

  test('400 with generic message when service rejects', async () => {
    const webAuthn: Partial<WebAuthnService> = {
      verifySignup: vi.fn(async () => ({ verified: false })),
    }
    const app = buildApp(webAuthn)
    const res = await supertest(app)
      .post('/webauthn/signup/verify')
      .send({ username: 'alice', response_json: '{}' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Verification failed')
  })

  test('200 happy path: token issued, no password ever leaves the server', async () => {
    const webAuthn: Partial<WebAuthnService> = {
      verifySignup: vi.fn(async () => ({
        credential: {
          backedUp: true,
          counter: 0,
          credentialId: 'cred-1',
          deviceType: 'multiDevice',
          publicKey: Buffer.from([1]),
          transports: ['internal'],
        },
        userHandleUuid: '11111111-1111-1111-1111-111111111111',
        verified: true,
      })),
    }
    const insertHandle = vi.fn(async () => {})
    const addAdmin = vi.fn(async () => {})
    const app = buildApp(webAuthn, {
      auth: { createToken: vi.fn(() => 'fresh-token') },
      centralDb: {
        addAdmin,
        getAdminCount: vi.fn(async () => 0),
        insertWebAuthnUserHandle: insertHandle,
        isAdmin: vi.fn(async () => false),
      },
    })
    const res = await supertest(app)
      .post('/webauthn/signup/verify')
      .send({ username: 'alice', response_json: '{}' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      is_admin: true,
      success: true,
      token: 'fresh-token',
      username: 'alice',
      verified: true,
    })

    expect(insertHandle).toHaveBeenCalledWith('alice', '11111111-1111-1111-1111-111111111111')
    expect(dbIndex.makeNewUserDb).toHaveBeenCalledWith(expect.anything(), 'alice', expect.any(String))
    expect(webauthnDb.insertWebAuthnCredential).toHaveBeenCalledWith(
      'alice',
      expect.objectContaining({ credentialId: 'cred-1' }),
    )
    // The wire payload must not include the random password we generated.
    expect(JSON.stringify(res.body)).not.toMatch(/password/i)
    expect(addAdmin).toHaveBeenCalledWith('alice')
  })

  test('rolls back when credential persistence fails', async () => {
    const webAuthn: Partial<WebAuthnService> = {
      verifySignup: vi.fn(async () => ({
        credential: {
          backedUp: false,
          counter: 0,
          credentialId: 'cred-2',
          deviceType: 'singleDevice',
          publicKey: Buffer.from([1]),
          transports: [],
        },
        userHandleUuid: '22222222-2222-2222-2222-222222222222',
        verified: true,
      })),
    }
    vi.mocked(webauthnDb.insertWebAuthnCredential).mockRejectedValueOnce(new Error('boom'))

    const insertHandle = vi.fn(async () => {})
    const deleteHandle = vi.fn(async () => {})
    const app = buildApp(webAuthn, {
      centralDb: {
        getAdminCount: vi.fn(async () => 1),
        insertWebAuthnUserHandle: insertHandle,
        deleteWebAuthnUserHandle: deleteHandle,
        isAdmin: vi.fn(async () => false),
      },
    })
    const res = await supertest(app)
      .post('/webauthn/signup/verify')
      .send({ username: 'bob', response_json: '{}' })

    expect(res.status).toBe(500)
    expect(dbIndex.dropUserDb).toHaveBeenCalledWith(expect.anything(), 'bob')
    expect(deleteHandle).toHaveBeenCalledWith('bob')
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
