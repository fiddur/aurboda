import { randomUUID } from 'crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper'
import {
  deleteMcpSession,
  getMcpSession,
  getMcpSessionsForUser,
  saveMcpSession,
  touchMcpSession,
} from './mcp-sessions'

const CONTAINER_TIMEOUT = 60_000

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
      const sessionId = randomUUID()

      const result = await saveMcpSession(user, sessionId)

      expect(result.sessionId).toBe(sessionId)
      expect(result.username).toBe(user)
      expect(result.createdAt).toBeInstanceOf(Date)
      expect(result.lastActivity).toBeInstanceOf(Date)
    })

    test('upserts existing session and updates lastActivity', async () => {
      const user = getTestUser()
      const sessionId = randomUUID()

      const first = await saveMcpSession(user, sessionId)

      // Wait a bit to ensure timestamp changes
      await new Promise((r) => setTimeout(r, 10))

      const second = await saveMcpSession(user, sessionId)

      expect(second.sessionId).toBe(sessionId)
      expect(second.createdAt.getTime()).toBe(first.createdAt.getTime())
      expect(second.lastActivity.getTime()).toBeGreaterThanOrEqual(first.lastActivity.getTime())
    })
  })

  describe('getMcpSession', () => {
    test('retrieves existing session', async () => {
      const user = getTestUser()
      const sessionId = randomUUID()

      await saveMcpSession(user, sessionId)

      const result = await getMcpSession(user, sessionId)

      expect(result).not.toBeNull()
      expect(result!.sessionId).toBe(sessionId)
      expect(result!.username).toBe(user)
    })

    test('returns null for non-existent session', async () => {
      const user = getTestUser()

      const result = await getMcpSession(user, randomUUID())

      expect(result).toBeNull()
    })
  })

  describe('touchMcpSession', () => {
    test('updates lastActivity timestamp', async () => {
      const user = getTestUser()
      const sessionId = randomUUID()

      await saveMcpSession(user, sessionId)
      const before = await getMcpSession(user, sessionId)

      // Wait a bit to ensure timestamp changes
      await new Promise((r) => setTimeout(r, 10))

      await touchMcpSession(user, sessionId)
      const after = await getMcpSession(user, sessionId)

      expect(after!.lastActivity.getTime()).toBeGreaterThanOrEqual(before!.lastActivity.getTime())
    })
  })

  describe('deleteMcpSession', () => {
    test('deletes existing session and returns true', async () => {
      const user = getTestUser()
      const sessionId = randomUUID()

      await saveMcpSession(user, sessionId)

      const result = await deleteMcpSession(user, sessionId)

      expect(result).toBe(true)

      const check = await getMcpSession(user, sessionId)
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

    test('returns sessions ordered by lastActivity descending', async () => {
      const user = getTestUser()

      const oldSessionId = randomUUID()
      const newSessionId = randomUUID()

      await saveMcpSession(user, oldSessionId)
      await new Promise((r) => setTimeout(r, 10))
      await saveMcpSession(user, newSessionId)

      const sessions = await getMcpSessionsForUser(user)

      expect(sessions[0].sessionId).toBe(newSessionId)
      expect(sessions[1].sessionId).toBe(oldSessionId)
    })
  })
})
