import type { RequestHandler } from 'express'

/**
 * Training load route group.
 *
 * Handles: /training-load
 */
import { type TrainingLoadQuery, trainingLoadQuerySchema, type TrainingLoadResponse } from '@aurboda/api-spec'

import { computeTrainingLoad, createTrainingLoadDeps } from '../services/training-load.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

export const createTrainingLoadRouter = (authMiddleware: RequestHandler): TypedRouter => {
  const router = typedRouter()
  const deps = createTrainingLoadDeps()

  router.get<Record<string, never>, TrainingLoadResponse, unknown, TrainingLoadQuery>(
    '/',
    authMiddleware,
    validateQuery(trainingLoadQuerySchema),
    async (req, res) => {
      const { start, end, bucket_size, tz } = req.query
      const user = req.user!

      const startDate = new Date(start)
      const endDate = new Date(end)

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        res.status(400).json({ error: 'Invalid date format', success: false })
        return
      }

      const result = await computeTrainingLoad(deps, user, startDate, endDate, bucket_size, tz)
      res.json({ data: result, success: true })
    },
  )

  return router
}
