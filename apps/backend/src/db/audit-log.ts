/**
 * Audit log database operations.
 *
 * Stores user-specific log entries (sync events, settings changes, errors, etc.)
 * with automatic cleanup based on configurable retention period.
 */

import type { AuditLogCategory, AuditLogLevel } from '@aurboda/api-spec'

import { query } from './connection.ts'

export interface AuditLogRow {
  id: string
  timestamp: Date
  level: AuditLogLevel
  category: AuditLogCategory
  message: string
  details: Record<string, unknown> | null
}

export interface AuditLogQueryParams {
  level?: AuditLogLevel
  category?: AuditLogCategory
  since?: Date
  until?: Date
  messagePattern?: string
  limit?: number
  offset?: number
}

/**
 * Insert a new audit log entry.
 */
export const insertAuditLog = async (
  user: string,
  level: AuditLogLevel,
  category: AuditLogCategory,
  message: string,
  details?: Record<string, unknown>,
): Promise<void> => {
  await query(user, `INSERT INTO audit_log (level, category, message, details) VALUES ($1, $2, $3, $4)`, [
    level,
    category,
    message,
    details ? JSON.stringify(details) : null,
  ])
}

/**
 * Query audit log entries with optional filters.
 */
export const queryAuditLog = async (
  user: string,
  params: AuditLogQueryParams = {},
): Promise<{ rows: AuditLogRow[]; total: number }> => {
  const conditions: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  if (params.level) {
    conditions.push(`level = $${paramIndex++}`)
    values.push(params.level)
  }
  if (params.category) {
    conditions.push(`category = $${paramIndex++}`)
    values.push(params.category)
  }
  if (params.since) {
    conditions.push(`timestamp >= $${paramIndex++}`)
    values.push(params.since)
  }
  if (params.until) {
    conditions.push(`timestamp < $${paramIndex++}`)
    values.push(params.until)
  }
  if (params.messagePattern) {
    conditions.push(`message ILIKE $${paramIndex++}`)
    values.push(`%${params.messagePattern}%`)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = params.limit ?? 200
  const offset = params.offset ?? 0

  const countResult = await query(user, `SELECT COUNT(*)::int AS total FROM audit_log ${where}`, values)
  const total = countResult.rows[0]?.total ?? 0

  const dataResult = await query<AuditLogRow>(
    user,
    `SELECT id, timestamp, level, category, message, details
     FROM audit_log ${where}
     ORDER BY timestamp DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...values, limit, offset],
  )

  return { rows: dataResult.rows, total }
}

/**
 * Delete audit log entries older than the given number of days.
 */
export const cleanupAuditLog = async (user: string, retentionDays: number): Promise<number> => {
  const result = await query(user, `DELETE FROM audit_log WHERE timestamp < NOW() - INTERVAL '1 day' * $1`, [
    retentionDays,
  ])
  return result.rowCount ?? 0
}
