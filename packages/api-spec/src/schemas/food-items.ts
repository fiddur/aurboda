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
    icon: z.string().optional().meta({ description: 'Icon for this food item (emoji or image URL)' }),
    id: z.string().uuid().meta({ description: 'Food item ID' }),
    name: z.string().min(1).max(255).meta({ description: 'Food item name' }),
    source: z
      .string()
      .max(50)
      .optional()
      .meta({ description: 'Data source (e.g., "cronometer", "oura", "manual", "livsmedelsverket")' }),
    updated_at: z.string().optional().meta({ description: 'Last update timestamp' }),
  })
  .meta({ description: 'A canonical food item with default nutritional data', id: 'FoodItemEntity' })

export type FoodItemEntity = z.infer<typeof foodItemEntitySchema>

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
    icon: z.string().nullable().optional(),
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

export const foodItemsResponseSchema = createDataArrayResponseSchema(foodItemEntitySchema).meta({
  id: 'FoodItemsResponse',
})

export type FoodItemsResponse = z.infer<typeof foodItemsResponseSchema>

export const deleteFoodItemResponseSchema = baseResponseSchema.meta({ id: 'DeleteFoodItemResponse' })

export type DeleteFoodItemResponse = z.infer<typeof deleteFoodItemResponseSchema>
