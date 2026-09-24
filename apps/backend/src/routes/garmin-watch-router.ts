import type { GarminWatchConfigResponse } from '@aurboda/api-spec'
import type { RequestHandler } from 'express'

import { getGarminWatchConfig } from '../services/garmin-watch.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'

export const createGarminWatchRouter = (authMiddleware: RequestHandler): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, GarminWatchConfigResponse>(
    '/config',
    authMiddleware,
    async (req, res) => {
      res.json(await getGarminWatchConfig(req.user!))
    },
  )

  return router
}
