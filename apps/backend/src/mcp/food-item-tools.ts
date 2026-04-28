/**
 * MCP food item tools.
 *
 * Search and read go through the merged food-items service so MCP callers
 * see central shared-library items (e.g. Livsmedelsverket) alongside the
 * user's own. Writes (add/update/delete) target the per-user table only —
 * central rows are managed via the admin import flow, not from MCP.
 */

import {
  addFoodItemBodySchema,
  foodItemsQuerySchema,
  setFoodItemIngredientsBodySchema,
  updateFoodItemBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import type { CentralDb } from '../services/central-db.ts'

import {
  clearIngredients,
  deleteFoodItem,
  getFoodItemById as getUserFoodItemById,
  listFoodItems,
  setIngredients,
  updateFoodItem,
  upsertFoodItem,
} from '../db/index.ts'
import { createFoodItemsService } from '../services/food-items.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerFoodItemTools = (server: McpServer, user: string, centralDb: CentralDb) => {
  const foodItems = createFoodItemsService(centralDb)

  server.tool(
    'search_food_items',
    [
      "Search the merged food library: the user's private items plus any canonical reference data the admin has imported into the central shared library (national food databases, barcode-scanned products, etc. — what's available depends on which sources the admin has imported on this installation).",
      'Search is accent-insensitive and tolerates typos (trigram fuzzy matching). Returns up to `limit` items, user-private items first.',
      'Each result has an `id`, `name`, `source` (a string identifying where the row came from — `"manual"` means user-created; any other value indicates canonical reference data), `default_quantity`/`default_unit` (the "1 serving" basis the nutrient values are reported against), and per-serving nutrient values.',
      "To log a meal, pass the result's `id` to add_meal as `food_item_id` — never re-pass the name, that would create a per-user duplicate of a shared item. The backend scales nutrient values linearly by `quantity / default_quantity` when the meal's `unit` matches the canonical `default_unit`.",
      'Reference items may have non-English names. If a search misses, try synonyms in plausible source languages.',
    ].join(' '),
    { ...foodItemsQuerySchema.shape },
    async (params) => {
      const maxResults = params.limit ? parseInt(params.limit, 10) : 20
      const items = params.q
        ? await foodItems.search(user, params.q, maxResults)
        : await listFoodItems(user, maxResults)
      return jsonResponse({ data: items, success: true })
    },
  )

  server.tool(
    'add_food_item',
    'Create or update a per-user canonical food item with default nutritional data. Items in the central shared library cannot be edited from MCP — re-import from their upstream source instead.',
    { ...addFoodItemBodySchema.shape },
    async (params) => {
      const item = await upsertFoodItem(user, { ...params })
      return jsonResponse({ data: item, success: true })
    },
  )

  server.tool(
    'update_food_item',
    'Update a per-user food item by ID. Returns "Cannot edit shared library item" if the ID resolves to a central (shared) row.',
    { id: z.string().uuid().describe('Food item ID'), ...updateFoodItemBodySchema.shape },
    async ({ id, ...params }) => {
      const userItem = await getUserFoodItemById(user, id)
      if (!userItem) {
        const fromCentral = await centralDb.getSharedFoodItemById(id)
        return errorResponse(fromCentral ? 'Cannot edit shared library item' : 'Food item not found')
      }
      const item = await updateFoodItem(user, id, params)
      if (!item) return errorResponse('Food item not found')
      return jsonResponse({ data: item, success: true })
    },
  )

  server.tool(
    'delete_food_item',
    'Delete a per-user food item by ID. Returns "Cannot delete shared library item" for central rows.',
    { id: z.string().uuid().describe('Food item ID') },
    async ({ id }) => {
      const deleted = await deleteFoodItem(user, id)
      if (!deleted) {
        const fromCentral = await centralDb.getSharedFoodItemById(id)
        return errorResponse(fromCentral ? 'Cannot delete shared library item' : 'Food item not found')
      }
      return jsonResponse({ success: true })
    },
  )

  server.tool(
    'get_food_item',
    'Get a food item by ID — checks the user library first, then the central shared library. For composite (recipe) items, the response includes the resolved ingredients and derived nutrient totals.',
    { id: z.string().uuid().describe('Food item ID') },
    async ({ id }) => {
      const detail = await foodItems.getDetail(user, id)
      if (!detail) return errorResponse('Food item not found')
      return jsonResponse({ data: detail, success: true })
    },
  )

  server.tool(
    'set_food_item_ingredients',
    [
      "Mark a per-user food item as composite (a recipe) and replace its full ingredient list. The item's nutrient values become derived: at read time we sum each ingredient's value × quantity / default_quantity (when units match).",
      'Each ingredient points at another food item by `ingredient_food_item_id` — may be a per-user food OR a central library item. Cycles (A → B → A) are rejected.',
      'Only per-user items can be made composite; central shared-library rows return an error.',
    ].join(' '),
    {
      id: z.string().uuid().describe('Composite food item ID (the parent)'),
      ...setFoodItemIngredientsBodySchema.shape,
    },
    async ({ id, ingredients }) => {
      const userItem = await getUserFoodItemById(user, id)
      if (!userItem) {
        const fromCentral = await centralDb.getSharedFoodItemById(id)
        return errorResponse(
          fromCentral ? 'Cannot set ingredients on shared library item' : 'Food item not found',
        )
      }
      const ingredientIds = ingredients.map((i) => i.ingredient_food_item_id)
      if (await foodItems.wouldCreateCycle(user, id, ingredientIds)) {
        return errorResponse('Setting these ingredients would create a cycle in the recipe graph')
      }
      await setIngredients(user, id, ingredients)
      const detail = await foodItems.getDetail(user, id)
      if (!detail) return errorResponse('Food item not found')
      return jsonResponse({ data: detail, success: true })
    },
  )

  server.tool(
    'clear_food_item_ingredients',
    "Wipe all ingredients on a composite food item and revert it to atomic mode. The item's own nutrient values become authoritative again (whatever was last stored — typically zeros).",
    { id: z.string().uuid().describe('Composite food item ID') },
    async ({ id }) => {
      const userItem = await getUserFoodItemById(user, id)
      if (!userItem) {
        const fromCentral = await centralDb.getSharedFoodItemById(id)
        return errorResponse(
          fromCentral ? 'Cannot clear ingredients on shared library item' : 'Food item not found',
        )
      }
      await clearIngredients(user, id)
      const detail = await foodItems.getDetail(user, id)
      if (!detail) return errorResponse('Food item not found')
      return jsonResponse({ data: detail, success: true })
    },
  )
}
