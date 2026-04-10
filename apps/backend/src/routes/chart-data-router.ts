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
      const {
        aggregation,
        breakdown_field,
        bucket_size,
        end,
        pattern,
        source_type,
        start,
        tag_definition_id,
      } = req.query
      const user = req.user!

      if (!pattern && !tag_definition_id) {
        return res
          .status(400)
          .json({ error: 'Either pattern or tag_definition_id is required', success: false })
      }

      try {
        const result = await getChartData(user, {
          aggregation: aggregation ?? 'count',
          breakdown_field,
          bucket_size: bucket_size ?? '1d',
          end,
          pattern,
          source_type,
          start,
          tag_definition_id,
        })
        res.json({
          data: {
            breakdown_field: result.breakdown_field,
            breakdown_series: result.breakdown_series,
            buckets: result.buckets,
          },
          success: true,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(400).json({ error: message, success: false })
      }
    },
  )

  return router as unknown as Router
}
