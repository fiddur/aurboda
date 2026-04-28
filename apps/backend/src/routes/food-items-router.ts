/**
 * Food items route group.
 *
 * Search + read merge per-user food_items with the central shared library.
 * Writes (POST/PATCH/DELETE) target the per-user table only — central rows
 * are managed via the admin import flow.
 */

import {
  type AddFoodItemBody,
  addFoodItemBodySchema,
  type DeleteFoodItemResponse,
  type FoodItemEntity,
  type FoodItemResponse,
  type FoodItemsQuery,
  type FoodItemsResponse,
  foodItemsQuerySchema,
  type UpdateFoodItemBody,
  updateFoodItemBodySchema,
} from '@aurboda/api-spec'

import type { CentralDb } from '../services/central-db.ts'
import type { SharedFoodItemEntity } from '../services/central-food-items.ts'

import {
  deleteFoodItem,
  type FoodItemEntity as DbFoodItemEntity,
  getFoodItemById as getUserFoodItemById,
  listFoodItems,
  updateFoodItem,
  upsertFoodItem,
} from '../db/index.ts'
import { createFoodItemsService, type MergedFoodItem } from '../services/food-items.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

const serializeFoodItem = (
  item: DbFoodItemEntity | SharedFoodItemEntity | MergedFoodItem,
): FoodItemEntity => {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(item)) {
    if (key === 'name_lower') continue
    result[key] = value instanceof Date ? value.toISOString() : value
  }
  return result as FoodItemEntity
}

export const createFoodItemsRouter = (authMiddleware: AnyMiddleware, centralDb: CentralDb): TypedRouter => {
  const router = typedRouter()
  const service = createFoodItemsService(centralDb)

  router.get<Record<string, never>, FoodItemsResponse, unknown, FoodItemsQuery>(
    '/',
    authMiddleware,
    validateQuery(foodItemsQuerySchema),
    async (req, res) => {
      const { q, limit } = req.query
      const user = req.user!
      const maxResults = limit ? parseInt(limit, 10) : 20

      const items = q ? await service.search(user, q, maxResults) : await listFoodItems(user, maxResults)
      res.json({ data: items.map(serializeFoodItem), success: true })
    },
  )

  router.get<{ id: string }, FoodItemResponse>('/:id', authMiddleware, async (req, res) => {
    const item = await service.getById(req.user!, req.params.id)
    if (!item) return res.status(404).json({ error: 'Food item not found', success: false })
    res.json({ data: serializeFoodItem(item), success: true })
  })

  router.post<Record<string, never>, FoodItemResponse, AddFoodItemBody>(
    '/',
    authMiddleware,
    validateBody(addFoodItemBodySchema),
    async (req, res) => {
      const item = await upsertFoodItem(req.user!, req.body)
      res.json({ data: serializeFoodItem(item), success: true })
    },
  )

  router.patch<{ id: string }, FoodItemResponse, UpdateFoodItemBody>(
    '/:id',
    authMiddleware,
    validateBody(updateFoodItemBodySchema),
    async (req, res) => {
      // Only per-user rows are editable. If the ID resolves to a central
      // (shared) item, refuse — admins update those via the import flow.
      const userItem = await getUserFoodItemById(req.user!, req.params.id)
      if (!userItem) {
        const fromCentral = await centralDb.getSharedFoodItemById(req.params.id)
        return res.status(fromCentral ? 403 : 404).json({
          error: fromCentral ? 'Cannot edit shared library item' : 'Food item not found',
          success: false,
        })
      }
      const item = await updateFoodItem(req.user!, req.params.id, req.body)
      if (!item) return res.status(404).json({ error: 'Food item not found', success: false })
      res.json({ data: serializeFoodItem(item), success: true })
    },
  )

  router.delete<{ id: string }, DeleteFoodItemResponse>('/:id', authMiddleware, async (req, res) => {
    const deleted = await deleteFoodItem(req.user!, req.params.id)
    if (!deleted) {
      const fromCentral = await centralDb.getSharedFoodItemById(req.params.id)
      return res.status(fromCentral ? 403 : 404).json({
        error: fromCentral ? 'Cannot delete shared library item' : 'Food item not found',
        success: false,
      })
    }
    res.json({ success: true })
  })

  return router
}
