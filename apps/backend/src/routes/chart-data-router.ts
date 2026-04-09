import type { RequestHandler, Router } from 'express'

/**
 * Chart data route group.
 *
 * Handles: /chart-data
 */
import { type ChartDataHttpQuery, chartDataHttpQuerySchema, type ChartDataResponse } from '@aurboda/api-spec'

import { getChartData } from '../services/chart-data.ts'
import { typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

export const createChartDataRouter = (authMiddleware: RequestHandler): Router => {
  const router = typedRouter()

  router.get<Record<string, never>, ChartDataResponse, unknown, ChartDataHttpQuery>(
    '/',
    authMiddleware,
    validateQuery(chartDataHttpQuerySchema),
    async (req, res) => {
      const { aggregation, bucket_size, end, pattern, source_type, start, tag_definition_id } = req.query
      const user = req.user!

      if (!pattern && !tag_definition_id) {
        return res
          .status(400)
          .json({ error: 'Either pattern or tag_definition_id is required', success: false })
      }

      try {
        const buckets = await getChartData(user, {
          aggregation: aggregation ?? 'count',
          bucket_size: bucket_size ?? '1d',
          end,
          pattern,
          source_type,
          start,
          tag_definition_id,
        })
        res.json({ data: { buckets }, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(400).json({ error: message, success: false })
      }
    },
  )

  return router as unknown as Router
}
