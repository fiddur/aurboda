/**
 * Meals service — CRUD operations for meal/nutrition records.
 *
 * Handles adding, querying, and deleting meals with optional nutrition data.
 * Food items are stored relationally via the food_items + meal_food_items junction table.
 */

import { NUTRIENT_FIELD_NAMES } from '@aurboda/api-spec'

import {
  deleteMeal as dbDeleteMeal,
  findOrCreateFoodItem,
  getMealById as dbGetMealById,
  getMealFoodItemsBatch,
  getMeals as dbGetMeals,
  setMealFoodItems,
  updateMeal as dbUpdateMeal,
  upsertMeal as dbUpsertMeal,
  type Meal,
  type MealFoodItem,
  type MealFoodItemLink,
  type Micros,
} from '../db/index.ts'

// ============================================================================
// Types
// ============================================================================

interface FoodItemInput {
  name: string
  quantity?: number
  unit?: string
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  fiber?: number
}

export interface AddMealInput {
  id?: string
  time: string // ISO 8601
  meal_type?: string
  name?: string
  source?: string
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  fiber?: number
  food_items?: FoodItemInput[]
  micros?: Micros
  notes?: string
  sensitivities?: string[]
}

export interface UpdateMealInput {
  time?: string
  meal_type?: string
  name?: string | null
  calories?: number | null
  protein?: number | null
  carbs?: number | null
  fat?: number | null
  fiber?: number | null
  food_items?: FoodItemInput[] | null
  micros?: Micros | null
  notes?: string | null
  sensitivities?: string[] | null
}

interface MealResponse {
  id: string
  time: string
  meal_type?: string
  name?: string
  source: string
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  fiber?: number
  food_items?: MealFoodItem[]
  micros?: Micros
  notes?: string
  nutrients?: Record<string, number>
  nutrient_data_incomplete?: boolean
  sensitivities?: string[]
  created_at: string
}

interface MealResult {
  success: boolean
  data?: MealResponse
  error?: string
}

interface MealsResult {
  success: boolean
  data?: MealResponse[]
  error?: string
}

// ============================================================================
// Helpers
// ============================================================================

type EnrichedMeal = Meal & { nutrients?: Record<string, number>; nutrient_data_incomplete?: boolean }

const formatMeal = (meal: EnrichedMeal): MealResponse => ({
  calories: meal.calories,
  carbs: meal.carbs,
  created_at: meal.created_at.toISOString(),
  fat: meal.fat,
  fiber: meal.fiber,
  food_items: meal.food_items,
  id: meal.id,
  meal_type: meal.meal_type,
  micros: meal.micros,
  name: meal.name,
  notes: meal.notes,
  nutrient_data_incomplete: meal.nutrient_data_incomplete,
  nutrients: meal.nutrients,
  protein: meal.protein,
  sensitivities: meal.sensitivities,
  source: meal.source,
  time: meal.time.toISOString(),
})

/** Convert junction links to the MealFoodItem format for API responses. */
const linksToFoodItems = (links: MealFoodItemLink[]): MealFoodItem[] =>
  links.map((link) => ({
    food_item_id: link.food_item_id,
    name: link.food_item_name ?? '',
    icon: link.food_item_icon as string | undefined,
    quantity: link.quantity as number | undefined,
    unit: link.unit as string | undefined,
    calories: link.calories as number | undefined,
    protein: link.protein as number | undefined,
    carbs: link.carbs as number | undefined,
    fat: link.fat as number | undefined,
    fiber: link.fiber as number | undefined,
  }))

/** Aggregate all nutrient columns from junction links into a flat record. */
const aggregateNutrients = (links: MealFoodItemLink[]): Record<string, number> => {
  const totals: Record<string, number> = {}
  for (const link of links) {
    for (const field of NUTRIENT_FIELD_NAMES) {
      const val = link[field]
      if (typeof val === 'number' && val > 0) {
        totals[field] = (totals[field] ?? 0) + val
      }
    }
  }
  // Round to 2 decimal places
  for (const key of Object.keys(totals)) {
    totals[key] = Math.round(totals[key] * 100) / 100
  }
  return totals
}

/** Check if any food item in the junction links lacks calorie data. */
export const hasIncompleteNutrients = (links: MealFoodItemLink[]): boolean =>
  links.some((link) => link.calories === undefined || link.calories === null)

/** Attach food items and aggregated nutrients from junction table to meals. */
const attachFoodItems = async (user: string, meals: Meal[]): Promise<EnrichedMeal[]> => {
  const mealIds = meals.map((m) => m.id)
  const junctionMap = await getMealFoodItemsBatch(user, mealIds)

  return meals.map((meal) => {
    const links = junctionMap.get(meal.id)
    if (links && links.length > 0) {
      const nutrients = aggregateNutrients(links)
      const incomplete = hasIncompleteNutrients(links)
      return {
        ...meal,
        food_items: linksToFoodItems(links),
        nutrients,
        ...(incomplete ? { nutrient_data_incomplete: true } : {}),
      }
    }
    // Fall back to JSONB food_items if no junction rows exist (legacy data)
    return meal
  })
}

/** Write food items to the junction table for a meal. */
const syncFoodItemsToJunction = async (
  user: string,
  mealId: string,
  foodItems: FoodItemInput[],
  source = 'manual',
): Promise<void> => {
  const junctionItems = []
  for (let i = 0; i < foodItems.length; i++) {
    const fi = foodItems[i]
    // Find or create canonical food item with the macro defaults
    const canonical = await findOrCreateFoodItem(user, fi.name, {
      source,
      default_quantity: fi.quantity,
      default_unit: fi.unit,
      calories: fi.calories,
      protein: fi.protein,
      carbs: fi.carbs,
      fat: fi.fat,
      fiber: fi.fiber,
    })

    // Copy ALL nutrients from canonical food item as snapshot, then override with any
    // explicit values from the input (the input may have manually adjusted macros)
    const junctionItem: Record<string, unknown> = {
      food_item_id: canonical.id,
      quantity: fi.quantity,
      unit: fi.unit,
      sort_order: i,
    }
    // First: copy all nutrients from canonical item
    for (const field of NUTRIENT_FIELD_NAMES) {
      const canonicalVal = canonical[field]
      if (typeof canonicalVal === 'number') junctionItem[field] = canonicalVal
    }
    // Then: override with any explicit input values (manual edits)
    if (fi.calories !== undefined) junctionItem.calories = fi.calories
    if (fi.protein !== undefined) junctionItem.protein = fi.protein
    if (fi.carbs !== undefined) junctionItem.carbs = fi.carbs
    if (fi.fat !== undefined) junctionItem.fat = fi.fat
    if (fi.fiber !== undefined) junctionItem.fiber = fi.fiber
    junctionItems.push(junctionItem)
  }

  await setMealFoodItems(user, mealId, junctionItems as Parameters<typeof setMealFoodItems>[2])
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Add a new meal record.
 */
export async function addMeal(user: string, input: AddMealInput): Promise<MealResult> {
  const mealTime = new Date(input.time)

  const meal = await dbUpsertMeal(user, {
    id: input.id,
    calories: input.calories,
    carbs: input.carbs,
    fat: input.fat,
    fiber: input.fiber,
    food_items: input.food_items,
    meal_type: input.meal_type,
    micros: input.micros,
    name: input.name,
    notes: input.notes,
    protein: input.protein,
    sensitivities: input.sensitivities,
    source: input.source,
    time: mealTime,
  })

  // Write junction table rows for food items
  if (input.food_items && input.food_items.length > 0) {
    await syncFoodItemsToJunction(user, meal.id, input.food_items, input.source)
  }

  return { data: formatMeal(meal), success: true }
}

/**
 * Update an existing meal record.
 */
export async function updateMealById(user: string, id: string, input: UpdateMealInput): Promise<MealResult> {
  const meal = await dbUpdateMeal(user, id, {
    ...input,
    food_items: input.food_items === null ? null : input.food_items,
    micros: input.micros === null ? null : input.micros,
    time: input.time ? new Date(input.time) : undefined,
  })

  if (!meal) {
    return { error: 'Meal not found', success: false }
  }

  // Update junction table if food items changed
  if (input.food_items !== undefined) {
    if (input.food_items === null || input.food_items.length === 0) {
      await setMealFoodItems(user, id, [])
    } else {
      await syncFoodItemsToJunction(user, id, input.food_items, meal.source)
    }
  }

  return { data: formatMeal(meal), success: true }
}

/**
 * Get a single meal by ID.
 */
export async function getMeal(user: string, id: string): Promise<MealResult> {
  const meal = await dbGetMealById(user, id)
  if (!meal) {
    return { error: 'Meal not found', success: false }
  }

  // Populate food items from junction table
  const [enriched] = await attachFoodItems(user, [meal])
  return { data: formatMeal(enriched), success: true }
}

/**
 * Query meals with optional filters.
 */
export async function queryMeals(
  user: string,
  filters: { meal_type?: string; start?: string; end?: string },
): Promise<MealsResult> {
  const meals = await dbGetMeals(user, {
    end: filters.end ? new Date(filters.end) : undefined,
    meal_type: filters.meal_type,
    start: filters.start ? new Date(filters.start) : undefined,
  })

  // Populate food items from junction table
  const enriched = await attachFoodItems(user, meals)
  return { data: enriched.map(formatMeal), success: true }
}

/**
 * Delete a meal by ID.
 */
export async function deleteMealById(
  user: string,
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const deleted = await dbDeleteMeal(user, id)
  if (!deleted) {
    return { error: 'Meal not found', success: false }
  }
  return { success: true }
}
