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
  addFoodItemPortionBodySchema,
  foodItemsQuerySchema,
  setFoodItemIngredientsBodySchema,
  setFoodItemReferenceBodySchema,
  setSharedFoodItemOverrideBodySchema,
  updateFoodItemBodySchema,
  updateFoodItemPortionBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import type { CentralDb } from '../services/central-db.ts'

import {
  clearIngredients,
  deleteFoodItem,
  getFoodItemById as getUserFoodItemById,
  listFoodItems,
  setFoodItemReference,
  setIngredients,
  updateFoodItem,
  upsertFoodItem,
} from '../db/index.ts'
import { clearSharedFoodItemOverride, setSharedFoodItemOverride } from '../db/shared-food-item-overrides.ts'
import {
  addPortion,
  deletePortion,
  listPortions,
  setDefaultPortion,
  updatePortion,
} from '../services/food-item-portions.ts'
import {
  cacheCompositeNutrients,
  clearCompositeNutrientCache,
  createFoodItemsMergeService,
  createFoodItemsService,
} from '../services/food-items.ts'
import { resnapshotMealsForFoodItem } from '../services/meals.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerFoodItemTools = (server: McpServer, user: string, centralDb: CentralDb) => {
  const foodItems = createFoodItemsService(centralDb)
  const merge = createFoodItemsMergeService(centralDb)

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
      // Mirror the REST PATCH: return the full detail so callers see the
      // current ingredients / derived nutrients / reference enrichment, not
      // just the row columns.
      const detail = await foodItems.getDetail(user, id)
      if (!detail) return errorResponse('Food item not found')
      return jsonResponse({ data: detail, success: true })
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
      await cacheCompositeNutrients(user, centralDb, id)
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
      await clearCompositeNutrientCache(user, centralDb, id)
      const detail = await foodItems.getDetail(user, id)
      if (!detail) return errorResponse('Food item not found')
      return jsonResponse({ data: detail, success: true })
    },
  )

  server.tool(
    'set_food_item_reference',
    [
      "Point a per-user atomic food item at a reference food (per-user or central). The target inherits the reference's micronutrients on read, scaled by `self.default_quantity / reference.default_quantity` when units match. Self-set values always win; the reference only fills empty fields.",
      'Pass `reference_food_item_id: null` to clear the pointer. Composite items cannot have a reference (their nutrients are derived from ingredients).',
    ].join(' '),
    {
      id: z.string().uuid().describe('Food item ID (must be per-user)'),
      ...setFoodItemReferenceBodySchema.shape,
    },
    async ({ id, reference_food_item_id }) => {
      const userItem = await getUserFoodItemById(user, id)
      if (!userItem) {
        const fromCentral = await centralDb.getSharedFoodItemById(id)
        return errorResponse(
          fromCentral ? 'Cannot set reference on shared library item' : 'Food item not found',
        )
      }
      if (reference_food_item_id !== null) {
        if (reference_food_item_id === id) return errorResponse('A food item cannot reference itself')
        if (userItem.is_composite) {
          return errorResponse(
            'Composite items cannot have a reference — nutrients are derived from ingredients',
          )
        }
        const ref =
          (await getUserFoodItemById(user, reference_food_item_id)) ??
          (await centralDb.getSharedFoodItemById(reference_food_item_id))
        if (!ref) return errorResponse('Reference food item not found')
        if (ref.is_composite) {
          return errorResponse(
            'Reference target cannot be a composite recipe — its nutrient columns are derived, not authoritative',
          )
        }
      }
      await setFoodItemReference(user, id, reference_food_item_id)
      const detail = await foodItems.getDetail(user, id)
      if (!detail) return errorResponse('Food item not found')
      return jsonResponse({ data: detail, success: true })
    },
  )

  server.tool(
    'resnapshot_meals_for_food_item',
    [
      "Refresh every historical meal's snapshot of the given food item. For composites this picks up the latest derived nutrients (after editing ingredients); for reference-enriched items it picks up newly-inherited micros.",
      'Other food items in the same meal are left untouched. Returns counts of meals + junction rows updated.',
    ].join(' '),
    { id: z.string().uuid().describe('Food item ID whose meal snapshots should be refreshed') },
    async ({ id }) => {
      try {
        const result = await resnapshotMealsForFoodItem(user, id)
        return jsonResponse({ data: result, success: true })
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Re-snapshot failed')
      }
    },
  )

  server.tool(
    'preview_food_item_merge',
    [
      'Compute what merging one food item into another would do, without committing.',
      'Returns counts of meals/recipes that would re-point, whether the source is a composite (its ingredients would be discarded), and the empty target fields the source could fill.',
      'Source must be a per-user item; target may be per-user OR a central library item.',
    ].join(' '),
    {
      source_id: z.string().uuid().describe('Per-user food item to merge away'),
      target_id: z.string().uuid().describe('Food item to merge INTO (per-user or central)'),
    },
    async ({ source_id, target_id }) => {
      try {
        const preview = await merge.preview(user, source_id, target_id)
        return jsonResponse({ data: preview, success: true })
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Preview failed')
      }
    },
  )

  server.tool(
    'set_shared_food_item_override',
    [
      'Layer a per-user override onto a central shared food item (e.g. set your own icon on a Livsmedelsverket entry without forking it).',
      'The id must resolve to a central item — per-user items have no override layer; edit them directly with update_food_item.',
      'Pass `icon: null` to explicitly hide the central icon. At least one override field must be supplied — to revert to the central value entirely, use clear_shared_food_item_override.',
    ].join(' '),
    {
      id: z.string().uuid().describe('Central shared food item ID to override'),
      ...setSharedFoodItemOverrideBodySchema.shape,
    },
    async ({ id, ...input }) => {
      // The .refine on the body schema doesn't survive .shape destructuring,
      // so re-check the at-least-one-field invariant here.
      if (input.icon === undefined) {
        return errorResponse(
          'At least one override field must be supplied; use clear_shared_food_item_override to revert',
        )
      }
      const central = await centralDb.getSharedFoodItemById(id)
      if (!central) {
        const userItem = await getUserFoodItemById(user, id)
        return errorResponse(
          userItem
            ? 'Per-user items have no override layer — edit them directly via update_food_item'
            : 'Food item not found',
        )
      }
      const override = await setSharedFoodItemOverride(user, id, input)
      return jsonResponse({ data: override, success: true })
    },
  )

  server.tool(
    'clear_shared_food_item_override',
    "Remove the user's override layer on a central shared food item, reverting to the central row's values.",
    { id: z.string().uuid().describe('Central shared food item ID whose override should be cleared') },
    async ({ id }) => {
      const central = await centralDb.getSharedFoodItemById(id)
      if (!central) {
        const userItem = await getUserFoodItemById(user, id)
        return errorResponse(
          userItem
            ? 'Per-user items have no override layer — edit them directly via update_food_item'
            : 'Food item not found',
        )
      }
      const cleared = await clearSharedFoodItemOverride(user, id)
      return jsonResponse({ data: { cleared, shared_food_item_id: id }, success: true })
    },
  )

  // ────────────────────────────────────────────────────────────────────────
  // Portion sizings — additional (label_quantity, label_unit) entries per
  // food item; each portion stores `base_equivalent` which is how much of
  // the food's base unit the whole entry equals. Works for per-user OR
  // central food items via the soft pointer on food_item_id.
  // ────────────────────────────────────────────────────────────────────────

  server.tool(
    'list_food_item_portions',
    'List extra portion sizings for a food item (e.g. "1 wrap", "1 ruta"). The food item\'s own default_quantity/default_unit is the implicit base portion and is NOT included in this list.',
    { food_item_id: z.string().uuid().describe('Food item ID (per-user or central)') },
    async ({ food_item_id }) => {
      const userExists = await getUserFoodItemById(user, food_item_id)
      const centralExists = userExists ? null : await centralDb.getSharedFoodItemById(food_item_id)
      if (!userExists && !centralExists) return errorResponse('Food item not found')
      const rows = await listPortions(user, food_item_id)
      return jsonResponse({ data: rows, success: true })
    },
  )

  server.tool(
    'add_food_item_portion',
    [
      'Add a portion sizing to a food item. The portion expresses an equivalence "label_quantity label_unit = base_equivalent of the food\'s base unit".',
      'Example: for a 100 g chocolate base, "1 ruta = 3.4 g" stores label_quantity=1, label_unit="ruta", base_equivalent=3.4.',
      'Targets per-user OR central food items (soft pointer).',
    ].join(' '),
    {
      food_item_id: z.string().uuid().describe('Food item this portion belongs to (per-user or central)'),
      ...addFoodItemPortionBodySchema.shape,
    },
    async ({ food_item_id, ...input }) => {
      try {
        const row = await addPortion(user, food_item_id, input, centralDb)
        return jsonResponse({ data: row, success: true })
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Failed to add portion')
      }
    },
  )

  server.tool(
    'update_food_item_portion',
    'Update a portion sizing by id. Only provided fields are changed.',
    { id: z.string().uuid().describe('Portion id'), ...updateFoodItemPortionBodySchema.shape },
    async ({ id, ...input }) => {
      try {
        const row = await updatePortion(user, id, input)
        return jsonResponse({ data: row, success: true })
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Failed to update portion')
      }
    },
  )

  server.tool(
    'delete_food_item_portion',
    'Delete a portion sizing by id. If the parent food item had this portion set as default_portion_id, that pointer is cleared (reverts to the base portion).',
    { id: z.string().uuid().describe('Portion id') },
    async ({ id }) => {
      const ok = await deletePortion(user, id)
      if (!ok) return errorResponse('Portion not found')
      return jsonResponse({ success: true })
    },
  )

  server.tool(
    'set_default_food_item_portion',
    "Set or clear the preselected portion for a per-user food item. Pass `portion_id: null` to revert to the food's base portion. The chosen portion must belong to the food item. Central foods aren't editable here — use the override layer (coming).",
    {
      food_item_id: z.string().uuid().describe('Per-user food item id'),
      portion_id: z.string().uuid().nullable().describe('Portion id, or null to clear'),
    },
    async ({ food_item_id, portion_id }) => {
      try {
        await setDefaultPortion(user, food_item_id, portion_id)
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Failed to set default portion')
      }
      const detail = await foodItems.getDetail(user, food_item_id)
      if (!detail) return errorResponse('Food item not found')
      return jsonResponse({ data: detail, success: true })
    },
  )

  server.tool(
    'merge_food_items',
    [
      'Merge a per-user food item into another (per-user OR central). Past meal_food_items snapshots keep the nutrient values they were logged with — only the food_item_id pointer is re-pointed. Composite recipes that referenced the source are re-pointed too, so future derivations use the target.',
      "fill_empty=true copies the source's populated fields into the target wherever the target is empty (only when target is per-user). confirm_discard_ingredients=true is required when the source itself is a composite recipe — its ingredient list is dropped on merge.",
      'Run preview_food_item_merge first to surface the counts and fill candidates before committing.',
    ].join(' '),
    {
      source_id: z.string().uuid().describe('Per-user food item to merge away'),
      target_id: z.string().uuid().describe('Food item to merge INTO (per-user or central)'),
      fill_empty: z.boolean().optional().describe('Copy source values into empty target fields'),
      confirm_discard_ingredients: z
        .boolean()
        .optional()
        .describe('Required when the source is a composite recipe whose ingredients will be discarded'),
    },
    async ({ source_id, target_id, fill_empty, confirm_discard_ingredients }) => {
      try {
        const result = await merge.merge(user, source_id, target_id, {
          confirmDiscardIngredients: confirm_discard_ingredients,
          fillEmpty: fill_empty ?? false,
        })
        return jsonResponse({ data: result, success: true })
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Merge failed')
      }
    },
  )
}
