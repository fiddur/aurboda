import type { McpSessionRecord } from './types.ts'

/**
 * MCP session persistence across backend restarts.
 */
import { query } from './connection.ts'
import { mapMcpSessionRow } from './row-mappers.ts'

/**
 * Save an MCP session to the database.
 */
export const saveMcpSession = async (user: string, sessionId: string): Promise<McpSessionRecord> => {
  const result = await query(
    user,
    `INSERT INTO mcp_sessions (session_id, username, created_at, last_activity)
     VALUES ($1, $2, NOW(), NOW())
     ON CONFLICT (session_id) DO UPDATE SET last_activity = NOW()
     RETURNING session_id, username, created_at, last_activity`,
    [sessionId, user],
  )

  return mapMcpSessionRow(result.rows[0])
}

/**
 * Get an MCP session by ID.
 */
export const getMcpSession = async (user: string, sessionId: string): Promise<McpSessionRecord | null> => {
  const result = await query(
    user,
    `SELECT session_id, username, created_at, last_activity
     FROM mcp_sessions
     WHERE session_id = $1`,
    [sessionId],
  )

  if (result.rows.length === 0) return null
  return mapMcpSessionRow(result.rows[0])
}

/**
 * Update the last_activity timestamp for a session.
 */
export const touchMcpSession = async (user: string, sessionId: string): Promise<void> => {
  await query(user, `UPDATE mcp_sessions SET last_activity = NOW() WHERE session_id = $1`, [sessionId])
}

/**
 * Delete an MCP session.
 */
export const deleteMcpSession = async (user: string, sessionId: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM mcp_sessions WHERE session_id = $1`, [sessionId])
  return (result.rowCount ?? 0) > 0
}

/**
 * Delete MCP sessions that have been inactive for longer than the specified duration.
 * @param maxInactivityMs Maximum inactivity time in milliseconds (default: 7 days)
 */
export const deleteExpiredMcpSessions = async (
  user: string,
  maxInactivityMs: number = 7 * 24 * 60 * 60 * 1000,
): Promise<string[]> => {
  const cutoff = new Date(Date.now() - maxInactivityMs)

  const result = await query(
    user,
    `DELETE FROM mcp_sessions
     WHERE last_activity < $1
     RETURNING session_id`,
    [cutoff],
  )

  return result.rows.map((row) => row.session_id)
}

/**
 * Get all active MCP sessions for a user.
 */
export const getMcpSessionsForUser = async (user: string): Promise<McpSessionRecord[]> => {
  const result = await query(
    user,
    `SELECT session_id, username, created_at, last_activity
     FROM mcp_sessions
     WHERE username = $1
     ORDER BY last_activity DESC`,
    [user],
  )

  return result.rows.map(mapMcpSessionRow)
}
