/**
 * Audit log schemas for user-specific event logging.
 */

import { z } from 'zod'

import { baseResponseSchema, iso8601DateTimeSchema } from './common.ts'

// ============================================================================
// Log levels and categories
// ============================================================================

export const auditLogLevelSchema = z.enum(['info', 'warn', 'error']).meta({
  description: 'Severity level of the audit log entry',
  id: 'AuditLogLevel',
})

export type AuditLogLevel = z.infer<typeof auditLogLevelSchema>

export const auditLogCategorySchema = z
  .enum(['sync', 'auth', 'settings', 'data', 'deduction', 'system'])
  .meta({
    description: 'Category of the audit log entry',
    id: 'AuditLogCategory',
  })

export type AuditLogCategory = z.infer<typeof auditLogCategorySchema>

// ============================================================================
// Audit log entry
// ============================================================================

export const auditLogEntrySchema = z
  .object({
    id: z.string().uuid().meta({ description: 'Log entry ID' }),
    timestamp: iso8601DateTimeSchema.meta({ description: 'When the event occurred' }),
    level: auditLogLevelSchema,
    category: auditLogCategorySchema,
    message: z.string().meta({ description: 'Human-readable log message' }),
    details: z.record(z.string(), z.unknown()).optional().meta({ description: 'Additional structured data' }),
  })
  .meta({ id: 'AuditLogEntry' })

export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>

// ============================================================================
// Query parameters
// ============================================================================

export const auditLogQuerySchema = z
  .object({
    level: auditLogLevelSchema.optional().meta({ description: 'Filter by log level' }),
    category: auditLogCategorySchema.optional().meta({ description: 'Filter by category' }),
    since: iso8601DateTimeSchema.optional().meta({ description: 'Only entries at or after this time' }),
    until: iso8601DateTimeSchema.optional().meta({ description: 'Only entries before this time' }),
    message_pattern: z
      .string()
      .optional()
      .meta({ description: 'Case-insensitive substring match against the message field' }),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(1000)
      .optional()
      .meta({ description: 'Max entries to return (default 200)' }),
    offset: z.coerce.number().int().min(0).optional().meta({ description: 'Number of entries to skip' }),
  })
  .meta({ id: 'AuditLogQuery' })

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>

// ============================================================================
// Response
// ============================================================================

export const auditLogResponseSchema = baseResponseSchema
  .extend({
    data: z.array(auditLogEntrySchema).meta({ description: 'Log entries' }),
    total: z.number().int().meta({ description: 'Total matching entries' }),
  })
  .meta({ id: 'AuditLogResponse' })

export type AuditLogResponse = z.infer<typeof auditLogResponseSchema>
