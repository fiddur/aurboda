import type { RequestHandler } from 'express'

/**
 * Chart data route group.
 *
 * Handles: /chart-data
 */
import { type ChartDataHttpQuery, chartDataHttpQuerySchema, type ChartDataResponse } from '@aurboda/api-spec'

import { getChartData } from '../services/chart-data.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

export const createChartDataRouter = (authMiddleware: RequestHandler): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, ChartDataResponse, unknown, ChartDataHttpQuery>(
    '/',
    authMiddleware,
    validateQuery(chartDataHttpQuerySchema),
    async (req, res) => {
      const {
        aggregation,
        breakdown_fields: breakdownFieldsStr,
        bucket_size,
        end,
        pattern,
        source_type,
        start,
        tag_definition_id,
      } = req.query
      const breakdown_fields = breakdownFieldsStr
        ? breakdownFieldsStr
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined
      const user = req.user!

      if (!pattern && !tag_definition_id) {
        return res
          .status(400)
          .json({ error: 'Either pattern or tag_definition_id is required', success: false })
      }

      const result = await getChartData(user, {
        aggregation: aggregation ?? 'count',
        breakdown_fields,
        bucket_size: bucket_size ?? '1d',
        end,
        pattern,
        source_type,
        start,
        tag_definition_id,
      })
      res.json({
        data: {
          breakdown_fields: result.breakdown_fields,
          breakdown_series: result.breakdown_series,
          buckets: result.buckets,
        },
        success: true,
      })
    },
  )

  return router
}
