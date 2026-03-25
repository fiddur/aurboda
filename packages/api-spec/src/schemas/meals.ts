/**
 * Meal/nutrition schemas.
 *
 * Meals store food intake data from various sources (Oura, Cronometer, MyFitnessPal, manual).
 * Each meal can optionally include food items, macros, and micronutrients.
 */

import { z } from 'zod'

import {
  baseResponseSchema,
  createDataArrayResponseSchema,
  createDataResponseSchema,
  iso8601DateTimeSchema,
} from './common.ts'

// ============================================================================
// Meal Type
// ============================================================================

/**
 * Common meal type values.
 * Flexible string — not a closed enum so sources can pass their own types.
 */
export const mealTypeSchema = z.string().min(1).max(50).meta({
  description: 'Meal type (e.g., "breakfast", "lunch", "dinner", "snack")',
  example: 'lunch',
  id: 'MealType',
})

export type MealType = z.infer<typeof mealTypeSchema>

// ============================================================================
// Food Item
// ============================================================================

/**
 * An individual food item within a meal.
 */
export const foodItemSchema = z
  .object({
    calories: z.number().optional().meta({ description: 'Energy in kcal' }),
    carbs: z.number().optional().meta({ description: 'Carbohydrates in grams' }),
    fat: z.number().optional().meta({ description: 'Fat in grams' }),
    fiber: z.number().optional().meta({ description: 'Dietary fiber in grams' }),
    name: z.string().min(1).max(255).meta({ description: 'Food item name' }),
    protein: z.number().optional().meta({ description: 'Protein in grams' }),
    quantity: z.number().optional().meta({ description: 'Quantity consumed' }),
    unit: z
      .string()
      .max(30)
      .optional()
      .meta({ description: 'Unit for quantity (e.g., "g", "ml", "serving")' }),
  })
  .meta({ description: 'An individual food item within a meal', id: 'FoodItem' })

export type FoodItem = z.infer<typeof foodItemSchema>

// ============================================================================
// Meal
// ============================================================================

/**
 * A meal/nutrition record.
 */
export const mealSchema = z
  .object({
    calories: z.number().optional().meta({ description: 'Total energy in kcal' }),
    carbs: z.number().optional().meta({ description: 'Total carbohydrates in grams' }),
    created_at: iso8601DateTimeSchema.optional(),
    fat: z.number().optional().meta({ description: 'Total fat in grams' }),
    fiber: z.number().optional().meta({ description: 'Total dietary fiber in grams' }),
    food_items: z.array(foodItemSchema).optional().meta({ description: 'Individual food items' }),
    id: z.string().uuid().optional().meta({ description: 'Meal ID' }),
    meal_type: mealTypeSchema.optional().meta({ description: 'Type of meal' }),
    micros: z
      .record(z.string(), z.number())
      .optional()
      .meta({ description: 'Micronutrients as key-value pairs (e.g., {"vitamin_c": 45, "iron": 8})' }),
    name: z
      .string()
      .max(255)
      .optional()
      .meta({ description: 'Meal name/description (e.g., "Rye bread with peanut butter and banana")' }),
    notes: z.string().optional().meta({ description: 'Free text notes' }),
    protein: z.number().optional().meta({ description: 'Total protein in grams' }),
    sensitivities: z
      .array(z.string())
      .optional()
      .meta({ description: 'Sensitivity areas flagged for this meal (e.g., "gluten", "dairy", "red_meat")' }),
    source: z
      .string()
      .max(50)
      .optional()
      .meta({ description: 'Data source (e.g., "oura", "cronometer", "manual")' }),
    time: iso8601DateTimeSchema.meta({ description: 'When the meal was consumed' }),
  })
  .meta({ description: 'A meal/nutrition record', id: 'Meal' })

export type Meal = z.infer<typeof mealSchema>

// ============================================================================
// Request Schemas
// ============================================================================

/**
 * Add meal request body.
 */
export const addMealBodySchema = z
  .object({
    id: z
      .string()
      .uuid()
      .optional()
      .meta({ description: 'Client-generated meal ID (enables idempotent PUT)' }),
    calories: z.number().optional().meta({ description: 'Total energy in kcal' }),
    carbs: z.number().optional().meta({ description: 'Total carbohydrates in grams' }),
    fat: z.number().optional().meta({ description: 'Total fat in grams' }),
    fiber: z.number().optional().meta({ description: 'Total dietary fiber in grams' }),
    food_items: z.array(foodItemSchema).optional().meta({ description: 'Individual food items in the meal' }),
    meal_type: mealTypeSchema.optional().meta({ description: 'Type of meal' }),
    micros: z
      .record(z.string(), z.number())
      .optional()
      .meta({ description: 'Micronutrients as key-value pairs' }),
    name: z.string().max(255).optional().meta({ description: 'Meal name/description' }),
    notes: z.string().optional().meta({ description: 'Free text notes' }),
    protein: z.number().optional().meta({ description: 'Total protein in grams' }),
    sensitivities: z
      .array(z.string())
      .optional()
      .meta({ description: 'Sensitivity areas flagged for this meal (e.g., "gluten", "dairy", "red_meat")' }),
    source: z.string().max(50).optional().meta({ description: 'Data source' }),
    time: iso8601DateTimeSchema.meta({ description: 'When the meal was consumed' }),
  })
  .meta({
    description: 'Add a meal record with optional nutrition details',
    id: 'AddMealBody',
  })

export type AddMealBody = z.infer<typeof addMealBodySchema>

/**
 * Update meal request body — all fields optional.
 */
export const updateMealBodySchema = z
  .object({
    calories: z.number().nullable().optional().meta({ description: 'Total energy in kcal' }),
    carbs: z.number().nullable().optional().meta({ description: 'Total carbohydrates in grams' }),
    fat: z.number().nullable().optional().meta({ description: 'Total fat in grams' }),
    fiber: z.number().nullable().optional().meta({ description: 'Total dietary fiber in grams' }),
    food_items: z.array(foodItemSchema).nullable().optional().meta({ description: 'Individual food items' }),
    meal_type: mealTypeSchema.optional().meta({ description: 'Type of meal' }),
    micros: z.record(z.string(), z.number()).nullable().optional().meta({ description: 'Micronutrients' }),
    name: z.string().max(255).nullable().optional().meta({ description: 'Meal name/description' }),
    notes: z.string().nullable().optional().meta({ description: 'Free text notes' }),
    protein: z.number().nullable().optional().meta({ description: 'Total protein in grams' }),
    sensitivities: z
      .array(z.string())
      .nullable()
      .optional()
      .meta({ description: 'Sensitivity areas flagged for this meal' }),
    time: iso8601DateTimeSchema.optional().meta({ description: 'When the meal was consumed' }),
  })
  .meta({
    description: 'Update a meal record — only provided fields are changed',
    id: 'UpdateMealBody',
  })

export type UpdateMealBody = z.infer<typeof updateMealBodySchema>

/**
 * Meals query schema — filter by date range and/or meal type.
 */
export const mealsQuerySchema = z
  .object({
    end: iso8601DateTimeSchema.optional().meta({ description: 'End date/time filter' }),
    meal_type: z.string().optional().meta({ description: 'Filter by meal type' }),
    start: iso8601DateTimeSchema.optional().meta({ description: 'Start date/time filter' }),
  })
  .meta({ description: 'Query parameters for listing meals', id: 'MealsQuery' })

export type MealsQuery = z.infer<typeof mealsQuerySchema>

// ============================================================================
// Response Schemas
// ============================================================================

/**
 * Single meal response.
 */
export const mealResponseSchema = createDataResponseSchema(mealSchema).meta({
  id: 'MealResponse',
})

export type MealResponse = z.infer<typeof mealResponseSchema>

/**
 * Multiple meals response.
 */
export const mealsResponseSchema = createDataArrayResponseSchema(mealSchema).meta({
  id: 'MealsResponse',
})

export type MealsResponse = z.infer<typeof mealsResponseSchema>

/**
 * Delete meal response.
 */
export const deleteMealResponseSchema = baseResponseSchema.meta({ id: 'DeleteMealResponse' })

export type DeleteMealResponse = z.infer<typeof deleteMealResponseSchema>
