import {
  type ExerciseCatalogEntryResponse,
  type ExerciseCatalogQuery,
  exerciseCatalogQuerySchema,
  type ExerciseCatalogSearchResponse,
  type StoredExerciseCatalog,
} from '@aurboda/api-spec'

import {
  getExerciseByKey,
  loadExerciseCatalog,
  searchExercises,
  toExerciseCatalogEntry,
} from '../services/exercise-catalog.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

export const createExerciseCatalogRouter = (
  authMiddleware: AnyMiddleware,
  catalog: () => StoredExerciseCatalog = loadExerciseCatalog,
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, ExerciseCatalogSearchResponse, unknown, ExerciseCatalogQuery>(
    '/',
    authMiddleware,
    validateQuery(exerciseCatalogQuerySchema),
    (req, res) => {
      res.json({ data: searchExercises(catalog(), req.query), success: true })
    },
  )

  router.get<{ key: string }, ExerciseCatalogEntryResponse>('/:key', authMiddleware, (req, res) => {
    const current = catalog()
    const entry = getExerciseByKey(current, req.params.key)
    if (!entry) return res.status(404).json({ error: 'Exercise not found', success: false })
    res.json({ data: { entry: toExerciseCatalogEntry(entry), version: current.version }, success: true })
  })

  return router
}
