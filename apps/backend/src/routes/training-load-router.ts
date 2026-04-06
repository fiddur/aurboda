import type { RequestHandler, Router } from 'express'

/**
 * Training load route group.
 *
 * Handles: /training-load
 */
import { type TrainingLoadQuery, trainingLoadQuerySchema, type TrainingLoadResponse } from '@aurboda/api-spec'

import { computeTrainingLoad, createTrainingLoadDeps } from '../services/training-load.ts'
import { typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

export const createTrainingLoadRouter = (authMiddleware: RequestHandler): Router => {
  const router = typedRouter()
  const deps = createTrainingLoadDeps()

  // GET /training-load - Get training load time series (ATL, CTL, TSB, TRIMP)
  router.get<Record<string, string>, TrainingLoadResponse, unknown, TrainingLoadQuery>(
    '/',
    authMiddleware,
    validateQuery(trainingLoadQuerySchema),
    async (req, res) => {
      const { start, end, bucket_size, tz } = req.query
      const user = req.user!

      try {
        const startDate = new Date(start)
        const endDate = new Date(end)

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          res.status(400).json({ error: 'Invalid date format', success: false })
          return
        }

        const result = await computeTrainingLoad(deps, user, startDate, endDate, bucket_size, tz)
        res.json({ data: result, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(400).json({ error: message, success: false })
      }
    },
  )

  return router as unknown as Router
}
