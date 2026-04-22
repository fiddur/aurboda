import type { RequestHandler } from 'express'

/**
 * Audit log route group.
 *
 * Handles: /user/audit-log
 */
import { type AuditLogQuery, auditLogQuerySchema, type AuditLogResponse } from '@aurboda/api-spec'

import { getAuditLog } from '../services/audit-log.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

export const createAuditLogRouter = (authMiddleware: RequestHandler): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, AuditLogResponse>(
    '/user/audit-log',
    authMiddleware,
    validateQuery(auditLogQuerySchema),
    async (req, res) => {
      // validateQuery middleware has replaced req.query with the parsed output
      // (numbers). The 4th ReqQuery generic can't express non-string values,
      // so we narrow here.
      const { since, until, ...rest } = req.query as unknown as AuditLogQuery
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
