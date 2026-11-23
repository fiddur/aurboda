import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { CentralDb, OAuthAuthorizationCode, OAuthClient, OAuthToken } from './central-db.ts'

import {
  createAuthorizationCode,
  exchangeAuthorizationCode,
  isOAuthAccessToken,
  refreshAccessToken,
  registerClient,
  validateAccessToken,
} from './oauth.ts'

const createMockCentralDb = () =>
  ({
    createOAuthClient: vi.fn(),
    getOAuthClient: vi.fn(),
    saveAuthorizationCode: vi.fn(),
    consumeAuthorizationCode: vi.fn(),
    saveOAuthToken: vi.fn(),
    getOAuthToken: vi.fn(),
    revokeOAuthToken: vi.fn(),
    cleanupExpiredOAuth: vi.fn(),
  }) as unknown as CentralDb & {
    createOAuthClient: ReturnType<typeof vi.fn>
    getOAuthClient: ReturnType<typeof vi.fn>
    saveAuthorizationCode: ReturnType<typeof vi.fn>
    consumeAuthorizationCode: ReturnType<typeof vi.fn>
    saveOAuthToken: ReturnType<typeof vi.fn>
    getOAuthToken: ReturnType<typeof vi.fn>
    revokeOAuthToken: ReturnType<typeof vi.fn>
    cleanupExpiredOAuth: ReturnType<typeof vi.fn>
  }

const makePkce = () => {
  const verifier = 'test-code-verifier-that-is-long-enough'
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

describe('oauth service', () => {
  let mockDb: ReturnType<typeof createMockCentralDb>
  let deps: { centralDb: CentralDb }

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb = createMockCentralDb()
    deps = { centralDb: mockDb }
  })

  describe('registerClient', () => {
    test('creates client with generated client_id', async () => {
      const result = await registerClient(deps, {
        client_name: 'Test Client',
        redirect_uris: ['https://example.com/callback'],
      })

      expect(result.client_id).toMatch(/^aur_/)
      expect(result.client_name).toBe('Test Client')
      expect(result.redirect_uris).toEqual(['https://example.com/callback'])
      expect(result.token_endpoint_auth_method).toBe('none')
      expect(mockDb.createOAuthClient).toHaveBeenCalledWith(
        expect.objectContaining({ client_name: 'Test Client' }),
      )
    })
  })

  describe('createAuthorizationCode', () => {
    test('generates code for valid client and redirect_uri', async () => {
      const client: OAuthClient = {
        client_id: 'aur_test',
        client_name: 'Test',
        redirect_uris: ['https://example.com/cb'],
        token_endpoint_auth_method: 'none',
        created_at: new Date(),
      }
      mockDb.getOAuthClient.mockResolvedValue(client)

      const pkce = makePkce()
      const code = await createAuthorizationCode(deps, {
        client_id: 'aur_test',
        username: 'testuser',
        redirect_uri: 'https://example.com/cb',
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
      })

      expect(typeof code).toBe('string')
      expect(code.length).toBeGreaterThan(20)
      expect(mockDb.saveAuthorizationCode).toHaveBeenCalledWith(
        expect.objectContaining({
          client_id: 'aur_test',
          username: 'testuser',
          code_challenge: pkce.challenge,
        }),
      )
    })

    test('rejects unknown client_id', async () => {
      mockDb.getOAuthClient.mockResolvedValue(null)

      await expect(
        createAuthorizationCode(deps, {
          client_id: 'unknown',
          username: 'testuser',
          redirect_uri: 'https://example.com/cb',
          code_challenge: 'abc',
          code_challenge_method: 'S256',
        }),
      ).rejects.toThrow('Unknown client_id')
    })

    test('rejects invalid redirect_uri', async () => {
      mockDb.getOAuthClient.mockResolvedValue({
        client_id: 'aur_test',
        client_name: 'Test',
        redirect_uris: ['https://example.com/cb'],
        token_endpoint_auth_method: 'none',
        created_at: new Date(),
      })

      await expect(
        createAuthorizationCode(deps, {
          client_id: 'aur_test',
          username: 'testuser',
          redirect_uri: 'https://evil.com/cb',
          code_challenge: 'abc',
          code_challenge_method: 'S256',
        }),
      ).rejects.toThrow('Invalid redirect_uri')
    })

    test('rejects non-S256 code_challenge_method', async () => {
      mockDb.getOAuthClient.mockResolvedValue({
        client_id: 'aur_test',
        client_name: 'Test',
        redirect_uris: ['https://example.com/cb'],
        token_endpoint_auth_method: 'none',
        created_at: new Date(),
      })

      await expect(
        createAuthorizationCode(deps, {
          client_id: 'aur_test',
          username: 'testuser',
          redirect_uri: 'https://example.com/cb',
          code_challenge: 'abc',
          code_challenge_method: 'plain',
        }),
      ).rejects.toThrow('Only S256')
    })
  })

  describe('exchangeAuthorizationCode', () => {
    test('exchanges valid code for tokens', async () => {
      const pkce = makePkce()
      const authCode: OAuthAuthorizationCode = {
        code: 'test-code',
        client_id: 'aur_test',
        username: 'testuser',
        redirect_uri: 'https://example.com/cb',
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        expires_at: new Date(Date.now() + 600_000),
        used: true,
      }
      mockDb.consumeAuthorizationCode.mockResolvedValue(authCode)

      const result = await exchangeAuthorizationCode(deps, {
        code: 'test-code',
        client_id: 'aur_test',
        redirect_uri: 'https://example.com/cb',
        code_verifier: pkce.verifier,
      })

      expect(result.access_token).toMatch(/^aur_at_/)
      expect(result.refresh_token).toMatch(/^aur_rt_/)
      expect(result.token_type).toBe('bearer')
      expect(result.expires_in).toBe(3600)
      expect(mockDb.saveOAuthToken).toHaveBeenCalledTimes(2)
    })

    test('rejects invalid code', async () => {
      mockDb.consumeAuthorizationCode.mockResolvedValue(null)

      await expect(
        exchangeAuthorizationCode(deps, {
          code: 'invalid',
          client_id: 'aur_test',
          redirect_uri: 'https://example.com/cb',
          code_verifier: 'anything',
        }),
      ).rejects.toThrow('Invalid or expired authorization code')
    })

    test('rejects client_id mismatch', async () => {
      const pkce = makePkce()
      mockDb.consumeAuthorizationCode.mockResolvedValue({
        code: 'test-code',
        client_id: 'aur_other',
        username: 'testuser',
        redirect_uri: 'https://example.com/cb',
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        expires_at: new Date(Date.now() + 600_000),
        used: true,
      })

      await expect(
        exchangeAuthorizationCode(deps, {
          code: 'test-code',
          client_id: 'aur_test',
          redirect_uri: 'https://example.com/cb',
          code_verifier: pkce.verifier,
        }),
      ).rejects.toThrow('client_id mismatch')
    })

    test('rejects bad PKCE verifier', async () => {
      const pkce = makePkce()
      mockDb.consumeAuthorizationCode.mockResolvedValue({
        code: 'test-code',
        client_id: 'aur_test',
        username: 'testuser',
        redirect_uri: 'https://example.com/cb',
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        expires_at: new Date(Date.now() + 600_000),
        used: true,
      })

      await expect(
        exchangeAuthorizationCode(deps, {
          code: 'test-code',
          client_id: 'aur_test',
          redirect_uri: 'https://example.com/cb',
          code_verifier: 'wrong-verifier',
        }),
      ).rejects.toThrow('PKCE verification failed')
    })
  })

  describe('refreshAccessToken', () => {
    test('rotates tokens on valid refresh', async () => {
      const oldRefresh: OAuthToken = {
        token: 'aur_rt_old',
        token_type: 'refresh',
        client_id: 'aur_test',
        username: 'testuser',
        expires_at: new Date(Date.now() + 86400_000),
        revoked: false,
        parent_token: 'aur_at_old',
        created_at: new Date(),
      }
      mockDb.getOAuthToken.mockResolvedValue(oldRefresh)

      const result = await refreshAccessToken(deps, {
        refresh_token: 'aur_rt_old',
        client_id: 'aur_test',
      })

      expect(result.access_token).toMatch(/^aur_at_/)
      expect(result.refresh_token).toMatch(/^aur_rt_/)
      expect(mockDb.revokeOAuthToken).toHaveBeenCalledWith('aur_rt_old')
      expect(mockDb.revokeOAuthToken).toHaveBeenCalledWith('aur_at_old')
      expect(mockDb.saveOAuthToken).toHaveBeenCalledTimes(2)
    })

    test('rejects invalid refresh token', async () => {
      mockDb.getOAuthToken.mockResolvedValue(null)

      await expect(
        refreshAccessToken(deps, { refresh_token: 'invalid', client_id: 'aur_test' }),
      ).rejects.toThrow('Invalid or expired refresh token')
    })

    test('rejects client_id mismatch', async () => {
      mockDb.getOAuthToken.mockResolvedValue({
        token: 'aur_rt_old',
        token_type: 'refresh',
        client_id: 'aur_other',
        username: 'testuser',
        expires_at: new Date(Date.now() + 86400_000),
        revoked: false,
        parent_token: null,
        created_at: new Date(),
      })

      await expect(
        refreshAccessToken(deps, { refresh_token: 'aur_rt_old', client_id: 'aur_test' }),
      ).rejects.toThrow('client_id mismatch')
    })
  })

  describe('validateAccessToken', () => {
    test('returns username for valid access token', async () => {
      mockDb.getOAuthToken.mockResolvedValue({
        token: 'aur_at_test',
        token_type: 'access',
        client_id: 'aur_test',
        username: 'testuser',
        expires_at: new Date(Date.now() + 3600_000),
        revoked: false,
        parent_token: null,
        created_at: new Date(),
      })

      const result = await validateAccessToken(deps, 'aur_at_test')

      expect(result).toBe('testuser')
    })

    test('returns null for invalid token', async () => {
      mockDb.getOAuthToken.mockResolvedValue(null)

      const result = await validateAccessToken(deps, 'invalid')

      expect(result).toBeNull()
    })

    test('returns null for refresh token', async () => {
      mockDb.getOAuthToken.mockResolvedValue({
        token: 'aur_rt_test',
        token_type: 'refresh',
        client_id: 'aur_test',
        username: 'testuser',
        expires_at: new Date(Date.now() + 86400_000),
        revoked: false,
        parent_token: null,
        created_at: new Date(),
      })

      const result = await validateAccessToken(deps, 'aur_rt_test')

      expect(result).toBeNull()
    })
  })

  describe('isOAuthAccessToken', () => {
    test('returns true for aur_at_ prefix', () => {
      expect(isOAuthAccessToken('aur_at_something')).toBe(true)
    })

    test('returns false for AES token', () => {
      expect(isOAuthAccessToken('abc123-def456-ghi789')).toBe(false)
    })

    test('returns false for refresh token', () => {
      expect(isOAuthAccessToken('aur_rt_something')).toBe(false)
    })
  })
})
