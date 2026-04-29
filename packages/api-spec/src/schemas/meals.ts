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
// Nutrient Value
// ============================================================================

/**
 * A nutrient measurement with explicit unit.
 * Supports both simple numbers (legacy, unit implied by key) and structured { value, unit }.
 */
export const nutrientValueSchema = z
  .object({
    unit: z.string().max(10).meta({ description: 'Unit of measurement (e.g., "mg", "µg", "g", "IU")' }),
    value: z.number().meta({ description: 'Numeric value' }),
  })
  .meta({ description: 'A nutrient measurement with value and unit', id: 'NutrientValue' })

export type NutrientValue = z.infer<typeof nutrientValueSchema>

/**
 * Micronutrient record — maps nutrient name to either a plain number (legacy)
 * or a structured { value, unit } for explicit unit tracking.
 *
 * Keys are normalized nutrient names without units: "b1_thiamine", "vitamin_c", "iron".
 */
export const microsSchema = z
  .record(z.string(), z.union([z.number(), nutrientValueSchema]))
  .optional()
  .meta({
    description:
      'Micronutrients as key-value pairs. Values can be plain numbers (legacy) or { value, unit } for explicit units.',
  })

export type Micros = z.infer<typeof microsSchema>

// ============================================================================
// Food Item
// ============================================================================

/**
 * An individual food item within a meal — response shape.
 *
 * Nutrient values are returned as the snapshot stored on the meal_food_items
 * junction row (canonical × scale at the time of save). They are NOT accepted
 * on input — see foodItemInputSchema.
 */
export const foodItemSchema = z
  .object({
    calories: z.number().optional().meta({ description: 'Energy in kcal' }),
    carbs: z.number().optional().meta({ description: 'Carbohydrates in grams' }),
    fat: z.number().optional().meta({ description: 'Fat in grams' }),
    fiber: z.number().optional().meta({ description: 'Dietary fiber in grams' }),
    food_item_id: z.string().uuid().optional().meta({ description: 'Link to canonical food item entity' }),
    icon: z
      .string()
      .max(2048)
      .optional()
      .meta({ description: 'Icon for this food item (emoji or image URL)' }),
    micros: microsSchema.meta({ description: 'Micronutrients for this food item' }),
    name: z.string().min(1).max(255).meta({ description: 'Food item name' }),
    protein: z.number().optional().meta({ description: 'Protein in grams' }),
    quantity: z.number().optional().meta({ description: 'Quantity consumed' }),
    unit: z
      .string()
      .max(100)
      .optional()
      .meta({ description: 'Unit for quantity (e.g., "g", "ml", "large slice", "full recipe")' }),
  })
  .meta({ description: 'An individual food item within a meal', id: 'FoodItem' })

export type FoodItem = z.infer<typeof foodItemSchema>

/**
 * Input shape for a food item in a meal request body.
 *
 * Per-item nutrient values are derived server-side from the canonical food
 * item entity scaled by quantity. Callers identify the food via food_item_id
 * (preferred) or name (auto-creates a canonical entry if no match).
 */
export const foodItemInputSchema = z
  .object({
    food_item_id: z.string().uuid().optional().meta({
      description:
        'ID of a canonical food item (use the `id` returned by search_food_items). Preferred over `name` — binding by ID avoids creating per-user duplicates of items already in the shared library.',
    }),
    icon: z
      .string()
      .max(2048)
      .optional()
      .meta({ description: 'Icon for this food item (emoji or image URL)' }),
    name: z.string().min(1).max(255).meta({
      description:
        'Food item name. Used as a label and, when food_item_id is omitted, as the lookup key (matches an existing item by name first, otherwise creates a new per-user item).',
    }),
    quantity: z.number().optional().meta({
      description:
        "Amount consumed, in `unit`. If unit matches the canonical food item's default_unit, the backend scales nutrients by quantity / default_quantity. If units differ, no scaling is applied (canonical values are used as-is).",
    }),
    unit: z.string().max(100).optional().meta({
      description:
        'Unit for quantity (e.g., "g", "ml", "large slice", "full recipe"). For best scaling, use the canonical food item\'s default_unit (returned by search_food_items).',
    }),
  })
  .meta({ description: 'Input shape for a food item in a meal request body', id: 'FoodItemInput' })

export type FoodItemInput = z.infer<typeof foodItemInputSchema>

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
    micros: microsSchema.meta({
      description: 'Micronutrients — keys are nutrient names, values are numbers (legacy) or { value, unit }',
    }),
    name: z
      .string()
      .max(255)
      .optional()
      .meta({ description: 'Meal name/description (e.g., "Rye bread with peanut butter and banana")' }),
    notes: z.string().optional().meta({ description: 'Free text notes' }),
    nutrient_data_incomplete: z.boolean().optional().meta({
      description:
        'True if any food item in the meal lacks calorie data, indicating nutrient totals may be understated',
    }),
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
    food_items: z
      .array(foodItemInputSchema)
      .optional()
      .meta({ description: 'Individual food items in the meal' }),
    meal_type: mealTypeSchema.optional().meta({ description: 'Type of meal' }),
    micros: microsSchema.meta({ description: 'Micronutrients' }),
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
    food_items: z
      .array(foodItemInputSchema)
      .nullable()
      .optional()
      .meta({ description: 'Individual food items' }),
    meal_type: mealTypeSchema.optional().meta({ description: 'Type of meal' }),
    micros: microsSchema.nullable().meta({ description: 'Micronutrients' }),
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
    date: z.string().optional().meta({ description: 'Local date (YYYY-MM-DD) for log_completed check' }),
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
export const mealsResponseSchema = createDataArrayResponseSchema(mealSchema)
  .extend({
    log_completed: z
      .boolean()
      .optional()
      .meta({ description: 'Whether meal logging is marked complete for the queried date' }),
  })
  .meta({ id: 'MealsResponse' })

export type MealsResponse = z.infer<typeof mealsResponseSchema>

/**
 * Delete meal response.
 */
export const deleteMealResponseSchema = baseResponseSchema.meta({ id: 'DeleteMealResponse' })

export type DeleteMealResponse = z.infer<typeof deleteMealResponseSchema>

// ============================================================================
// Frequent Meals
// ============================================================================

/**
 * Query parameters for the frequent-meals endpoint.
 *
 * Always scoped to a single meal_type — frequent breakfasts shouldn't be
 * suggested as lunches.
 */
export const frequentMealsQuerySchema = z
  .object({
    meal_type: mealTypeSchema.meta({ description: 'Meal type to scope the lookup to (required)' }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(6)
      .meta({ description: 'Maximum number of distinct meal names to return' }),
    since_days: z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .default(90)
      .meta({ description: 'How many days back to consider when computing frequency' }),
  })
  .meta({ description: 'Query parameters for the frequent-meals endpoint', id: 'FrequentMealsQuery' })

export type FrequentMealsQuery = z.infer<typeof frequentMealsQuerySchema>

/**
 * A meal name the user logs repeatedly, with the most recent occurrence's
 * food items so it can be re-logged with one tap.
 */
export const frequentMealSchema = z
  .object({
    name: z.string().min(1).max(255).meta({ description: 'Meal name' }),
    meal_type: mealTypeSchema.meta({ description: 'Meal type this template was logged under' }),
    count: z.number().int().meta({ description: 'How many times this name was logged in the window' }),
    last_time: iso8601DateTimeSchema.meta({ description: 'Time of the most recent occurrence' }),
    icon: z
      .string()
      .max(2048)
      .nullable()
      .meta({ description: 'Icon for the chip — first food item icon, or null' }),
    food_items: z
      .array(foodItemInputSchema)
      .optional()
      .meta({ description: 'Food items from the most recent occurrence, suitable as input to add_meal' }),
  })
  .meta({ description: 'A frequently-logged meal template', id: 'FrequentMeal' })

export type FrequentMeal = z.infer<typeof frequentMealSchema>

export const frequentMealsResponseSchema = createDataArrayResponseSchema(frequentMealSchema).meta({
  id: 'FrequentMealsResponse',
})

export type FrequentMealsResponse = z.infer<typeof frequentMealsResponseSchema>

// ============================================================================
// Frequent food items
// ============================================================================

/**
 * Query parameters for surfacing the food items a user logs most often. Helps
 * an MCP agent suggest "your usual" without re-searching every time, and
 * backs the per-slot quick-log chips on the meals overview.
 */
export const frequentFoodItemsQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .meta({ description: 'Maximum number of food items to return' }),
    since_days: z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .default(90)
      .meta({ description: 'How many days back to consider when computing frequency' }),
    meal_type: mealTypeSchema.optional().meta({
      description:
        'Optional: only count food items used in meals of this meal_type (e.g. "breakfast"). Lets the UI suggest different "your usuals" per slot.',
    }),
  })
  .meta({ description: 'Query parameters for frequent-food-items', id: 'FrequentFoodItemsQuery' })

export type FrequentFoodItemsQuery = z.infer<typeof frequentFoodItemsQuerySchema>

export const frequentFoodItemSchema = z
  .object({
    food_item_id: z.string().uuid().meta({
      description:
        'ID of the canonical food item — pass to add_meal as `food_item_id`. May resolve to a per-user item or a central shared-library item.',
    }),
    name: z.string().meta({ description: 'Snapshotted name from the most recent meal use' }),
    icon: z.string().nullable().meta({ description: 'Snapshotted icon, or null' }),
    count: z.number().int().meta({ description: 'How many times the user logged this food in the window' }),
    last_used: iso8601DateTimeSchema.meta({ description: 'Time of the most recent meal that used it' }),
    last_quantity: z.number().nullable().meta({
      description: 'Quantity used in the most recent occurrence (a sensible default for re-logging)',
    }),
    last_unit: z.string().nullable().meta({ description: 'Unit used in the most recent occurrence' }),
  })
  .meta({ description: 'A food item the user logs repeatedly', id: 'FrequentFoodItem' })

export type FrequentFoodItem = z.infer<typeof frequentFoodItemSchema>

export const frequentFoodItemsResponseSchema = createDataArrayResponseSchema(frequentFoodItemSchema).meta({
  id: 'FrequentFoodItemsResponse',
})

export type FrequentFoodItemsResponse = z.infer<typeof frequentFoodItemsResponseSchema>
