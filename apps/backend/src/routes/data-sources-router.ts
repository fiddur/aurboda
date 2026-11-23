import type { DataSourcesOverviewResponse } from '@aurboda/api-spec'
import type { RequestHandler } from 'express'

import { getDataSourcesOverview } from '../services/data-sources-overview.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'

export const createDataSourcesRouter = (authMiddleware: RequestHandler): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, DataSourcesOverviewResponse>(
    '/overview',
    authMiddleware,
    async (req, res) => {
      res.json({ ...(await getDataSourcesOverview(req.user!)), success: true })
    },
  )

  return router
}
