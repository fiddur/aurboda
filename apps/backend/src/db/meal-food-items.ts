/**
 * Meal ↔ Food Item junction table operations.
 *
 * Links meals to canonical food items with per-serving nutrient snapshots.
 */

import { NUTRIENT_FIELD_NAMES } from '@aurboda/api-spec'

import type { MealFoodItemLink } from './types.ts'

import { query } from './connection.ts'

const JUNCTION_COLUMNS = [
  'mfi.id',
  'mfi.meal_id',
  'mfi.food_item_id',
  'fi.name AS food_item_name',
  'mfi.quantity',
  'mfi.unit',
  'mfi.sort_order',
  ...NUTRIENT_FIELD_NAMES.map((f) => `mfi.${f}`),
].join(', ')

const mapJunctionRow = (row: Record<string, unknown>): MealFoodItemLink => {
  const link: Record<string, unknown> = {
    id: row.id,
    meal_id: row.meal_id,
    food_item_id: row.food_item_id,
    food_item_name: row.food_item_name ?? undefined,
    quantity: row.quantity ?? undefined,
    unit: row.unit ?? undefined,
    sort_order: row.sort_order ?? 0,
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
  quantity?: number
  unit?: string
  sort_order?: number
  [nutrient: string]: string | number | undefined
}

// ── Operations ───────────────────────────────────────────────────────────────

/**
 * Get all food items linked to a meal, ordered by sort_order.
 */
export const getMealFoodItems = async (user: string, mealId: string): Promise<MealFoodItemLink[]> => {
  const result = await query(
    user,
    `SELECT ${JUNCTION_COLUMNS}
     FROM meal_food_items mfi
     JOIN food_items fi ON fi.id = mfi.food_item_id
     WHERE mfi.meal_id = $1
     ORDER BY mfi.sort_order`,
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
    const fields = ['meal_id', 'food_item_id', 'quantity', 'unit', 'sort_order']
    const values: unknown[] = [
      mealId,
      item.food_item_id,
      item.quantity ?? null,
      item.unit ?? null,
      item.sort_order ?? i,
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
     FROM meal_food_items mfi
     JOIN food_items fi ON fi.id = mfi.food_item_id
     WHERE mfi.meal_id IN (${placeholders})
     ORDER BY mfi.meal_id, mfi.sort_order`,
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
