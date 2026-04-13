import type { RequestHandler } from 'express'

/**
 * Audit log route group.
 *
 * Handles: /user/audit-log
 */
import { type AuditLogResponse, auditLogQuerySchema } from '@aurboda/api-spec'

import { getAuditLog } from '../services/audit-log.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'

export const createAuditLogRouter = (authMiddleware: RequestHandler): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, AuditLogResponse>('/user/audit-log', authMiddleware, async (req, res) => {
    const parsed = auditLogQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ data: [], error: 'Invalid query parameters', success: false, total: 0 })
      return
    }

    const { category, level, limit, offset, since } = parsed.data
    const result = await getAuditLog(req.user!, {
      category,
      level,
      limit,
      offset,
      since: since ? new Date(since) : undefined,
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
  })

  return router
}
