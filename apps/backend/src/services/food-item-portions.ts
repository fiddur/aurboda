/**
 * Food item portions service — CRUD on the additional sizings a user can
 * register for any food item (per-user or central). The food_item_id on
 * food_item_portions is a soft pointer, so a portion can target a per-user
 * food row OR a central shared row (e.g. an LSV food). To prevent users
 * creating portions for foods that don't actually exist we look up the id
 * across both stores via the food-items service before inserting.
 *
 * Setting a per-user food's preselected portion (default_portion_id) is
 * handled here too — it lives on the food_items row itself, but enforcing
 * "the chosen portion belongs to this food" is a service-layer concern.
 * Central food's preselected portion is a per-user thing and lives on
 * shared_food_item_overrides — covered in a later PR.
 */

import type { CentralDb } from './central-db.ts'

import {
  deleteFoodItemPortion as dbDeletePortion,
  type FoodItemPortionRow,
  getFoodItemPortionById,
  insertFoodItemPortion as dbInsertPortion,
  listPortionsForFoodItem,
  updateFoodItem as dbUpdateFoodItem,
  updateFoodItemPortion as dbUpdatePortion,
} from '../db/index.ts'
import { createFoodItemsService } from './food-items.ts'

export interface PortionInput {
  label_quantity: number
  label_unit: string
  base_equivalent: number
  sort_order?: number
}

export type PortionUpdateInput = Partial<PortionInput>

const ensureFoodExists = async (user: string, foodItemId: string, centralDb: CentralDb): Promise<void> => {
  const service = createFoodItemsService(centralDb)
  const food = await service.getById(user, foodItemId)
  if (!food) throw new Error(`Food item not found: ${foodItemId}`)
}

export const listPortions = async (user: string, foodItemId: string): Promise<FoodItemPortionRow[]> =>
  listPortionsForFoodItem(user, foodItemId)

export const addPortion = async (
  user: string,
  foodItemId: string,
  input: PortionInput,
  centralDb: CentralDb,
): Promise<FoodItemPortionRow> => {
  await ensureFoodExists(user, foodItemId, centralDb)
  return dbInsertPortion(user, { food_item_id: foodItemId, ...input })
}

export const updatePortion = async (
  user: string,
  portionId: string,
  input: PortionUpdateInput,
): Promise<FoodItemPortionRow> => {
  const existing = await getFoodItemPortionById(user, portionId)
  if (!existing) throw new Error(`Portion not found: ${portionId}`)
  const updated = await dbUpdatePortion(user, portionId, input)
  if (!updated) throw new Error(`Portion update failed: ${portionId}`)
  return updated
}

export const deletePortion = async (user: string, portionId: string): Promise<boolean> => {
  const existing = await getFoodItemPortionById(user, portionId)
  if (!existing) return false
  return dbDeletePortion(user, portionId)
}

/**
 * Set or clear a per-user food's preselected portion. The chosen portion must
 * belong to the food (defence-in-depth: a stale portion id from a different
 * food would otherwise silently render the default as "missing portion").
 * Central foods aren't editable here — their preselected portion is per-user
 * and goes on the override table (later PR).
 */
export const setDefaultPortion = async (
  user: string,
  foodItemId: string,
  portionId: string | null,
): Promise<void> => {
  if (portionId !== null) {
    const portion = await getFoodItemPortionById(user, portionId)
    if (!portion) throw new Error(`Portion not found: ${portionId}`)
    if (portion.food_item_id !== foodItemId) {
      throw new Error(`Portion ${portionId} does not belong to food item ${foodItemId}`)
    }
  }
  const updated = await dbUpdateFoodItem(user, foodItemId, { default_portion_id: portionId })
  if (!updated) {
    throw new Error(`Food item not found or not editable: ${foodItemId}`)
  }
}
