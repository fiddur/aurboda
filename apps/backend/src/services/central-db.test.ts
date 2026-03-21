import type pg from 'pg'

import { beforeEach, describe, expect, test, vi } from 'vitest'

import { createCentralDb, type CentralDb, type SignupMode } from './central-db.ts'

// Mock pg.Client
vi.mock('pg', () => {
  const mockQuery = vi.fn()
  const MockClient = vi.fn(() => ({
    connect: vi.fn(),
    end: vi.fn(),
    query: mockQuery,
  }))
  return { Client: MockClient, default: { Client: MockClient } }
})

describe('central-db', () => {
  let mockClient: {
    connect: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
    query: ReturnType<typeof vi.fn>
  }
  let centralDb: CentralDb

  beforeEach(() => {
    vi.clearAllMocks()
    mockClient = {
      connect: vi.fn(),
      end: vi.fn(),
      query: vi.fn(),
    }
    centralDb = createCentralDb({ getClient: async () => mockClient as unknown as pg.Client })
  })

  describe('initializeCentralDb', () => {
    test('creates tables and sets default signup_mode', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      await centralDb.initializeCentralDb()

      // Should create server_settings table
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS server_settings'),
      )
      // Should create admins table
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS admins'),
      )
      // Should insert default signup_mode (third call, no params array)
      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO server_settings'))
    })
  })

  describe('getLastFmApiKey', () => {
    test('returns API key when set', async () => {
      mockClient.query.mockResolvedValue({ rows: [{ value: 'test-api-key' }] })

      const result = await centralDb.getLastFmApiKey()

      expect(result).toBe('test-api-key')
      expect(mockClient.query).toHaveBeenCalledWith('SELECT value FROM server_settings WHERE key = $1', [
        'lastfm_api_key',
      ])
    })

    test('returns null when not set', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      const result = await centralDb.getLastFmApiKey()

      expect(result).toBeNull()
    })
  })

  describe('setLastFmApiKey', () => {
    test('stores API key', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      await centralDb.setLastFmApiKey('my-api-key')

      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO server_settings'), [
        JSON.stringify('my-api-key'),
      ])
    })

    test('deletes key when set to null', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      await centralDb.setLastFmApiKey(null)

      expect(mockClient.query).toHaveBeenCalledWith('DELETE FROM server_settings WHERE key = $1', [
        'lastfm_api_key',
      ])
    })
  })

  describe('getServerSetting', () => {
    test('returns setting value when found', async () => {
      mockClient.query.mockResolvedValue({ rows: [{ value: 'invite_only' }] })

      const result = await centralDb.getServerSetting('signup_mode')

      expect(result).toBe('invite_only')
      expect(mockClient.query).toHaveBeenCalledWith('SELECT value FROM server_settings WHERE key = $1', [
        'signup_mode',
      ])
    })

    test('returns null when setting not found', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      const result = await centralDb.getServerSetting('signup_mode')

      expect(result).toBeNull()
    })
  })

  describe('setServerSetting', () => {
    test('upserts setting value', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      await centralDb.setServerSetting('signup_mode', 'closed')

      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO server_settings'), [
        'signup_mode',
        '"closed"',
      ])
    })
  })

  describe('getSignupMode', () => {
    test('returns signup mode when found', async () => {
      mockClient.query.mockResolvedValue({ rows: [{ value: 'invite_only' }] })

      const result = await centralDb.getSignupMode()

      expect(result).toBe('invite_only')
    })

    test('returns "open" when no setting exists', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      const result = await centralDb.getSignupMode()

      expect(result).toBe('open')
    })
  })

  describe('setSignupMode', () => {
    test('sets signup mode', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      await centralDb.setSignupMode('invite_only')

      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO server_settings'), [
        '"invite_only"',
      ])
    })

    test.each(['open', 'invite_only', 'closed'] as SignupMode[])('accepts valid mode: %s', async (mode) => {
      mockClient.query.mockResolvedValue({ rows: [] })

      await expect(centralDb.setSignupMode(mode)).resolves.not.toThrow()
    })
  })

  describe('isAdmin', () => {
    test('returns true when user is admin', async () => {
      mockClient.query.mockResolvedValue({ rows: [{ username: 'admin' }] })

      const result = await centralDb.isAdmin('admin')

      expect(result).toBe(true)
      expect(mockClient.query).toHaveBeenCalledWith('SELECT 1 FROM admins WHERE username = $1', ['admin'])
    })

    test('returns false when user is not admin', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      const result = await centralDb.isAdmin('user')

      expect(result).toBe(false)
    })
  })

  describe('addAdmin', () => {
    test('inserts admin user', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      await centralDb.addAdmin('newadmin')

      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO admins'), [
        'newadmin',
      ])
    })

    test('handles duplicate admin gracefully', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      await expect(centralDb.addAdmin('existingadmin')).resolves.not.toThrow()
    })
  })

  describe('removeAdmin', () => {
    test('returns true when admin removed', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 1 })

      const result = await centralDb.removeAdmin('admin')

      expect(result).toBe(true)
      expect(mockClient.query).toHaveBeenCalledWith('DELETE FROM admins WHERE username = $1', ['admin'])
    })

    test('returns false when admin not found', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 0 })

      const result = await centralDb.removeAdmin('nonexistent')

      expect(result).toBe(false)
    })
  })

  describe('getAdminCount', () => {
    test('returns count of admins', async () => {
      mockClient.query.mockResolvedValue({ rows: [{ count: 3 }] })

      const result = await centralDb.getAdminCount()

      expect(result).toBe(3)
      expect(mockClient.query).toHaveBeenCalledWith('SELECT COUNT(*)::integer as count FROM admins')
    })

    test('returns 0 when no admins', async () => {
      mockClient.query.mockResolvedValue({ rows: [{ count: 0 }] })

      const result = await centralDb.getAdminCount()

      expect(result).toBe(0)
    })
  })

  describe('getAdmins', () => {
    test('returns list of admin usernames', async () => {
      mockClient.query.mockResolvedValue({
        rows: [{ username: 'admin1' }, { username: 'admin2' }],
      })

      const result = await centralDb.getAdmins()

      expect(result).toEqual(['admin1', 'admin2'])
      expect(mockClient.query).toHaveBeenCalledWith('SELECT username FROM admins ORDER BY created_at')
    })

    test('returns empty array when no admins', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      const result = await centralDb.getAdmins()

      expect(result).toEqual([])
    })
  })

  describe('getOuraWebhookEnabled', () => {
    test('returns true when enabled', async () => {
      mockClient.query.mockResolvedValue({ rows: [{ value: true }] })

      const result = await centralDb.getOuraWebhookEnabled()

      expect(result).toBe(true)
      expect(mockClient.query).toHaveBeenCalledWith('SELECT value FROM server_settings WHERE key = $1', [
        'oura_webhook_enabled',
      ])
    })

    test('returns false when not set', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      const result = await centralDb.getOuraWebhookEnabled()

      expect(result).toBe(false)
    })
  })

  describe('setOuraWebhookEnabled', () => {
    test('stores enabled state', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      await centralDb.setOuraWebhookEnabled(true)

      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO server_settings'), [
        JSON.stringify(true),
      ])
    })

    test('stores disabled state', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      await centralDb.setOuraWebhookEnabled(false)

      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO server_settings'), [
        JSON.stringify(false),
      ])
    })
  })

  describe('upsertOuraUserMapping', () => {
    test('inserts oura user mapping', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      await centralDb.upsertOuraUserMapping('oura-123', 'testuser')

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO oura_user_mappings'),
        ['oura-123', 'testuser'],
      )
    })
  })

  describe('getUsernameByOuraUserId', () => {
    test('returns username when mapping exists', async () => {
      mockClient.query.mockResolvedValue({ rows: [{ username: 'testuser' }] })

      const result = await centralDb.getUsernameByOuraUserId('oura-123')

      expect(result).toBe('testuser')
      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT username FROM oura_user_mappings WHERE oura_user_id = $1',
        ['oura-123'],
      )
    })

    test('returns null when mapping does not exist', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      const result = await centralDb.getUsernameByOuraUserId('unknown')

      expect(result).toBeNull()
    })
  })

  describe('deleteOuraUserMapping', () => {
    test('returns true when mapping deleted', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 1 })

      const result = await centralDb.deleteOuraUserMapping('oura-123')

      expect(result).toBe(true)
    })

    test('returns false when mapping not found', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 0 })

      const result = await centralDb.deleteOuraUserMapping('unknown')

      expect(result).toBe(false)
    })
  })

  describe('upsertOuraWebhookSubscription', () => {
    test('inserts webhook subscription', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      await centralDb.upsertOuraWebhookSubscription({
        callback_url: 'https://example.com/webhooks/oura',
        data_type: 'daily_sleep',
        event_type: 'create',
        expiration_time: new Date('2026-03-01T00:00:00Z'),
        oura_subscription_id: 'sub-1',
      })

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO oura_webhook_subscriptions'),
        [
          'sub-1',
          'daily_sleep',
          'create',
          'https://example.com/webhooks/oura',
          new Date('2026-03-01T00:00:00Z'),
        ],
      )
    })
  })

  describe('getOuraWebhookSubscriptions', () => {
    test('returns all subscriptions', async () => {
      const rows = [
        {
          callback_url: 'https://example.com/webhooks/oura',
          created_at: new Date(),
          data_type: 'daily_sleep',
          event_type: 'create',
          expiration_time: new Date(),
          oura_subscription_id: 'sub-1',
          updated_at: new Date(),
        },
      ]
      mockClient.query.mockResolvedValue({ rows })

      const result = await centralDb.getOuraWebhookSubscriptions()

      expect(result).toEqual(rows)
    })

    test('returns empty array when no subscriptions', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      const result = await centralDb.getOuraWebhookSubscriptions()

      expect(result).toEqual([])
    })
  })

  describe('deleteOuraWebhookSubscription', () => {
    test('returns true when subscription deleted', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 1 })

      const result = await centralDb.deleteOuraWebhookSubscription('sub-1')

      expect(result).toBe(true)
    })

    test('returns false when subscription not found', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 0 })

      const result = await centralDb.deleteOuraWebhookSubscription('unknown')

      expect(result).toBe(false)
    })
  })

  describe('deleteAllOuraWebhookSubscriptions', () => {
    test('returns count of deleted subscriptions', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 5 })

      const result = await centralDb.deleteAllOuraWebhookSubscriptions()

      expect(result).toBe(5)
    })
  })

  describe('createOAuthClient', () => {
    test('inserts OAuth client', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      await centralDb.createOAuthClient({
        client_id: 'aur_test123',
        client_name: 'Test Client',
        redirect_uris: ['https://example.com/cb'],
        token_endpoint_auth_method: 'none',
      })

      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO oauth_clients'), [
        'aur_test123',
        'Test Client',
        '["https://example.com/cb"]',
        'none',
      ])
    })
  })

  describe('getOAuthClient', () => {
    test('returns client when found', async () => {
      const row = {
        client_id: 'aur_test',
        client_name: 'Test',
        redirect_uris: ['https://example.com/cb'],
        token_endpoint_auth_method: 'none',
        created_at: new Date(),
      }
      mockClient.query.mockResolvedValue({ rows: [row] })

      const result = await centralDb.getOAuthClient('aur_test')

      expect(result).toEqual(row)
    })

    test('returns null when not found', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      const result = await centralDb.getOAuthClient('unknown')

      expect(result).toBeNull()
    })
  })

  describe('saveAuthorizationCode', () => {
    test('inserts authorization code', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })
      const expiresAt = new Date()

      await centralDb.saveAuthorizationCode({
        code: 'test-code',
        client_id: 'aur_test',
        username: 'testuser',
        redirect_uri: 'https://example.com/cb',
        code_challenge: 'challenge',
        code_challenge_method: 'S256',
        expires_at: expiresAt,
      })

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO oauth_authorization_codes'),
        ['test-code', 'aur_test', 'testuser', 'https://example.com/cb', 'challenge', 'S256', expiresAt],
      )
    })
  })

  describe('consumeAuthorizationCode', () => {
    test('returns and marks code as used atomically', async () => {
      const row = {
        code: 'test-code',
        client_id: 'aur_test',
        username: 'testuser',
        redirect_uri: 'https://example.com/cb',
        code_challenge: 'challenge',
        code_challenge_method: 'S256',
        expires_at: new Date(),
        used: true,
      }
      mockClient.query.mockResolvedValue({ rows: [row] })

      const result = await centralDb.consumeAuthorizationCode('test-code')

      expect(result).toEqual(row)
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE oauth_authorization_codes'),
        ['test-code'],
      )
    })

    test('returns null for already-used or expired code', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      const result = await centralDb.consumeAuthorizationCode('used-code')

      expect(result).toBeNull()
    })
  })

  describe('saveOAuthToken', () => {
    test('inserts OAuth token', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })
      const now = new Date()

      await centralDb.saveOAuthToken({
        token: 'aur_at_test',
        token_type: 'access',
        client_id: 'aur_test',
        username: 'testuser',
        expires_at: now,
        revoked: false,
        parent_token: null,
        created_at: now,
      })

      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO oauth_tokens'), [
        'aur_at_test',
        'access',
        'aur_test',
        'testuser',
        now,
        false,
        null,
      ])
    })
  })

  describe('getOAuthToken', () => {
    test('returns valid token', async () => {
      const row = {
        token: 'aur_at_test',
        token_type: 'access',
        client_id: 'aur_test',
        username: 'testuser',
        expires_at: new Date(Date.now() + 3600_000),
        revoked: false,
        parent_token: null,
        created_at: new Date(),
      }
      mockClient.query.mockResolvedValue({ rows: [row] })

      const result = await centralDb.getOAuthToken('aur_at_test')

      expect(result).toEqual(row)
    })

    test('returns null for revoked/expired token', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      const result = await centralDb.getOAuthToken('revoked')

      expect(result).toBeNull()
    })
  })

  describe('revokeOAuthToken', () => {
    test('returns true when token revoked', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 1 })

      const result = await centralDb.revokeOAuthToken('aur_at_test')

      expect(result).toBe(true)
    })

    test('returns false when token not found', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 0 })

      const result = await centralDb.revokeOAuthToken('unknown')

      expect(result).toBe(false)
    })
  })

  describe('cleanupExpiredOAuth', () => {
    test('deletes expired codes and tokens', async () => {
      mockClient.query.mockResolvedValue({ rowCount: 0 })

      await centralDb.cleanupExpiredOAuth()

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM oauth_authorization_codes'),
      )
      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM oauth_tokens'))
    })
  })
})
