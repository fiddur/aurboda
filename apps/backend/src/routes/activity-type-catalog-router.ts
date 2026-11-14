import {
  type ActivityTypeCatalogQuery,
  activityTypeCatalogQuerySchema,
  type ActivityTypeCatalogResponse,
  type StoredActivityTypeCatalog,
} from '@aurboda/api-spec'

import { loadActivityTypeCatalog } from '../services/activity-type-catalog.ts'
import { listActivityTypeCatalog } from '../services/activity-type-definitions.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

export const createActivityTypeCatalogRouter = (
  authMiddleware: AnyMiddleware,
  catalog: () => StoredActivityTypeCatalog = loadActivityTypeCatalog,
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, ActivityTypeCatalogResponse, unknown, ActivityTypeCatalogQuery>(
    '/',
    authMiddleware,
    validateQuery(activityTypeCatalogQuerySchema),
    async (req, res) => {
      res.json({ data: await listActivityTypeCatalog(req.user!, req.query.q, catalog()), success: true })
    },
  )

  return router
}
