/**
 * Trends route group.
 *
 * Handles: /trends
 */
import { type TrendQuery, trendQuerySchema, type TrendResponse } from '@aurboda/api-spec'
import { RequestHandler, Router } from 'express'
import { getTrend } from '../services/trends'
import { validateQuery } from '../validation'

export const createTrendsRouter = (authMiddleware: RequestHandler): Router => {
  const router = Router()

  // GET /trends - Get time-weighted trend for tags or metrics
  router.get<Record<string, never>, TrendResponse, unknown, TrendQuery>(
    '/',
    authMiddleware,
    validateQuery(trendQuerySchema),
    async (req, res) => {
      const { aggregation, display_period, half_life_days, lookback_days, pattern, source_type } = req.query
      const user = req.user!

      const halfLifeDays = half_life_days ? parseInt(half_life_days, 10) : undefined
      const lookbackDays = lookback_days ? parseInt(lookback_days, 10) : undefined

      try {
        const result = await getTrend(user, {
          aggregation,
          displayPeriod: display_period,
          halfLifeDays,
          lookbackDays,
          pattern,
          sourceType: source_type,
        })
        res.json({ data: result, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(400).json({ error: message, success: false })
      }
    },
  )

  return router
}
