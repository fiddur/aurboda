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
  type MergeFoodItemsBody,
  mergeFoodItemsBodySchema,
  type MergeFoodItemsPreviewResponse,
  type MergeFoodItemsQuery,
  mergeFoodItemsQuerySchema,
  type MergeFoodItemsResponse,
  type ResnapshotMealsResponse,
  type SetFoodItemIngredientsBody,
  setFoodItemIngredientsBodySchema,
  type SetFoodItemReferenceBody,
  setFoodItemReferenceBodySchema,
  type SetFoodItemSensitivitiesBody,
  setFoodItemSensitivitiesBodySchema,
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
  setFoodItemReference as dbSetFoodItemReference,
  setFoodItemSensitivities as dbSetFoodItemSensitivities,
  setIngredients as dbSetIngredients,
  updateFoodItem,
  upsertFoodItem,
} from '../db/index.ts'
import {
  cacheCompositeNutrients,
  clearCompositeNutrientCache,
  createFoodItemsMergeService,
  createFoodItemsService,
  type FoodItemDetail as ServiceFoodItemDetail,
  type MergedFoodItem,
} from '../services/food-items.ts'
import { resnapshotMealsForFoodItem } from '../services/meals.ts'
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
  const sensitivities = detail.sensitivities ?? []
  // Composite branch: ingredient list + derived totals.
  if (detail.ingredients) {
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
      sensitivities,
    }
  }
  // Reference branch: emit the resolved reference + per-field origin map.
  // The service guarantees these two are set together.
  if (detail.reference) {
    return {
      ...base,
      reference: {
        food: serializeFoodItem(detail.reference.food),
        unit_mismatch: detail.reference.unit_mismatch,
      },
      reference_enriched: detail.reference_enriched ?? { fields: {} },
      sensitivities,
    }
  }
  return { ...base, sensitivities } as FoodItemDetail
}

export const createFoodItemsRouter = (authMiddleware: AnyMiddleware, centralDb: CentralDb): TypedRouter => {
  const router = typedRouter()
  const service = createFoodItemsService(centralDb)
  const mergeService = createFoodItemsMergeService(centralDb)

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

  router.patch<{ id: string }, FoodItemDetailResponse, UpdateFoodItemBody>(
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
      const updated = await updateFoodItem(req.user!, req.params.id, req.body)
      if (!updated) return res.status(404).json({ error: 'Food item not found', success: false })
      // Return the full detail (ingredients + derived + reference) so the UI
      // doesn't replace its cached detail with a stripped entity on rename.
      const detail = await service.getDetail(req.user!, req.params.id)
      if (!detail) return res.status(404).json({ error: 'Food item not found', success: false })
      res.json({ data: serializeDetail(detail), success: true })
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
      // Refresh the cached derived nutrients on this row + every parent
      // recipe that uses this item — keeps search results, frequent-meal
      // cards, and outer-recipe totals in sync without lazy recomputation.
      await cacheCompositeNutrients(user, centralDb, id)
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
      await clearCompositeNutrientCache(user, centralDb, id)
      const detail = await service.getDetail(user, id)
      if (!detail) return res.status(404).json({ error: 'Food item not found', success: false })
      res.json({ data: serializeDetail(detail), success: true })
    },
  )

  // Set the reference_food_item_id pointer on a per-user atomic item. The
  // target may be per-user or central. Composite items can't have a reference
  // (their nutrients are derived from ingredients).
  router.put<{ id: string }, FoodItemDetailResponse, SetFoodItemReferenceBody>(
    '/:id/reference',
    authMiddleware,
    validateBody(setFoodItemReferenceBodySchema),
    async (req, res) => {
      const user = req.user!
      const id = req.params.id
      const refId = req.body.reference_food_item_id
      const userItem = await getUserFoodItemById(user, id)
      if (!userItem) {
        const fromCentral = await centralDb.getSharedFoodItemById(id)
        return res.status(fromCentral ? 403 : 404).json({
          error: fromCentral ? 'Cannot set reference on shared library item' : 'Food item not found',
          success: false,
        })
      }
      if (refId !== null) {
        if (refId === id) {
          return res.status(400).json({ error: 'A food item cannot reference itself', success: false })
        }
        if (userItem.is_composite) {
          return res.status(400).json({
            error: 'Composite items cannot have a reference — nutrients are derived from ingredients',
            success: false,
          })
        }
        const ref = (await getUserFoodItemById(user, refId)) ?? (await centralDb.getSharedFoodItemById(refId))
        if (!ref) {
          return res.status(400).json({ error: 'Reference food item not found', success: false })
        }
        if (ref.is_composite) {
          return res.status(400).json({
            error:
              'Reference target cannot be a composite recipe — its nutrient columns are derived, not authoritative',
            success: false,
          })
        }
      }
      await dbSetFoodItemReference(user, id, refId)
      const detail = await service.getDetail(user, id)
      if (!detail) return res.status(404).json({ error: 'Food item not found', success: false })
      res.json({ data: serializeDetail(detail), success: true })
    },
  )

  // Clear the reference pointer.
  router.delete<{ id: string }, FoodItemDetailResponse>(
    '/:id/reference',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const id = req.params.id
      const userItem = await getUserFoodItemById(user, id)
      if (!userItem) {
        const fromCentral = await centralDb.getSharedFoodItemById(id)
        return res.status(fromCentral ? 403 : 404).json({
          error: fromCentral ? 'Cannot clear reference on shared library item' : 'Food item not found',
          success: false,
        })
      }
      await dbSetFoodItemReference(user, id, null)
      const detail = await service.getDetail(user, id)
      if (!detail) return res.status(404).json({ error: 'Food item not found', success: false })
      res.json({ data: serializeDetail(detail), success: true })
    },
  )

  // Preview a merge — counts of references that will be re-pointed, plus
  // empty target fields the source could fill. Lets the UI render a
  // confidence-building dialog before the user confirms.
  router.get<{ id: string }, MergeFoodItemsPreviewResponse, unknown, MergeFoodItemsQuery>(
    '/:id/merge-preview',
    authMiddleware,
    validateQuery(mergeFoodItemsQuerySchema),
    async (req, res) => {
      try {
        const preview = await mergeService.preview(req.user!, req.query.source_id, req.params.id)
        res.json({ data: preview, success: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Preview failed'
        res.status(/not found|cannot merge/i.test(message) ? 400 : 500).json({
          error: message,
          success: false,
        })
      }
    },
  )

  // Replace the sensitivity flags assigned to this food item. Works for
  // central library items too — the junction's food_item_id is a soft
  // pointer, so a user can flag a per-user OR a central row. The only
  // requirement is that the food item exists somewhere in the merged
  // library; otherwise we'd silently allow attaching flags to ghost ids.
  router.put<{ id: string }, FoodItemDetailResponse, SetFoodItemSensitivitiesBody>(
    '/:id/sensitivities',
    authMiddleware,
    validateBody(setFoodItemSensitivitiesBodySchema),
    async (req, res) => {
      const user = req.user!
      const id = req.params.id
      const exists =
        (await getUserFoodItemById(user, id)) !== null || (await centralDb.getSharedFoodItemById(id)) !== null
      if (!exists) {
        return res.status(404).json({ error: 'Food item not found', success: false })
      }
      try {
        await dbSetFoodItemSensitivities(user, id, req.body.sensitivity_flag_ids)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to set sensitivities'
        // FK violation when a flag id doesn't exist surfaces as a 400.
        return res.status(/foreign key|violates/i.test(message) ? 400 : 500).json({
          error: message,
          success: false,
        })
      }
      const detail = await service.getDetail(user, id)
      if (!detail) return res.status(404).json({ error: 'Food item not found', success: false })
      res.json({ data: serializeDetail(detail), success: true })
    },
  )

  // Re-snapshot every meal that contains this food item with the item's
  // current effective nutrient values. Useful after editing a composite recipe
  // or attaching/changing a reference — historical meals stay in sync only
  // when explicitly asked.
  router.post<{ id: string }, ResnapshotMealsResponse>(
    '/:id/resnapshot-meals',
    authMiddleware,
    async (req, res) => {
      try {
        const result = await resnapshotMealsForFoodItem(req.user!, req.params.id)
        res.json({ data: result, success: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Re-snapshot failed'
        res.status(/not found/i.test(message) ? 404 : 500).json({ error: message, success: false })
      }
    },
  )

  // Execute the merge.
  router.post<{ id: string }, MergeFoodItemsResponse, MergeFoodItemsBody>(
    '/:id/merge',
    authMiddleware,
    validateBody(mergeFoodItemsBodySchema),
    async (req, res) => {
      try {
        const result = await mergeService.merge(req.user!, req.body.source_id, req.params.id, {
          confirmDiscardIngredients: req.body.confirm_discard_ingredients,
          fillEmpty: req.body.fill_empty ?? false,
        })
        res.json({ data: result, success: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Merge failed'
        res.status(/not found|cannot merge|composite|itself/i.test(message) ? 400 : 500).json({
          error: message,
          success: false,
        })
      }
    },
  )

  return router
}
