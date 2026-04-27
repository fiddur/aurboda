import * as simplewebauthn from '@simplewebauthn/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as webauthnDb from '../db/webauthn.ts'
import { createWebAuthnService, type UserHandleStore } from './webauthn.ts'

vi.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: vi.fn(),
  generateRegistrationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
}))

vi.mock('../db/webauthn.ts', () => ({
  deleteWebAuthnCredential: vi.fn(),
  getWebAuthnCredentialById: vi.fn(),
  getWebAuthnCredentialsForUser: vi.fn(),
  insertWebAuthnCredential: vi.fn(),
  updateWebAuthnCredentialNickname: vi.fn(),
  updateWebAuthnCredentialUsage: vi.fn(),
}))

const config = {
  expectedOrigins: ['https://example.test'],
  rpID: 'example.test',
  rpName: 'Aurboda Test',
}

const ALICE_HANDLE = '11111111-2222-3333-4444-555555555555'

const makeUserHandleStore = (): UserHandleStore => ({
  getOrCreateWebAuthnUserHandle: vi.fn(async (username: string) => {
    if (username === 'alice') return ALICE_HANDLE
    if (username === 'bob') return '99999999-8888-7777-6666-555555555555'
    throw new Error('unknown user')
  }),
  getUsernameByWebAuthnUserHandle: vi.fn(async (handle: string) => {
    if (handle === ALICE_HANDLE) return 'alice'
    return null
  }),
})

const handleAsBase64Url = (uuid: string): string => {
  const hex = uuid.replaceAll('-', '')
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return Buffer.from(bytes).toString('base64url')
}

const makeClientDataJSON = (challenge: string): string =>
  Buffer.from(JSON.stringify({ challenge, origin: 'https://example.test', type: 'webauthn.get' })).toString(
    'base64url',
  )

beforeEach(() => {
  vi.clearAllMocks()
})

describe('registration', () => {
  test('generates options with the user handle, persists credential on verify', async () => {
    const handleStore = makeUserHandleStore()
    const service = createWebAuthnService(config, handleStore)

    vi.mocked(webauthnDb.getWebAuthnCredentialsForUser).mockResolvedValue([])
    vi.mocked(simplewebauthn.generateRegistrationOptions).mockResolvedValue({
      challenge: 'reg-challenge-1',
    } as never)

    const options = await service.getRegistrationOptions('alice')
    expect(options.challenge).toBe('reg-challenge-1')
    expect(handleStore.getOrCreateWebAuthnUserHandle).toHaveBeenCalledWith('alice')
    const call = vi.mocked(simplewebauthn.generateRegistrationOptions).mock.calls[0]![0]
    expect(call.userName).toBe('alice')
    expect(call.userID).toBeInstanceOf(Uint8Array)
    expect((call.userID as Uint8Array).length).toBe(16)

    vi.mocked(simplewebauthn.verifyRegistrationResponse).mockResolvedValue({
      registrationInfo: {
        credential: {
          counter: 0,
          id: 'cred-id-1',
          publicKey: new Uint8Array([1, 2, 3]),
          transports: ['internal'],
        },
        credentialBackedUp: true,
        credentialDeviceType: 'multiDevice',
      },
      verified: true,
    } as never)

    const result = await service.verifyRegistration('alice', { id: 'cred-id-1' } as never, 'My Phone')
    expect(result).toEqual({ credentialId: 'cred-id-1', verified: true })
    expect(webauthnDb.insertWebAuthnCredential).toHaveBeenCalledWith(
      'alice',
      expect.objectContaining({
        backedUp: true,
        credentialId: 'cred-id-1',
        deviceType: 'multiDevice',
        nickname: 'My Phone',
        transports: ['internal'],
      }),
    )
  })

  test('rejects verify when no pending registration', async () => {
    const service = createWebAuthnService(config, makeUserHandleStore())
    const result = await service.verifyRegistration('alice', {} as never)
    expect(result).toEqual({ verified: false })
    expect(webauthnDb.insertWebAuthnCredential).not.toHaveBeenCalled()
  })

  test('rejects verify when verification fails', async () => {
    const service = createWebAuthnService(config, makeUserHandleStore())
    vi.mocked(webauthnDb.getWebAuthnCredentialsForUser).mockResolvedValue([])
    vi.mocked(simplewebauthn.generateRegistrationOptions).mockResolvedValue({
      challenge: 'c',
    } as never)
    await service.getRegistrationOptions('alice')

    vi.mocked(simplewebauthn.verifyRegistrationResponse).mockResolvedValue({ verified: false } as never)
    const result = await service.verifyRegistration('alice', {} as never)
    expect(result).toEqual({ verified: false })
    expect(webauthnDb.insertWebAuthnCredential).not.toHaveBeenCalled()
  })
})

describe('authentication', () => {
  test('always returns options with no allowCredentials (discoverable)', async () => {
    const service = createWebAuthnService(config, makeUserHandleStore())

    vi.mocked(simplewebauthn.generateAuthenticationOptions).mockResolvedValue({
      challenge: 'auth-challenge-1',
    } as never)
    const opts = await service.getAuthenticationOptions()
    expect(opts.challenge).toBe('auth-challenge-1')
    const call = vi.mocked(simplewebauthn.generateAuthenticationOptions).mock.calls[0]![0]
    expect(call.allowCredentials).toBeUndefined()
    expect(call.rpID).toBe('example.test')
  })

  test('verify resolves user from userHandle, updates counter', async () => {
    const handleStore = makeUserHandleStore()
    const service = createWebAuthnService(config, handleStore)
    vi.mocked(simplewebauthn.generateAuthenticationOptions).mockResolvedValue({
      challenge: 'auth-challenge-2',
    } as never)
    await service.getAuthenticationOptions()

    vi.mocked(webauthnDb.getWebAuthnCredentialById).mockResolvedValue({
      backed_up: true,
      counter: 5,
      created_at: new Date(),
      credential_id: 'cred-id-1',
      device_type: 'multiDevice',
      last_used_at: null,
      nickname: null,
      public_key: Buffer.from([1, 2, 3]),
      transports: ['internal'],
    })
    vi.mocked(simplewebauthn.verifyAuthenticationResponse).mockResolvedValue({
      authenticationInfo: { newCounter: 6 },
      verified: true,
    } as never)
    vi.mocked(webauthnDb.updateWebAuthnCredentialUsage).mockResolvedValue(true)

    const result = await service.verifyAuthentication({
      id: 'cred-id-1',
      response: {
        clientDataJSON: makeClientDataJSON('auth-challenge-2'),
        userHandle: handleAsBase64Url(ALICE_HANDLE),
      },
    } as never)

    expect(result).toEqual({ user: 'alice', verified: true })
    expect(handleStore.getUsernameByWebAuthnUserHandle).toHaveBeenCalledWith(ALICE_HANDLE)
    expect(webauthnDb.getWebAuthnCredentialById).toHaveBeenCalledWith('alice', 'cred-id-1')
    expect(webauthnDb.updateWebAuthnCredentialUsage).toHaveBeenCalledWith('alice', 'cred-id-1', 5, 6)
  })

  test('rejects when challenge does not match a pending one', async () => {
    const service = createWebAuthnService(config, makeUserHandleStore())
    const result = await service.verifyAuthentication({
      id: 'cred-id-1',
      response: { clientDataJSON: makeClientDataJSON('unknown') },
    } as never)
    expect(result).toEqual({ verified: false })
  })

  test('rejects when userHandle is missing', async () => {
    const service = createWebAuthnService(config, makeUserHandleStore())
    vi.mocked(simplewebauthn.generateAuthenticationOptions).mockResolvedValue({
      challenge: 'c-no-handle',
    } as never)
    await service.getAuthenticationOptions()

    const result = await service.verifyAuthentication({
      id: 'cred-id-1',
      response: { clientDataJSON: makeClientDataJSON('c-no-handle') },
    } as never)
    expect(result).toEqual({ verified: false })
  })

  test('rejects when handle does not map to a user', async () => {
    const service = createWebAuthnService(config, makeUserHandleStore())
    vi.mocked(simplewebauthn.generateAuthenticationOptions).mockResolvedValue({
      challenge: 'c-unknown-handle',
    } as never)
    await service.getAuthenticationOptions()

    const result = await service.verifyAuthentication({
      id: 'cred-id-1',
      response: {
        clientDataJSON: makeClientDataJSON('c-unknown-handle'),
        userHandle: handleAsBase64Url('00000000-0000-0000-0000-000000000000'),
      },
    } as never)
    expect(result).toEqual({ verified: false })
    expect(webauthnDb.getWebAuthnCredentialById).not.toHaveBeenCalled()
  })

  test('rejects when credential not found in user db', async () => {
    const service = createWebAuthnService(config, makeUserHandleStore())
    vi.mocked(simplewebauthn.generateAuthenticationOptions).mockResolvedValue({
      challenge: 'c2',
    } as never)
    await service.getAuthenticationOptions()

    vi.mocked(webauthnDb.getWebAuthnCredentialById).mockResolvedValue(null)
    const result = await service.verifyAuthentication({
      id: 'missing',
      response: {
        clientDataJSON: makeClientDataJSON('c2'),
        userHandle: handleAsBase64Url(ALICE_HANDLE),
      },
    } as never)
    expect(result).toEqual({ verified: false })
    expect(simplewebauthn.verifyAuthenticationResponse).not.toHaveBeenCalled()
  })
})

describe('credential management', () => {
  test('listCredentials maps rows', async () => {
    const service = createWebAuthnService(config, makeUserHandleStore())
    const created = new Date('2025-01-01T00:00:00Z')
    vi.mocked(webauthnDb.getWebAuthnCredentialsForUser).mockResolvedValue([
      {
        backed_up: false,
        counter: 0,
        created_at: created,
        credential_id: 'id1',
        device_type: 'singleDevice',
        last_used_at: null,
        nickname: 'Yubi',
        public_key: Buffer.from([]),
        transports: ['usb'],
      },
    ])
    const list = await service.listCredentials('alice')
    expect(list).toEqual([
      {
        backed_up: false,
        created_at: '2025-01-01T00:00:00.000Z',
        credential_id: 'id1',
        device_type: 'singleDevice',
        last_used_at: null,
        nickname: 'Yubi',
        transports: ['usb'],
      },
    ])
  })

  test('rename + delete delegate to db', async () => {
    const service = createWebAuthnService(config, makeUserHandleStore())
    vi.mocked(webauthnDb.updateWebAuthnCredentialNickname).mockResolvedValue(true)
    vi.mocked(webauthnDb.deleteWebAuthnCredential).mockResolvedValue(true)

    expect(await service.renameCredential('alice', 'id', 'New')).toBe(true)
    expect(webauthnDb.updateWebAuthnCredentialNickname).toHaveBeenCalledWith('alice', 'id', 'New')

    expect(await service.deleteCredential('alice', 'id')).toBe(true)
    expect(webauthnDb.deleteWebAuthnCredential).toHaveBeenCalledWith('alice', 'id')
  })
})
