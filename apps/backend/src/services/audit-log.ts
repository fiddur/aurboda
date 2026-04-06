/**
 * Audit log service.
 *
 * Provides a logger for user-specific events that writes to the audit_log table.
 * System-level events (startup, shutdown) stay in console.log.
 */

import type { AuditLogCategory, AuditLogLevel } from '@aurboda/api-spec'

import { cleanupAuditLog, insertAuditLog, queryAuditLog, type AuditLogQueryParams } from '../db/index.ts'

/**
 * Write an audit log entry for a user.
 * Failures are caught and logged to stderr to avoid breaking the caller.
 */
export const auditLog = async (
  user: string,
  level: AuditLogLevel,
  category: AuditLogCategory,
  message: string,
  details?: Record<string, unknown>,
): Promise<void> => {
  try {
    await insertAuditLog(user, level, category, message, details)
  } catch (err) {
    // Fall back to stderr so we don't lose the info entirely
    console.error(`⚠️ Failed to write audit log for ${user}:`, err)
  }
}

/**
 * Convenience loggers for common levels.
 */
export const auditInfo = (
  user: string,
  category: AuditLogCategory,
  message: string,
  details?: Record<string, unknown>,
) => auditLog(user, 'info', category, message, details)

export const auditWarn = (
  user: string,
  category: AuditLogCategory,
  message: string,
  details?: Record<string, unknown>,
) => auditLog(user, 'warn', category, message, details)

export const auditError = (
  user: string,
  category: AuditLogCategory,
  message: string,
  details?: Record<string, unknown>,
) => auditLog(user, 'error', category, message, details)

/**
 * Query audit log entries for a user.
 */
export const getAuditLog = (user: string, params: AuditLogQueryParams = {}) => queryAuditLog(user, params)

/**
 * Remove old audit log entries for a user based on retention period.
 */
export const pruneAuditLog = (user: string, retentionDays: number) => cleanupAuditLog(user, retentionDays)
