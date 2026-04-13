/**
 * Food items route group.
 *
 * CRUD + search for canonical food item library.
 */

import type { RequestHandler } from 'express'

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

import {
  deleteFoodItem,
  type FoodItemEntity as DbFoodItemEntity,
  getFoodItemById,
  listFoodItems,
  searchFoodItems,
  updateFoodItem,
  upsertFoodItem,
} from '../db/index.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

/** Serialize a DB food item entity (Date timestamps) to API format (ISO strings). */
const serializeFoodItem = (item: DbFoodItemEntity): FoodItemEntity => {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(item)) {
    if (key === 'name_lower') continue
    result[key] = value instanceof Date ? value.toISOString() : value
  }
  return result as FoodItemEntity
}

export const createFoodItemsRouter = (authMiddleware: RequestHandler): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, FoodItemsResponse, unknown, FoodItemsQuery>(
    '/',
    authMiddleware,
    validateQuery(foodItemsQuerySchema),
    async (req, res) => {
      const { q, limit } = req.query
      const user = req.user!
      const maxResults = limit ? parseInt(limit, 10) : 20

      const items = q ? await searchFoodItems(user, q, maxResults) : await listFoodItems(user, maxResults)
      res.json({ data: items.map(serializeFoodItem), success: true })
    },
  )

  router.get<{ id: string }, FoodItemResponse>('/:id', authMiddleware, async (req, res) => {
    const item = await getFoodItemById(req.user!, req.params.id)
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
      const item = await updateFoodItem(req.user!, req.params.id, req.body)
      if (!item) return res.status(404).json({ error: 'Food item not found', success: false })
      res.json({ data: serializeFoodItem(item), success: true })
    },
  )

  router.delete<{ id: string }, DeleteFoodItemResponse>('/:id', authMiddleware, async (req, res) => {
    const deleted = await deleteFoodItem(req.user!, req.params.id)
    if (!deleted) return res.status(404).json({ error: 'Food item not found', success: false })
    res.json({ success: true })
  })

  return router
}
