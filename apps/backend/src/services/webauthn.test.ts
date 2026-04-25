import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as simplewebauthn from '@simplewebauthn/server'

import * as webauthnDb from '../db/webauthn.ts'
import { createWebAuthnService } from './webauthn.ts'

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

const makeClientDataJSON = (challenge: string): string =>
  Buffer.from(JSON.stringify({ challenge, origin: 'https://example.test', type: 'webauthn.get' })).toString(
    'base64url',
  )

beforeEach(() => {
  vi.clearAllMocks()
})

describe('registration', () => {
  test('generates options, stores challenge, persists credential on verify', async () => {
    const service = createWebAuthnService(config)

    vi.mocked(webauthnDb.getWebAuthnCredentialsForUser).mockResolvedValue([])
    vi.mocked(simplewebauthn.generateRegistrationOptions).mockResolvedValue({
      challenge: 'reg-challenge-1',
      rp: { id: 'example.test', name: 'Aurboda Test' },
      user: { displayName: 'alice', id: 'YWxpY2U', name: 'alice' },
      pubKeyCredParams: [],
    } as never)

    const options = await service.getRegistrationOptions('alice')
    expect(options.challenge).toBe('reg-challenge-1')
    expect(simplewebauthn.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        rpID: 'example.test',
        rpName: 'Aurboda Test',
        userName: 'alice',
      }),
    )

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
    const service = createWebAuthnService(config)
    const result = await service.verifyRegistration('alice', {} as never)
    expect(result).toEqual({ verified: false })
    expect(webauthnDb.insertWebAuthnCredential).not.toHaveBeenCalled()
  })

  test('rejects verify when verification fails', async () => {
    const service = createWebAuthnService(config)
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
  test('discoverable flow: identifies user from userHandle', async () => {
    const service = createWebAuthnService(config)

    vi.mocked(simplewebauthn.generateAuthenticationOptions).mockResolvedValue({
      challenge: 'auth-challenge-1',
    } as never)
    const opts = await service.getAuthenticationOptions()
    expect(opts.challenge).toBe('auth-challenge-1')
    expect(simplewebauthn.generateAuthenticationOptions).toHaveBeenCalledWith(
      expect.objectContaining({ allowCredentials: undefined, rpID: 'example.test' }),
    )

    vi.mocked(webauthnDb.getWebAuthnCredentialById).mockResolvedValue({
      backed_up: true,
      counter: 0,
      created_at: new Date(),
      credential_id: 'cred-id-1',
      device_type: 'multiDevice',
      last_used_at: null,
      nickname: null,
      public_key: Buffer.from([1, 2, 3]),
      transports: ['internal'],
    })
    vi.mocked(simplewebauthn.verifyAuthenticationResponse).mockResolvedValue({
      authenticationInfo: { newCounter: 1 },
      verified: true,
    } as never)

    const userHandleB64 = Buffer.from('alice').toString('base64url')
    const result = await service.verifyAuthentication({
      id: 'cred-id-1',
      response: {
        clientDataJSON: makeClientDataJSON('auth-challenge-1'),
        userHandle: userHandleB64,
      },
    } as never)

    expect(result).toEqual({ user: 'alice', verified: true })
    expect(webauthnDb.getWebAuthnCredentialById).toHaveBeenCalledWith('alice', 'cred-id-1')
    expect(webauthnDb.updateWebAuthnCredentialUsage).toHaveBeenCalledWith('alice', 'cred-id-1', 1)
  })

  test('rejects when challenge does not match a pending one', async () => {
    const service = createWebAuthnService(config)
    const result = await service.verifyAuthentication({
      id: 'cred-id-1',
      response: { clientDataJSON: makeClientDataJSON('unknown') },
    } as never)
    expect(result).toEqual({ verified: false })
  })

  test('rejects when credential not found in user db', async () => {
    const service = createWebAuthnService(config)
    vi.mocked(simplewebauthn.generateAuthenticationOptions).mockResolvedValue({
      challenge: 'c2',
    } as never)
    await service.getAuthenticationOptions('alice')

    vi.mocked(webauthnDb.getWebAuthnCredentialById).mockResolvedValue(null)
    const result = await service.verifyAuthentication({
      id: 'missing',
      response: { clientDataJSON: makeClientDataJSON('c2'), userHandle: Buffer.from('alice').toString('base64url') },
    } as never)
    expect(result).toEqual({ verified: false })
    expect(simplewebauthn.verifyAuthenticationResponse).not.toHaveBeenCalled()
  })

  test('typed-username flow includes allowCredentials', async () => {
    const service = createWebAuthnService(config)
    vi.mocked(webauthnDb.getWebAuthnCredentialsForUser).mockResolvedValue([
      {
        backed_up: false,
        counter: 0,
        created_at: new Date(),
        credential_id: 'a',
        device_type: null,
        last_used_at: null,
        nickname: null,
        public_key: Buffer.from([]),
        transports: ['usb'],
      },
    ])
    vi.mocked(simplewebauthn.generateAuthenticationOptions).mockResolvedValue({ challenge: 'x' } as never)

    await service.getAuthenticationOptions('bob')
    expect(simplewebauthn.generateAuthenticationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        allowCredentials: [{ id: 'a', transports: ['usb'] }],
      }),
    )
  })
})

describe('credential management', () => {
  test('listCredentials maps rows', async () => {
    const service = createWebAuthnService(config)
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
    const service = createWebAuthnService(config)
    vi.mocked(webauthnDb.updateWebAuthnCredentialNickname).mockResolvedValue(true)
    vi.mocked(webauthnDb.deleteWebAuthnCredential).mockResolvedValue(true)

    expect(await service.renameCredential('alice', 'id', 'New')).toBe(true)
    expect(webauthnDb.updateWebAuthnCredentialNickname).toHaveBeenCalledWith('alice', 'id', 'New')

    expect(await service.deleteCredential('alice', 'id')).toBe(true)
    expect(webauthnDb.deleteWebAuthnCredential).toHaveBeenCalledWith('alice', 'id')
  })
})
