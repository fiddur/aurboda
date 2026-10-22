/**
 * System-level events (startup, shutdown) stay in console.log.
 */

import type { AuditLogCategory, AuditLogLevel } from '@aurboda/api-spec'

import { cleanupAuditLog, insertAuditLog, queryAuditLog, type AuditLogQueryParams } from '../db/index.ts'

/**
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
    console.error(`⚠️ Failed to write audit log for ${user}:`, err)
  }
}

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

export const getAuditLog = (user: string, params: AuditLogQueryParams = {}) => queryAuditLog(user, params)

export const pruneAuditLog = (user: string, retentionDays: number) => cleanupAuditLog(user, retentionDays)
