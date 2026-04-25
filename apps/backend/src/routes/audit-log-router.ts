/**
 * Audit log route group.
 *
 * Handles: /user/audit-log
 */
import { type AuditLogQuery, auditLogQuerySchema, type AuditLogResponse } from '@aurboda/api-spec'

import { getAuditLog } from '../services/audit-log.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

export const createAuditLogRouter = (authMiddleware: AnyMiddleware): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, AuditLogResponse, unknown, AuditLogQuery>(
    '/user/audit-log',
    authMiddleware,
    validateQuery(auditLogQuerySchema),
    async (req, res) => {
      const { since, until, ...rest } = req.query
      const result = await getAuditLog(req.user!, {
        ...rest,
        since: since ? new Date(since) : undefined,
        until: until ? new Date(until) : undefined,
      })

      res.json({
        data: result.rows.map((row) => ({
          category: row.category,
          details: row.details ?? undefined,
          id: row.id,
          level: row.level,
          message: row.message,
          timestamp: row.timestamp.toISOString(),
        })),
        success: true,
        total: result.total,
      })
    },
  )

  return router
}
