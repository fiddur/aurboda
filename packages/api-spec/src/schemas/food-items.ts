/**
 * Food item schemas — canonical food item library.
 *
 * Food items are first-class entities with their own table.
 * Meals reference food items via a junction table (meal_food_items).
 */

import { z } from 'zod'

import { baseResponseSchema, createDataArrayResponseSchema, createDataResponseSchema } from './common.ts'
import { nutrientFieldsSchema } from './nutrients.ts'

// ============================================================================
// Food Item Entity
// ============================================================================

/**
 * A canonical food item in the library.
 */
export const foodItemEntitySchema = nutrientFieldsSchema
  .extend({
    created_at: z.string().optional().meta({ description: 'Creation timestamp' }),
    default_quantity: z.number().optional().meta({ description: 'Default quantity (e.g., 1)' }),
    default_unit: z
      .string()
      .max(100)
      .optional()
      .meta({ description: 'Default unit (e.g., "g", "ml", "serving", "large slice")' }),
    icon: z
      .string()
      .max(2048)
      .optional()
      .meta({ description: 'Icon for this food item (emoji or image URL)' }),
    id: z.string().uuid().meta({ description: 'Food item ID' }),
    is_composite: z.boolean().optional().meta({
      description:
        'True if this is a composite (recipe) item — its nutrient values are derived from food_item_ingredients at read time.',
    }),
    name: z.string().min(1).max(255).meta({ description: 'Food item name' }),
    source: z
      .string()
      .max(50)
      .optional()
      .meta({ description: 'Data source (e.g., "cronometer", "oura", "manual", "livsmedelsverket")' }),
    source_id: z
      .string()
      .max(100)
      .optional()
      .meta({ description: 'Stable identifier from the upstream source (e.g. LSV nummer)' }),
    updated_at: z.string().optional().meta({ description: 'Last update timestamp' }),
  })
  .meta({ description: 'A canonical food item with default nutritional data', id: 'FoodItemEntity' })

export type FoodItemEntity = z.infer<typeof foodItemEntitySchema>

// ============================================================================
// Composite (recipe) ingredients
// ============================================================================

/**
 * One ingredient line in a composite food item — points at another food
 * (per-user or central), with quantity + unit. The pointed-at food's
 * nutrients are scaled by quantity/default_quantity at read time to
 * contribute to the parent's totals.
 */
export const foodItemIngredientSchema = z
  .object({
    ingredient_food_item_id: z
      .string()
      .uuid()
      .meta({ description: 'ID of the food item used as an ingredient (per-user OR central library)' }),
    quantity: z.number().meta({ description: 'Amount used, in `unit`' }),
    unit: z.string().max(100).optional().meta({ description: 'Unit for quantity' }),
    sort_order: z
      .number()
      .int()
      .optional()
      .meta({ description: 'Display order; defaults to position in the input array' }),
  })
  .meta({ description: 'One ingredient of a composite food item', id: 'FoodItemIngredient' })

export type FoodItemIngredient = z.infer<typeof foodItemIngredientSchema>

/**
 * Replace the full ingredients list for a composite item.
 */
export const setFoodItemIngredientsBodySchema = z
  .object({
    ingredients: z
      .array(foodItemIngredientSchema)
      .meta({ description: 'Full list of ingredients — replaces any existing ones' }),
  })
  .meta({ description: 'Replace the ingredients of a composite food item', id: 'SetFoodItemIngredientsBody' })

export type SetFoodItemIngredientsBody = z.infer<typeof setFoodItemIngredientsBodySchema>

/**
 * A resolved ingredient as returned from the detail endpoint — the
 * junction row plus a snapshot of the ingredient food item's name/icon
 * for display.
 */
export const resolvedFoodItemIngredientSchema = foodItemIngredientSchema
  .extend({
    name: z.string().nullable().meta({
      description: 'Ingredient food name (null if the pointed-at item was deleted)',
    }),
    icon: z.string().nullable().meta({ description: 'Ingredient icon (or null)' }),
  })
  .meta({ description: 'A composite ingredient with display info', id: 'ResolvedFoodItemIngredient' })

export type ResolvedFoodItemIngredient = z.infer<typeof resolvedFoodItemIngredientSchema>

/**
 * Detail response for a single food item. For composites, includes the
 * ingredient list plus derived nutrient totals (sum of each ingredient's
 * value × quantity/default_quantity, when units match). For atomic items,
 * `ingredients` and `derived_nutrients` are absent and the entity's own
 * nutrient values are authoritative.
 */
export const foodItemDetailSchema = foodItemEntitySchema
  .extend({
    ingredients: z.array(resolvedFoodItemIngredientSchema).optional(),
    derived_nutrients: z
      .object({
        values: z.record(z.string(), z.number()).meta({
          description: 'Summed nutrient values from the resolved ingredients',
        }),
        nutrient_data_incomplete: z.boolean().meta({
          description: 'True when one or more ingredients lack calorie data or could not be resolved',
        }),
      })
      .optional()
      .meta({ description: 'Nutrient totals derived from ingredients (composite items only)' }),
  })
  .meta({ description: 'Food item detail with optional composite ingredients', id: 'FoodItemDetail' })

export type FoodItemDetail = z.infer<typeof foodItemDetailSchema>

// ============================================================================
// Request Schemas
// ============================================================================

/**
 * Add food item request body.
 */
export const addFoodItemBodySchema = nutrientFieldsSchema
  .extend({
    default_quantity: z.number().optional().meta({ description: 'Default quantity' }),
    default_unit: z.string().max(100).optional().meta({ description: 'Default unit' }),
    icon: z.string().optional().meta({ description: 'Icon (emoji or image URL)' }),
    name: z.string().min(1).max(255).meta({ description: 'Food item name' }),
    source: z.string().max(50).optional().meta({ description: 'Data source' }),
  })
  .meta({ description: 'Create a canonical food item', id: 'AddFoodItemBody' })

export type AddFoodItemBody = z.infer<typeof addFoodItemBodySchema>

/**
 * Update food item request body — all fields optional.
 */
export const updateFoodItemBodySchema = nutrientFieldsSchema
  .extend({
    default_quantity: z.number().nullable().optional(),
    default_unit: z.string().max(100).nullable().optional(),
    icon: z.string().max(2048).nullable().optional(),
    name: z.string().min(1).max(255).optional(),
  })
  .meta({ description: 'Update a food item — only provided fields are changed', id: 'UpdateFoodItemBody' })

export type UpdateFoodItemBody = z.infer<typeof updateFoodItemBodySchema>

/**
 * Food items query — search by name prefix.
 */
export const foodItemsQuerySchema = z
  .object({
    limit: z.string().optional().meta({ description: 'Max results (default 20)' }),
    q: z.string().optional().meta({ description: 'Search query (prefix match on name)' }),
  })
  .meta({ description: 'Query parameters for searching food items', id: 'FoodItemsQuery' })

export type FoodItemsQuery = z.infer<typeof foodItemsQuerySchema>

// ============================================================================
// Response Schemas
// ============================================================================

export const foodItemResponseSchema = createDataResponseSchema(foodItemEntitySchema).meta({
  id: 'FoodItemResponse',
})

export type FoodItemResponse = z.infer<typeof foodItemResponseSchema>

export const foodItemDetailResponseSchema = createDataResponseSchema(foodItemDetailSchema).meta({
  id: 'FoodItemDetailResponse',
})

export type FoodItemDetailResponse = z.infer<typeof foodItemDetailResponseSchema>

export const foodItemsResponseSchema = createDataArrayResponseSchema(foodItemEntitySchema).meta({
  id: 'FoodItemsResponse',
})

export type FoodItemsResponse = z.infer<typeof foodItemsResponseSchema>

export const deleteFoodItemResponseSchema = baseResponseSchema.meta({ id: 'DeleteFoodItemResponse' })

export type DeleteFoodItemResponse = z.infer<typeof deleteFoodItemResponseSchema>
