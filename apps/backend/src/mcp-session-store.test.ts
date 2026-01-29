import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createInMemorySessionStore,
  DEFAULT_SESSION_INACTIVITY_MS,
  McpSessionStore,
} from './mcp-session-store'

describe('createInMemorySessionStore', () => {
  let store: McpSessionStore

  beforeEach(() => {
    store = createInMemorySessionStore()
    vi.useFakeTimers()
  })

  describe('save', () => {
    test('creates a new session with timestamps', async () => {
      const now = new Date('2024-01-15T10:00:00Z')
      vi.setSystemTime(now)

      const record = await store.save('testuser', 'session-123')

      expect(record.sessionId).toBe('session-123')
      expect(record.username).toBe('testuser')
      expect(record.createdAt).toEqual(now)
      expect(record.lastActivity).toEqual(now)
    })

    test('updates lastActivity but preserves createdAt on re-save', async () => {
      const createTime = new Date('2024-01-15T10:00:00Z')
      vi.setSystemTime(createTime)

      await store.save('testuser', 'session-123')

      const updateTime = new Date('2024-01-15T12:00:00Z')
      vi.setSystemTime(updateTime)

      const record = await store.save('testuser', 'session-123')

      expect(record.createdAt).toEqual(createTime)
      expect(record.lastActivity).toEqual(updateTime)
    })
  })

  describe('get', () => {
    test('returns null for non-existent session', async () => {
      const record = await store.get('testuser', 'non-existent')
      expect(record).toBeNull()
    })

    test('returns saved session', async () => {
      await store.save('testuser', 'session-123')
      const record = await store.get('testuser', 'session-123')

      expect(record).not.toBeNull()
      expect(record!.sessionId).toBe('session-123')
      expect(record!.username).toBe('testuser')
    })
  })

  describe('touch', () => {
    test('updates lastActivity timestamp', async () => {
      const createTime = new Date('2024-01-15T10:00:00Z')
      vi.setSystemTime(createTime)
      await store.save('testuser', 'session-123')

      const touchTime = new Date('2024-01-15T14:00:00Z')
      vi.setSystemTime(touchTime)
      await store.touch('testuser', 'session-123')

      const record = await store.get('testuser', 'session-123')
      expect(record!.lastActivity).toEqual(touchTime)
      expect(record!.createdAt).toEqual(createTime)
    })

    test('does nothing for non-existent session', async () => {
      // Should not throw
      await store.touch('testuser', 'non-existent')
    })
  })

  describe('delete', () => {
    test('removes existing session and returns true', async () => {
      await store.save('testuser', 'session-123')

      const deleted = await store.delete('testuser', 'session-123')

      expect(deleted).toBe(true)
      expect(await store.get('testuser', 'session-123')).toBeNull()
    })

    test('returns false for non-existent session', async () => {
      const deleted = await store.delete('testuser', 'non-existent')
      expect(deleted).toBe(false)
    })
  })

  describe('cleanup', () => {
    test('removes sessions older than maxInactivityMs', async () => {
      const day1 = new Date('2024-01-10T10:00:00Z')
      vi.setSystemTime(day1)
      await store.save('testuser', 'old-session')

      // Use day 18 to ensure old-session is more than 7 days old
      const day9 = new Date('2024-01-18T10:00:00Z')
      vi.setSystemTime(day9)
      await store.save('testuser', 'new-session')

      // Cleanup with 7-day inactivity threshold
      const deleted = await store.cleanup('testuser', DEFAULT_SESSION_INACTIVITY_MS)

      expect(deleted).toContain('old-session')
      expect(deleted).not.toContain('new-session')

      expect(await store.get('testuser', 'old-session')).toBeNull()
      expect(await store.get('testuser', 'new-session')).not.toBeNull()
    })

    test('returns empty array when no sessions expired', async () => {
      const now = new Date('2024-01-15T10:00:00Z')
      vi.setSystemTime(now)
      await store.save('testuser', 'session-123')

      const deleted = await store.cleanup('testuser', DEFAULT_SESSION_INACTIVITY_MS)

      expect(deleted).toHaveLength(0)
    })
  })
})
