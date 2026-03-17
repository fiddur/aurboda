/**
 * MCP Session Store Interface and Implementations
 *
 * Provides session persistence for MCP sessions, allowing them to survive
 * backend restarts. Sessions are lazily restored when clients reconnect.
 */

import {
  deleteExpiredMcpSessions,
  deleteMcpSession,
  getMcpSession,
  type McpSessionRecord,
  saveMcpSession,
  touchMcpSession,
} from './db/index.ts'

/**
 * Interface for MCP session persistence.
 * Implementations can be in-memory only or database-backed.
 */
export interface McpSessionStore {
  /**
   * Save a new session or update an existing one.
   * Returns the session record.
   */
  save(user: string, sessionId: string): Promise<McpSessionRecord>

  /**
   * Get a session by ID.
   * Returns null if the session doesn't exist.
   */
  get(user: string, sessionId: string): Promise<McpSessionRecord | null>

  /**
   * Update the last_activity timestamp for a session.
   */
  touch(user: string, sessionId: string): Promise<void>

  /**
   * Delete a session.
   * Returns true if the session was deleted.
   */
  delete(user: string, sessionId: string): Promise<boolean>

  /**
   * Delete sessions that have been inactive for longer than maxInactivityMs.
   * Returns the IDs of deleted sessions.
   */
  cleanup(user: string, maxInactivityMs: number): Promise<string[]>
}

/**
 * In-memory session store (no persistence across restarts).
 * Useful for testing or when persistence is not needed.
 */
export const createInMemorySessionStore = (): McpSessionStore => {
  const sessions = new Map<string, McpSessionRecord>()

  return {
    cleanup: async (_user, maxInactivityMs) => {
      const cutoff = Date.now() - maxInactivityMs
      const expired: string[] = []
      for (const [id, record] of sessions) {
        if (record.last_activity.getTime() < cutoff) {
          expired.push(id)
          sessions.delete(id)
        }
      }
      return expired
    },

    delete: async (_user, sessionId) => {
      return sessions.delete(sessionId)
    },

    get: async (_user, sessionId) => {
      return sessions.get(sessionId) ?? null
    },

    save: async (user, sessionId) => {
      const now = new Date()
      const existing = sessions.get(sessionId)
      const record: McpSessionRecord = {
        created_at: existing?.created_at ?? now,
        last_activity: now,
        session_id: sessionId,
        username: user,
      }
      sessions.set(sessionId, record)
      return record
    },

    touch: async (_user, sessionId) => {
      const existing = sessions.get(sessionId)
      if (existing) {
        existing.last_activity = new Date()
      }
    },
  }
}

/**
 * Database-backed session store.
 * Sessions persist across backend restarts.
 */
export const createDbSessionStore = (): McpSessionStore => ({
  cleanup: deleteExpiredMcpSessions,
  delete: deleteMcpSession,
  get: getMcpSession,
  save: saveMcpSession,
  touch: touchMcpSession,
})

/**
 * Default session inactivity timeout: 7 days
 */
export const DEFAULT_SESSION_INACTIVITY_MS = 7 * 24 * 60 * 60 * 1000
