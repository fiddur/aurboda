/**
 * Meals service — CRUD operations for meal/nutrition records.
 *
 * Handles adding, querying, and deleting meals with optional nutrition data.
 * Food items are stored relationally via the food_items + meal_food_items junction table.
 */

import { type FrequentFoodItem, type FrequentMeal, NUTRIENT_FIELD_NAMES } from '@aurboda/api-spec'

import {
  deleteMeal as dbDeleteMeal,
  getFrequentFoodItems as dbGetFrequentFoodItems,
  getFrequentMeals as dbGetFrequentMeals,
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
import { getCentralDb } from './central-db.ts'
import { createFoodItemsService, type MergedFoodItem } from './food-items.ts'

// ============================================================================
// Types
// ============================================================================

interface FoodItemInput {
  food_item_id?: string
  name: string
  quantity?: number
  unit?: string
  icon?: string
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
    icon: link.food_item_icon,
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

/**
 * Extract the macro fields the caller explicitly provided so the recompute
 * step can leave them alone (manual override wins).
 */
const pickExplicitMacros = (
  input: Partial<Record<'calories' | 'protein' | 'carbs' | 'fat' | 'fiber', number | null | undefined>>,
): Partial<Record<'calories' | 'protein' | 'carbs' | 'fat' | 'fiber', number | null>> => {
  const out: Partial<Record<'calories' | 'protein' | 'carbs' | 'fat' | 'fiber', number | null>> = {}
  for (const key of ['calories', 'protein', 'carbs', 'fat', 'fiber'] as const) {
    if (input[key] !== undefined) out[key] = input[key] as number | null
  }
  return out
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

/**
 * Compute the scale factor between a request's quantity and the canonical
 * food item's default quantity. Same-unit assumption — if the request unit
 * differs from the canonical default, fall back to scale = 1 (use raw values).
 */
const computeScale = (fi: FoodItemInput, canonical: MergedFoodItem): number => {
  const reqQty = fi.quantity
  const defaultQty = canonical.default_quantity as number | undefined
  if (reqQty === undefined || reqQty === null) return 1
  if (defaultQty === undefined || defaultQty === null || defaultQty === 0) return 1
  const canonicalUnit = canonical.default_unit as string | undefined
  if (fi.unit && canonicalUnit && fi.unit !== canonicalUnit) return 1
  return reqQty / defaultQty
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Build a junction row by snapshotting the canonical food item's nutrient
 * values scaled by quantity, plus the food item's name and icon. With the
 * name/icon snapshotted, meal reads no longer JOIN food_items — important
 * because the canonical row may live in the central DB.
 */
export const buildScaledJunctionItem = (
  fi: FoodItemInput,
  canonical: MergedFoodItem,
  sortOrder: number,
): Record<string, unknown> => {
  const scale = computeScale(fi, canonical)
  const junctionItem: Record<string, unknown> = {
    food_item_id: canonical.id,
    food_item_icon: (canonical.icon as string | undefined) ?? null,
    food_item_name: canonical.name,
    quantity: fi.quantity,
    sort_order: sortOrder,
    unit: fi.unit,
  }
  for (const field of NUTRIENT_FIELD_NAMES) {
    const canonicalVal = canonical[field]
    if (typeof canonicalVal === 'number') {
      junctionItem[field] = round2(canonicalVal * scale)
    }
  }
  return junctionItem
}

/**
 * Resolve a food item input to its canonical row, looking in both the user
 * DB and the central shared library.
 *
 * Prefer food_item_id when present; otherwise look up by name. When the
 * name matches a central library item (e.g. an LSV food) we bind to that
 * canonical row instead of creating a per-user duplicate.
 */
const resolveCanonical = async (
  user: string,
  fi: FoodItemInput,
  source: string,
): Promise<MergedFoodItem | null> => {
  const foodItems = createFoodItemsService(getCentralDb())
  if (fi.food_item_id) {
    const byId = await foodItems.getById(user, fi.food_item_id)
    if (byId) return byId
  }
  return foodItems.findOrCreate(user, fi.name, {
    default_quantity: fi.quantity,
    default_unit: fi.unit,
    icon: fi.icon,
    source,
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
    const canonical = await resolveCanonical(user, fi, source)
    if (!canonical) continue
    junctionItems.push(buildScaledJunctionItem(fi, canonical, i))
  }

  await setMealFoodItems(user, mealId, junctionItems as Parameters<typeof setMealFoodItems>[2])
}

/**
 * Recompute meal-level macros (calories/protein/carbs/fat/fiber) from the
 * current junction rows and persist them on the meal row.
 *
 * Macro keys present in `explicit` are skipped — the caller's request body
 * wins (manual override).
 */
const recomputeMealMacros = async (
  user: string,
  mealId: string,
  explicit: Partial<Record<'calories' | 'protein' | 'carbs' | 'fat' | 'fiber', number | null>> = {},
): Promise<Meal | null> => {
  const map = await getMealFoodItemsBatch(user, [mealId])
  const links = map.get(mealId) ?? []
  const totals = aggregateNutrients(links)
  const macroKeys = ['calories', 'protein', 'carbs', 'fat', 'fiber'] as const
  const update: Record<string, number | null> = {}
  for (const key of macroKeys) {
    if (key in explicit) continue
    update[key] = links.length === 0 ? null : (totals[key] ?? 0)
  }
  if (Object.keys(update).length === 0) return null
  return dbUpdateMeal(user, mealId, update)
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Add a new meal record.
 */
export async function addMeal(user: string, input: AddMealInput): Promise<MealResult> {
  const mealTime = new Date(input.time)

  const initialMeal = await dbUpsertMeal(user, {
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

  let meal = initialMeal
  if (input.food_items && input.food_items.length > 0) {
    await syncFoodItemsToJunction(user, meal.id, input.food_items, input.source)
    const recomputed = await recomputeMealMacros(user, meal.id, pickExplicitMacros(input))
    if (recomputed) meal = recomputed
  }

  return { data: formatMeal(meal), success: true }
}

/**
 * Update an existing meal record.
 */
export async function updateMealById(user: string, id: string, input: UpdateMealInput): Promise<MealResult> {
  const initialMeal = await dbUpdateMeal(user, id, {
    ...input,
    food_items: input.food_items === null ? null : input.food_items,
    micros: input.micros === null ? null : input.micros,
    time: input.time ? new Date(input.time) : undefined,
  })

  if (!initialMeal) {
    return { error: 'Meal not found', success: false }
  }

  let meal = initialMeal
  if (input.food_items !== undefined) {
    if (input.food_items === null || input.food_items.length === 0) {
      await setMealFoodItems(user, id, [])
    } else {
      await syncFoodItemsToJunction(user, id, input.food_items, meal.source)
    }
    const recomputed = await recomputeMealMacros(user, id, pickExplicitMacros(input))
    if (recomputed) meal = recomputed
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
 * Frequently-logged meal templates, grouped by name within a meal_type.
 *
 * Enriches each entry with the food items from the most recent occurrence so
 * the UI can re-log them with one tap. Icon is taken from the first food
 * item's `food_items.icon` (joined via the junction table).
 */
export async function queryFrequentMeals(
  user: string,
  filters: { meal_type: string; limit?: number; since_days?: number },
): Promise<{ success: true; data: FrequentMeal[] }> {
  const rows = await dbGetFrequentMeals(user, {
    limit: filters.limit ?? 6,
    meal_type: filters.meal_type,
    since_days: filters.since_days ?? 90,
  })

  if (rows.length === 0) return { data: [], success: true }

  const junctionMap = await getMealFoodItemsBatch(
    user,
    rows.map((r) => r.last_meal_id),
  )

  const data: FrequentMeal[] = rows.map((row) => {
    const links = junctionMap.get(row.last_meal_id) ?? []
    // Schema requires non-empty name on each food item — drop links missing one.
    const food_items = links
      .filter((link): link is typeof link & { food_item_name: string } => !!link.food_item_name)
      .map((link) => ({
        food_item_id: link.food_item_id,
        name: link.food_item_name,
        quantity: typeof link.quantity === 'number' ? link.quantity : undefined,
        unit: typeof link.unit === 'string' ? link.unit : undefined,
        icon: link.food_item_icon,
      }))
    const icon = food_items[0]?.icon ?? null
    return {
      name: row.name,
      meal_type: row.meal_type,
      count: row.count,
      last_time: row.last_time.toISOString(),
      icon,
      ...(food_items.length > 0 ? { food_items } : {}),
    }
  })

  return { data, success: true }
}

/**
 * Top-N food items by usage in the user's meal log over the last
 * `since_days`. Returns the snapshotted name/icon and the most recent
 * quantity/unit, so an MCP agent can suggest "your usual" without re-running
 * fuzzy search every time.
 */
export async function queryFrequentFoodItems(
  user: string,
  filters: { limit?: number; since_days?: number; meal_type?: string },
): Promise<{ success: true; data: FrequentFoodItem[] }> {
  const rows = await dbGetFrequentFoodItems(user, {
    limit: filters.limit ?? 10,
    meal_type: filters.meal_type,
    since_days: filters.since_days ?? 90,
  })
  return {
    data: rows.map((row) => ({
      count: row.count,
      food_item_id: row.food_item_id,
      icon: row.icon,
      last_quantity: row.last_quantity,
      last_unit: row.last_unit,
      last_used: row.last_used.toISOString(),
      name: row.name,
    })),
    success: true,
  }
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
