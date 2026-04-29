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
  type FoodItemDetail,
  type FoodItemDetailResponse,
  type FoodItemEntity,
  type FoodItemResponse,
  type FoodItemsQuery,
  type FoodItemsResponse,
  foodItemsQuerySchema,
  type SetFoodItemIngredientsBody,
  setFoodItemIngredientsBodySchema,
  type UpdateFoodItemBody,
  updateFoodItemBodySchema,
} from '@aurboda/api-spec'

import type { CentralDb } from '../services/central-db.ts'
import type { SharedFoodItemEntity } from '../services/central-food-items.ts'

import {
  clearIngredients as dbClearIngredients,
  deleteFoodItem,
  type FoodItemEntity as DbFoodItemEntity,
  getFoodItemById as getUserFoodItemById,
  listFoodItems,
  setIngredients as dbSetIngredients,
  updateFoodItem,
  upsertFoodItem,
} from '../db/index.ts'
import {
  createFoodItemsService,
  type FoodItemDetail as ServiceFoodItemDetail,
  type MergedFoodItem,
} from '../services/food-items.ts'
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

const serializeDetail = (detail: ServiceFoodItemDetail): FoodItemDetail => {
  const base = serializeFoodItem(detail.item)
  if (!detail.ingredients) return base as FoodItemDetail
  return {
    ...base,
    derived_nutrients: detail.derived_nutrients ?? { nutrient_data_incomplete: false, values: {} },
    ingredients: detail.ingredients.map((ing) => ({
      icon: (ing.food?.icon as string | undefined) ?? null,
      ingredient_food_item_id: ing.row.ingredient_food_item_id,
      name: ing.food ? (ing.food.name as string) : null,
      quantity: ing.row.quantity,
      sort_order: ing.row.sort_order,
      unit: ing.row.unit,
    })),
  }
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

  router.get<{ id: string }, FoodItemDetailResponse>('/:id', authMiddleware, async (req, res) => {
    const detail = await service.getDetail(req.user!, req.params.id)
    if (!detail) return res.status(404).json({ error: 'Food item not found', success: false })
    res.json({ data: serializeDetail(detail), success: true })
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

  // Replace the full ingredient list of a composite food item. Per-user
  // items only — central rows can't be made composite from this endpoint.
  router.put<{ id: string }, FoodItemDetailResponse, SetFoodItemIngredientsBody>(
    '/:id/ingredients',
    authMiddleware,
    validateBody(setFoodItemIngredientsBodySchema),
    async (req, res) => {
      const user = req.user!
      const id = req.params.id
      const userItem = await getUserFoodItemById(user, id)
      if (!userItem) {
        const fromCentral = await centralDb.getSharedFoodItemById(id)
        return res.status(fromCentral ? 403 : 404).json({
          error: fromCentral ? 'Cannot set ingredients on shared library item' : 'Food item not found',
          success: false,
        })
      }
      const ingredients = req.body.ingredients
      const ingredientIds = ingredients.map((i) => i.ingredient_food_item_id)
      if (await service.wouldCreateCycle(user, id, ingredientIds)) {
        return res.status(400).json({
          error: 'Setting these ingredients would create a cycle in the recipe graph',
          success: false,
        })
      }
      await dbSetIngredients(user, id, ingredients)
      const detail = await service.getDetail(user, id)
      if (!detail) return res.status(404).json({ error: 'Food item not found', success: false })
      res.json({ data: serializeDetail(detail), success: true })
    },
  )

  // Clear all ingredients and revert the parent to atomic mode.
  router.delete<{ id: string }, FoodItemDetailResponse>(
    '/:id/ingredients',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const id = req.params.id
      const userItem = await getUserFoodItemById(user, id)
      if (!userItem) {
        const fromCentral = await centralDb.getSharedFoodItemById(id)
        return res.status(fromCentral ? 403 : 404).json({
          error: fromCentral ? 'Cannot clear ingredients on shared library item' : 'Food item not found',
          success: false,
        })
      }
      await dbClearIngredients(user, id)
      const detail = await service.getDetail(user, id)
      if (!detail) return res.status(404).json({ error: 'Food item not found', success: false })
      res.json({ data: serializeDetail(detail), success: true })
    },
  )

  return router
}
