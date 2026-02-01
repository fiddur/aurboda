import pg from 'pg'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createCentralDb, type CentralDb, type SignupMode } from './central-db'

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
})
