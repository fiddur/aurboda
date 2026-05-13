/**
 * Sensitivity flags + food-item junction.
 *
 * Flags are user-defined labels (dairy, gluten, alcohol, …). The junction
 * table associates a flag with a food item via a soft pointer on
 * `food_item_id` — the target may live in this user's `food_items` table or
 * in the central `shared_food_items` table (same pattern as
 * meal_food_items.food_item_id and food_item_ingredients.ingredient_food_item_id).
 *
 * Soft pointers force application-layer cascade on food-item delete + merge;
 * see deleteFoodItem and mergeFoodItems in food-items.ts.
 */
import { query } from './connection.ts'

export interface SensitivityFlag {
  id: string
  name: string
  color?: string
  icon?: string
  sort_order: number
  created_at: Date
  updated_at: Date
}

export interface SensitivityFlagInput {
  name: string
  color?: string | null
  icon?: string | null
  sort_order?: number
}

const FLAG_COLUMNS = 'id, name, color, icon, sort_order, created_at, updated_at'

const mapFlagRow = (row: Record<string, unknown>): SensitivityFlag => ({
  id: row.id as string,
  name: row.name as string,
  color: (row.color as string | null) ?? undefined,
  icon: (row.icon as string | null) ?? undefined,
  sort_order: (row.sort_order as number) ?? 0,
  created_at: row.created_at as Date,
  updated_at: row.updated_at as Date,
})

export const listSensitivityFlags = async (user: string): Promise<SensitivityFlag[]> => {
  const result = await query(user, `SELECT ${FLAG_COLUMNS} FROM sensitivity_flags ORDER BY sort_order, name`)
  return result.rows.map(mapFlagRow)
}

export const getSensitivityFlagByName = async (
  user: string,
  name: string,
): Promise<SensitivityFlag | null> => {
  const result = await query(user, `SELECT ${FLAG_COLUMNS} FROM sensitivity_flags WHERE name = $1`, [name])
  return result.rows.length > 0 ? mapFlagRow(result.rows[0]) : null
}

export const insertSensitivityFlag = async (
  user: string,
  input: SensitivityFlagInput,
): Promise<SensitivityFlag> => {
  const result = await query(
    user,
    `INSERT INTO sensitivity_flags (name, color, icon, sort_order)
     VALUES ($1, $2, $3, $4)
     RETURNING ${FLAG_COLUMNS}`,
    [input.name, input.color ?? null, input.icon ?? null, input.sort_order ?? 0],
  )
  return mapFlagRow(result.rows[0])
}

export const updateSensitivityFlag = async (
  user: string,
  id: string,
  input: Partial<SensitivityFlagInput>,
): Promise<SensitivityFlag | null> => {
  const setClauses: string[] = []
  const params: unknown[] = []
  let idx = 1
  if (input.name !== undefined) {
    setClauses.push(`name = $${idx++}`)
    params.push(input.name)
  }
  if (input.color !== undefined) {
    setClauses.push(`color = $${idx++}`)
    params.push(input.color)
  }
  if (input.icon !== undefined) {
    setClauses.push(`icon = $${idx++}`)
    params.push(input.icon)
  }
  if (input.sort_order !== undefined) {
    setClauses.push(`sort_order = $${idx++}`)
    params.push(input.sort_order)
  }
  if (setClauses.length === 0) {
    const result = await query(user, `SELECT ${FLAG_COLUMNS} FROM sensitivity_flags WHERE id = $1`, [id])
    return result.rows.length > 0 ? mapFlagRow(result.rows[0]) : null
  }
  setClauses.push('updated_at = NOW()')
  params.push(id)
  const result = await query(
    user,
    `UPDATE sensitivity_flags SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING ${FLAG_COLUMNS}`,
    params,
  )
  return result.rows.length > 0 ? mapFlagRow(result.rows[0]) : null
}

export const deleteSensitivityFlag = async (user: string, id: string): Promise<boolean> => {
  // ON DELETE CASCADE on food_item_sensitivities removes assignments.
  const result = await query(user, 'DELETE FROM sensitivity_flags WHERE id = $1', [id])
  return (result.rowCount ?? 0) > 0
}

// ── Junction ────────────────────────────────────────────────────────────────

export interface FoodItemSensitivityRow {
  food_item_id: string
  sensitivity_flag_id: string
  created_at: Date
}

/** Flag IDs assigned to one food item. */
export const getFoodItemSensitivityFlagIds = async (user: string, foodItemId: string): Promise<string[]> => {
  const result = await query(
    user,
    `SELECT sensitivity_flag_id FROM food_item_sensitivities WHERE food_item_id = $1`,
    [foodItemId],
  )
  return result.rows.map((row) => row.sensitivity_flag_id as string)
}

/**
 * Resolve full flag rows for a food item via JOIN. Useful when the caller
 * wants the names/colors alongside the assignment.
 */
export const getFoodItemSensitivities = async (
  user: string,
  foodItemId: string,
): Promise<SensitivityFlag[]> => {
  const result = await query(
    user,
    `SELECT f.id, f.name, f.color, f.icon, f.sort_order, f.created_at, f.updated_at
       FROM food_item_sensitivities j
       JOIN sensitivity_flags f ON f.id = j.sensitivity_flag_id
      WHERE j.food_item_id = $1
      ORDER BY f.sort_order, f.name`,
    [foodItemId],
  )
  return result.rows.map(mapFlagRow)
}

/** Batch flag-name lookup for many food items at once (used at meal snapshot time). */
export const getFoodItemSensitivityNamesBatch = async (
  user: string,
  foodItemIds: string[],
): Promise<Map<string, string[]>> => {
  if (foodItemIds.length === 0) return new Map()
  const placeholders = foodItemIds.map((_, i) => `$${i + 1}`).join(', ')
  const result = await query(
    user,
    `SELECT j.food_item_id, f.name
       FROM food_item_sensitivities j
       JOIN sensitivity_flags f ON f.id = j.sensitivity_flag_id
      WHERE j.food_item_id IN (${placeholders})
      ORDER BY f.sort_order, f.name`,
    foodItemIds,
  )
  const map = new Map<string, string[]>()
  for (const row of result.rows) {
    const arr = map.get(row.food_item_id as string) ?? []
    arr.push(row.name as string)
    map.set(row.food_item_id as string, arr)
  }
  return map
}

/**
 * Replace a food item's sensitivity assignments with a new list of flag IDs.
 * Idempotent — passing the same list twice produces the same state.
 */
export const setFoodItemSensitivities = async (
  user: string,
  foodItemId: string,
  flagIds: string[],
): Promise<void> => {
  try {
    await query(user, 'BEGIN')
    await query(user, 'DELETE FROM food_item_sensitivities WHERE food_item_id = $1', [foodItemId])
    if (flagIds.length > 0) {
      const valuesSql = flagIds.map((_, i) => `($1, $${i + 2})`).join(', ')
      await query(
        user,
        `INSERT INTO food_item_sensitivities (food_item_id, sensitivity_flag_id) VALUES ${valuesSql}`,
        [foodItemId, ...flagIds],
      )
    }
    await query(user, 'COMMIT')
  } catch (err) {
    await query(user, 'ROLLBACK').catch(() => {})
    throw err
  }
}

/** Drop every junction row pointing at this food item. */
export const deleteFoodItemSensitivities = async (user: string, foodItemId: string): Promise<void> => {
  await query(user, 'DELETE FROM food_item_sensitivities WHERE food_item_id = $1', [foodItemId])
}

/**
 * Re-point every junction row from `sourceId` to `targetId`. Used by the
 * food-item merge flow. Avoids duplicate-key collisions when the target
 * already has a flag the source also had: we INSERT … ON CONFLICT DO NOTHING
 * the union, then drop the source rows.
 */
export const mergeFoodItemSensitivities = async (
  user: string,
  sourceId: string,
  targetId: string,
): Promise<void> => {
  try {
    await query(user, 'BEGIN')
    await query(
      user,
      `INSERT INTO food_item_sensitivities (food_item_id, sensitivity_flag_id)
       SELECT $2, sensitivity_flag_id
         FROM food_item_sensitivities
        WHERE food_item_id = $1
       ON CONFLICT (food_item_id, sensitivity_flag_id) DO NOTHING`,
      [sourceId, targetId],
    )
    await query(user, 'DELETE FROM food_item_sensitivities WHERE food_item_id = $1', [sourceId])
    await query(user, 'COMMIT')
  } catch (err) {
    await query(user, 'ROLLBACK').catch(() => {})
    throw err
  }
}
