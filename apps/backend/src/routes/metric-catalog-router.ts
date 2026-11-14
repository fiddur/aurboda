import {
  type MetricCatalogQuery,
  metricCatalogQuerySchema,
  type MetricCatalogResponse,
  type StoredMetricCatalog,
} from '@aurboda/api-spec'

import { listMetricCatalog } from '../services/custom-metrics.ts'
import { loadMetricCatalog } from '../services/metric-catalog.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

export const createMetricCatalogRouter = (
  authMiddleware: AnyMiddleware,
  catalog: () => StoredMetricCatalog = loadMetricCatalog,
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, MetricCatalogResponse, unknown, MetricCatalogQuery>(
    '/',
    authMiddleware,
    validateQuery(metricCatalogQuerySchema),
    async (req, res) => {
      res.json({ data: await listMetricCatalog(req.user!, req.query.q, catalog()), success: true })
    },
  )

  return router
}
