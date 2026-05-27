/**
 * Food item portions — additional sizings for a food item beyond its base
 * (default_quantity, default_unit).
 *
 * `food_item_id` is a soft pointer (no FK) so portions can target a per-user
 * `food_items` row or a central `shared_food_items` row. Cascade on per-user
 * food deletion is handled in app code (deleteFoodItem).
 */

import { query } from './connection.ts'

export interface FoodItemPortionRow {
  id: string
  food_item_id: string
  label_quantity: number
  label_unit: string
  base_equivalent: number
  sort_order: number
  created_at: Date
  updated_at: Date
}

export interface InsertFoodItemPortionInput {
  food_item_id: string
  label_quantity: number
  label_unit: string
  base_equivalent: number
  sort_order?: number
}

export interface UpdateFoodItemPortionInput {
  label_quantity?: number
  label_unit?: string
  base_equivalent?: number
  sort_order?: number
}

const COLUMNS =
  'id, food_item_id, label_quantity, label_unit, base_equivalent, sort_order, created_at, updated_at'

const mapRow = (row: Record<string, unknown>): FoodItemPortionRow => ({
  id: row.id as string,
  food_item_id: row.food_item_id as string,
  label_quantity: row.label_quantity as number,
  label_unit: row.label_unit as string,
  base_equivalent: row.base_equivalent as number,
  sort_order: row.sort_order as number,
  created_at: row.created_at as Date,
  updated_at: row.updated_at as Date,
})

export const insertFoodItemPortion = async (
  user: string,
  input: InsertFoodItemPortionInput,
): Promise<FoodItemPortionRow> => {
  const result = await query(
    user,
    `INSERT INTO food_item_portions
       (food_item_id, label_quantity, label_unit, base_equivalent, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLUMNS}`,
    [
      input.food_item_id,
      input.label_quantity,
      input.label_unit,
      input.base_equivalent,
      input.sort_order ?? 0,
    ],
  )
  return mapRow(result.rows[0])
}

export const updateFoodItemPortion = async (
  user: string,
  id: string,
  input: UpdateFoodItemPortionInput,
): Promise<FoodItemPortionRow | null> => {
  const setClauses: string[] = []
  const params: unknown[] = []
  let idx = 1
  if (input.label_quantity !== undefined) {
    setClauses.push(`label_quantity = $${idx++}`)
    params.push(input.label_quantity)
  }
  if (input.label_unit !== undefined) {
    setClauses.push(`label_unit = $${idx++}`)
    params.push(input.label_unit)
  }
  if (input.base_equivalent !== undefined) {
    setClauses.push(`base_equivalent = $${idx++}`)
    params.push(input.base_equivalent)
  }
  if (input.sort_order !== undefined) {
    setClauses.push(`sort_order = $${idx++}`)
    params.push(input.sort_order)
  }
  if (setClauses.length === 0) return getFoodItemPortionById(user, id)
  setClauses.push('updated_at = NOW()')
  params.push(id)
  const result = await query(
    user,
    `UPDATE food_item_portions SET ${setClauses.join(', ')}
       WHERE id = $${idx}
     RETURNING ${COLUMNS}`,
    params,
  )
  return result.rows.length > 0 ? mapRow(result.rows[0]) : null
}

export const getFoodItemPortionById = async (
  user: string,
  id: string,
): Promise<FoodItemPortionRow | null> => {
  const result = await query(user, `SELECT ${COLUMNS} FROM food_item_portions WHERE id = $1`, [id])
  return result.rows.length > 0 ? mapRow(result.rows[0]) : null
}

export const listPortionsForFoodItem = async (
  user: string,
  foodItemId: string,
): Promise<FoodItemPortionRow[]> => {
  const result = await query(
    user,
    `SELECT ${COLUMNS} FROM food_item_portions
       WHERE food_item_id = $1
       ORDER BY sort_order, created_at, id`,
    [foodItemId],
  )
  return result.rows.map(mapRow)
}

/** Batch lookup: returns a map foodItemId → portions[] for all rows in `ids`. */
export const getPortionsByFoodItemIds = async (
  user: string,
  ids: string[],
): Promise<Map<string, FoodItemPortionRow[]>> => {
  const map = new Map<string, FoodItemPortionRow[]>()
  if (ids.length === 0) return map
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
  const result = await query(
    user,
    `SELECT ${COLUMNS} FROM food_item_portions
       WHERE food_item_id IN (${placeholders})
       ORDER BY food_item_id, sort_order, created_at, id`,
    ids,
  )
  for (const row of result.rows) {
    const portion = mapRow(row)
    const list = map.get(portion.food_item_id)
    if (list) list.push(portion)
    else map.set(portion.food_item_id, [portion])
  }
  return map
}

export const deleteFoodItemPortion = async (user: string, id: string): Promise<boolean> => {
  // Wrap in a transaction so the FK-like invariant
  // ("food_items.default_portion_id always resolves") really holds: if the
  // DELETE fails or the connection drops after the UPDATE succeeded, the
  // food row's default pointer would be cleared while the portion is still
  // present. Central-target portions have no default pointer to clear (the
  // override table picks that up in PR2), so the UPDATE is a no-op for those.
  try {
    await query(user, 'BEGIN')
    await query(
      user,
      `UPDATE food_items SET default_portion_id = NULL, updated_at = NOW()
         WHERE default_portion_id = $1`,
      [id],
    )
    const result = await query(user, `DELETE FROM food_item_portions WHERE id = $1`, [id])
    await query(user, 'COMMIT')
    return (result.rowCount ?? 0) > 0
  } catch (err) {
    await query(user, 'ROLLBACK').catch(() => {})
    throw err
  }
}

/** Cascade helper called when a per-user food item is deleted. */
export const deletePortionsForFoodItem = async (user: string, foodItemId: string): Promise<number> => {
  const result = await query(user, `DELETE FROM food_item_portions WHERE food_item_id = $1`, [foodItemId])
  return result.rowCount ?? 0
}
