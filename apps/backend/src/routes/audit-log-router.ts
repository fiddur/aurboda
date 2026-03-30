/**
 * Audit log route group.
 *
 * Handles: /user/audit-log
 */
import { auditLogQuerySchema } from '@aurboda/api-spec'
import { type RequestHandler, Router } from 'express'

import { getAuditLog } from '../services/audit-log.ts'

export const createAuditLogRouter = (authMiddleware: RequestHandler): Router => {
  const router = Router()

  // GET /user/audit-log - Get audit log entries
  router.get('/user/audit-log', authMiddleware, async (req, res) => {
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
