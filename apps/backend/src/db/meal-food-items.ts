/**
 * Meal ↔ Food Item junction table operations.
 *
 * Each junction row snapshots the canonical food item's name, icon, and
 * nutrient values at insertion time. food_item_id is a soft pointer — it
 * may resolve to a row in this user's `food_items` or to a row in the
 * central `shared_food_items` table — so we never JOIN food_items here.
 */

import { NUTRIENT_FIELD_NAMES } from '@aurboda/api-spec'

import type { MealFoodItemLink } from './types.ts'

import { query } from './connection.ts'

const JUNCTION_COLUMNS = [
  'id',
  'meal_id',
  'food_item_id',
  'food_item_name',
  'food_item_icon',
  'quantity',
  'unit',
  'sort_order',
  'sensitivities',
  ...NUTRIENT_FIELD_NAMES,
].join(', ')

const mapJunctionRow = (row: Record<string, unknown>): MealFoodItemLink => {
  const link: Record<string, unknown> = {
    id: row.id,
    meal_id: row.meal_id,
    food_item_id: row.food_item_id,
    food_item_name: row.food_item_name ?? undefined,
    food_item_icon: row.food_item_icon ?? undefined,
    quantity: row.quantity ?? undefined,
    unit: row.unit ?? undefined,
    sort_order: row.sort_order ?? 0,
    sensitivities: Array.isArray(row.sensitivities) ? (row.sensitivities as string[]) : undefined,
  }
  for (const field of NUTRIENT_FIELD_NAMES) {
    const val = row[field]
    if (val !== null && val !== undefined) link[field] = val
  }
  return link as unknown as MealFoodItemLink
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface MealFoodItemInput {
  food_item_id: string
  food_item_name?: string
  food_item_icon?: string
  quantity?: number
  unit?: string
  sort_order?: number
  sensitivities?: string[]
  [nutrient: string]: string | number | string[] | undefined
}

// ── Operations ───────────────────────────────────────────────────────────────

/**
 * Get all food items linked to a meal, ordered by sort_order.
 */
export const getMealFoodItems = async (user: string, mealId: string): Promise<MealFoodItemLink[]> => {
  const result = await query(
    user,
    `SELECT ${JUNCTION_COLUMNS}
     FROM meal_food_items
     WHERE meal_id = $1
     ORDER BY sort_order`,
    [mealId],
  )
  return result.rows.map(mapJunctionRow)
}

/**
 * Replace all food items for a meal (delete existing + bulk insert).
 */
export const setMealFoodItems = async (
  user: string,
  mealId: string,
  items: MealFoodItemInput[],
): Promise<void> => {
  await query(user, 'DELETE FROM meal_food_items WHERE meal_id = $1', [mealId])

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const fields = [
      'meal_id',
      'food_item_id',
      'food_item_name',
      'food_item_icon',
      'quantity',
      'unit',
      'sort_order',
      'sensitivities',
    ]
    const values: unknown[] = [
      mealId,
      item.food_item_id,
      item.food_item_name ?? null,
      item.food_item_icon ?? null,
      item.quantity ?? null,
      item.unit ?? null,
      item.sort_order ?? i,
      item.sensitivities ?? null,
    ]

    for (const field of NUTRIENT_FIELD_NAMES) {
      fields.push(field)
      values.push(item[field] ?? null)
    }

    const placeholders = values.map((_, j) => `$${j + 1}`).join(', ')
    await query(user, `INSERT INTO meal_food_items (${fields.join(', ')}) VALUES (${placeholders})`, values)
  }
}

/**
 * Find every distinct meal_id that has at least one junction row pointing at
 * the given food_item_id. Used by the re-snapshot flow to know which meals
 * to recompute when a food item's effective nutrients change.
 */
export const findMealsContainingFoodItem = async (user: string, foodItemId: string): Promise<string[]> => {
  const result = await query(
    user,
    'SELECT DISTINCT meal_id FROM meal_food_items WHERE food_item_id = $1 ORDER BY meal_id',
    [foodItemId],
  )
  return result.rows.map((row) => row.meal_id as string)
}

/**
 * Get food items for multiple meals at once (batch query).
 * Returns a map of meal_id → MealFoodItemLink[].
 */
export const getMealFoodItemsBatch = async (
  user: string,
  mealIds: string[],
): Promise<Map<string, MealFoodItemLink[]>> => {
  if (mealIds.length === 0) return new Map()

  const placeholders = mealIds.map((_, i) => `$${i + 1}`).join(', ')
  const result = await query(
    user,
    `SELECT ${JUNCTION_COLUMNS}
     FROM meal_food_items
     WHERE meal_id IN (${placeholders})
     ORDER BY meal_id, sort_order`,
    mealIds,
  )

  const map = new Map<string, MealFoodItemLink[]>()
  for (const row of result.rows) {
    const link = mapJunctionRow(row)
    const existing = map.get(link.meal_id) ?? []
    existing.push(link)
    map.set(link.meal_id, existing)
  }
  return map
}
