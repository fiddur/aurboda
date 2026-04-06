/**
 * Food items route group.
 *
 * CRUD + search for canonical food item library.
 */

import type { RequestHandler, Router } from 'express'

import { addFoodItemBodySchema, foodItemsQuerySchema, updateFoodItemBodySchema } from '@aurboda/api-spec'

import {
  deleteFoodItem,
  getFoodItemById,
  listFoodItems,
  searchFoodItems,
  updateFoodItem,
  upsertFoodItem,
} from '../db/index.ts'
import { typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

const handleSearch: RequestHandler = async (req, res) => {
  const { q, limit } = req.query as Record<string, string | undefined>
  const user = req.user!
  const maxResults = limit ? parseInt(limit, 10) : 20

  const items = q ? await searchFoodItems(user, q, maxResults) : await listFoodItems(user, maxResults)
  res.json({ data: items, success: true })
}

const handleGetById: RequestHandler<{ id: string }> = async (req, res) => {
  const item = await getFoodItemById(req.user!, req.params.id)
  if (!item) return res.status(404).json({ error: 'Food item not found', success: false })
  res.json({ data: item, success: true })
}

const handleCreate: RequestHandler = async (req, res) => {
  const item = await upsertFoodItem(req.user!, req.body)
  res.json({ data: item, success: true })
}

const handleUpdate: RequestHandler<{ id: string }> = async (req, res) => {
  const item = await updateFoodItem(req.user!, req.params.id, req.body)
  if (!item) return res.status(404).json({ error: 'Food item not found', success: false })
  res.json({ data: item, success: true })
}

const handleDelete: RequestHandler<{ id: string }> = async (req, res) => {
  const deleted = await deleteFoodItem(req.user!, req.params.id)
  if (!deleted) return res.status(404).json({ error: 'Food item not found', success: false })
  res.json({ success: true })
}

export const createFoodItemsRouter = (authMiddleware: RequestHandler): Router => {
  const router = typedRouter()

  router.get('/', authMiddleware, validateQuery(foodItemsQuerySchema), handleSearch)
  router.get('/:id', authMiddleware, handleGetById)
  router.post('/', authMiddleware, validateBody(addFoodItemBodySchema), handleCreate)
  router.patch('/:id', authMiddleware, validateBody(updateFoodItemBodySchema), handleUpdate)
  router.delete('/:id', authMiddleware, handleDelete)

  return router as unknown as Router
}
