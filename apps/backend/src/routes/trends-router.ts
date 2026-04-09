import type { RequestHandler, Router } from 'express'

/**
 * Trends route group.
 *
 * Handles: /trends
 */
import { type TrendQuery, trendQuerySchema, type TrendResponse } from '@aurboda/api-spec'

import { getCustomMetrics } from '../services/mutations.ts'
import { getTrend } from '../services/trends.ts'
import { typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

export const createTrendsRouter = (authMiddleware: RequestHandler): Router => {
  const router = typedRouter()

  router.get<Record<string, never>, TrendResponse, unknown, TrendQuery>(
    '/',
    authMiddleware,
    validateQuery(trendQuerySchema),
    async (req, res) => {
      const {
        aggregation,
        display_period,
        half_life_days,
        lookback_days,
        pattern,
        source_type,
        tag_definition_id,
      } = req.query
      const user = req.user!

      // Require pattern or tag_definition_id
      if (!pattern && !tag_definition_id) {
        return res
          .status(400)
          .json({ error: 'Either pattern or tag_definition_id is required', success: false })
      }

      const halfLifeDays = half_life_days ? parseInt(half_life_days, 10) : undefined
      const lookbackDays = lookback_days ? parseInt(lookback_days, 10) : undefined

      try {
        const customMetrics = await getCustomMetrics(user)

        const result = await getTrend(user, {
          aggregation,
          custom_metrics: customMetrics,
          display_period,
          half_life_days: halfLifeDays,
          lookback_days: lookbackDays,
          pattern: pattern ?? '',
          source_type,
          tag_definition_id,
        })
        res.json({ data: result, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(400).json({ error: message, success: false })
      }
    },
  )

  return router as unknown as Router
}
