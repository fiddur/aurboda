import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  deleteMcpSession,
  getMcpSession,
  getMcpSessionsForUser,
  saveMcpSession,
  touchMcpSession,
} from './mcp-sessions.ts'

const CONTAINER_TIMEOUT = 120_000

describe('MCP Sessions Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('saveMcpSession', () => {
    test('saves a new session', async () => {
      const user = getTestUser()
      const session_id = randomUUID()

      const result = await saveMcpSession(user, session_id)

      expect(result.session_id).toBe(session_id)
      expect(result.username).toBe(user)
      expect(result.created_at).toBeInstanceOf(Date)
      expect(result.last_activity).toBeInstanceOf(Date)
    })

    test('upserts existing session and updates last_activity', async () => {
      const user = getTestUser()
      const session_id = randomUUID()

      const first = await saveMcpSession(user, session_id)

      // Wait a bit to ensure timestamp changes
      await new Promise((r) => setTimeout(r, 10))

      const second = await saveMcpSession(user, session_id)

      expect(second.session_id).toBe(session_id)
      expect(second.created_at.getTime()).toBe(first.created_at.getTime())
      expect(second.last_activity.getTime()).toBeGreaterThanOrEqual(first.last_activity.getTime())
    })
  })

  describe('getMcpSession', () => {
    test('retrieves existing session', async () => {
      const user = getTestUser()
      const session_id = randomUUID()

      await saveMcpSession(user, session_id)

      const result = await getMcpSession(user, session_id)

      expect(result).not.toBeNull()
      expect(result!.session_id).toBe(session_id)
      expect(result!.username).toBe(user)
    })

    test('returns null for non-existent session', async () => {
      const user = getTestUser()

      const result = await getMcpSession(user, randomUUID())

      expect(result).toBeNull()
    })
  })

  describe('touchMcpSession', () => {
    test('updates last_activity timestamp', async () => {
      const user = getTestUser()
      const session_id = randomUUID()

      await saveMcpSession(user, session_id)
      const before = await getMcpSession(user, session_id)

      // Wait a bit to ensure timestamp changes
      await new Promise((r) => setTimeout(r, 10))

      await touchMcpSession(user, session_id)
      const after = await getMcpSession(user, session_id)

      expect(after!.last_activity.getTime()).toBeGreaterThanOrEqual(before!.last_activity.getTime())
    })
  })

  describe('deleteMcpSession', () => {
    test('deletes existing session and returns true', async () => {
      const user = getTestUser()
      const session_id = randomUUID()

      await saveMcpSession(user, session_id)

      const result = await deleteMcpSession(user, session_id)

      expect(result).toBe(true)

      const check = await getMcpSession(user, session_id)
      expect(check).toBeNull()
    })

    test('returns false for non-existent session', async () => {
      const user = getTestUser()

      const result = await deleteMcpSession(user, randomUUID())

      expect(result).toBe(false)
    })
  })

  describe('getMcpSessionsForUser', () => {
    test('returns all sessions for a user', async () => {
      const user = getTestUser()

      await saveMcpSession(user, randomUUID())
      await saveMcpSession(user, randomUUID())
      await saveMcpSession(user, randomUUID())

      const sessions = await getMcpSessionsForUser(user)

      expect(sessions).toHaveLength(3)
    })

    test('returns sessions ordered by last_activity descending', async () => {
      const user = getTestUser()

      const oldSessionId = randomUUID()
      const newSessionId = randomUUID()

      await saveMcpSession(user, oldSessionId)
      await new Promise((r) => setTimeout(r, 10))
      await saveMcpSession(user, newSessionId)

      const sessions = await getMcpSessionsForUser(user)

      expect(sessions[0].session_id).toBe(newSessionId)
      expect(sessions[1].session_id).toBe(oldSessionId)
    })
  })
})
