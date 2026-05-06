/**
 * Per-user overrides for central `shared_food_items` rows.
 *
 * The central library is read-only from a user's perspective, so any
 * customization (icon today, more fields later) goes here. NULL on an
 * override column means "no override applied" — the central value passes
 * through unchanged. A row with every override column NULL is equivalent to
 * having no row, so callers should `clear` rather than `set` everything to
 * null when they want to revert.
 *
 * `shared_food_item_id` is a soft pointer (no FK — central lives in a
 * separate database), same pattern as `meal_food_items.food_item_id` and
 * `food_item_sensitivities.food_item_id`.
 */

import { query } from './connection.ts'

export interface SharedFoodItemOverride {
  shared_food_item_id: string
  /** User-set icon for the central item; null means "use no icon" (explicit override to empty). */
  icon: string | null
  created_at: Date
  updated_at: Date
}

export interface SharedFoodItemOverrideInput {
  /**
   * `string` sets the icon, `null` explicitly hides the central icon.
   * `undefined` leaves the column unchanged on update (and inserts NULL on
   * first insert).
   */
  icon?: string | null
}

const COLUMNS = 'shared_food_item_id, icon, created_at, updated_at'

const mapRow = (row: Record<string, unknown>): SharedFoodItemOverride => ({
  shared_food_item_id: row.shared_food_item_id as string,
  icon: (row.icon as string | null) ?? null,
  created_at: row.created_at as Date,
  updated_at: row.updated_at as Date,
})

export const getSharedFoodItemOverride = async (
  user: string,
  sharedFoodItemId: string,
): Promise<SharedFoodItemOverride | null> => {
  const result = await query(
    user,
    `SELECT ${COLUMNS} FROM shared_food_item_overrides WHERE shared_food_item_id = $1`,
    [sharedFoodItemId],
  )
  return result.rows.length > 0 ? mapRow(result.rows[0]) : null
}

/**
 * Batch lookup used by the food-items service to merge overrides into a list
 * of central items in one round-trip. Unknown ids simply don't appear in the
 * map — callers can treat absence as "no override".
 */
export const getSharedFoodItemOverridesByIds = async (
  user: string,
  ids: string[],
): Promise<Map<string, SharedFoodItemOverride>> => {
  const map = new Map<string, SharedFoodItemOverride>()
  if (ids.length === 0) return map
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
  const result = await query(
    user,
    `SELECT ${COLUMNS} FROM shared_food_item_overrides WHERE shared_food_item_id IN (${placeholders})`,
    ids,
  )
  for (const row of result.rows) {
    const override = mapRow(row)
    map.set(override.shared_food_item_id, override)
  }
  return map
}

/**
 * Upsert override columns for a central food item. Only fields explicitly
 * present in `input` are written — passing `{}` is a no-op set that just
 * touches `updated_at` on an existing row (or creates an empty row).
 */
export const setSharedFoodItemOverride = async (
  user: string,
  sharedFoodItemId: string,
  input: SharedFoodItemOverrideInput,
): Promise<SharedFoodItemOverride> => {
  const insertFields = ['shared_food_item_id']
  const insertValues: unknown[] = [sharedFoodItemId]
  const updateAssignments: string[] = []

  if (input.icon !== undefined) {
    insertFields.push('icon')
    insertValues.push(input.icon)
    updateAssignments.push('icon = EXCLUDED.icon')
  }

  // Always bump updated_at on conflict so the row reflects the most recent
  // user action even when a no-op set is replayed.
  updateAssignments.push('updated_at = NOW()')

  const placeholders = insertValues.map((_, i) => `$${i + 1}`).join(', ')
  const sql = `
    INSERT INTO shared_food_item_overrides (${insertFields.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT (shared_food_item_id) DO UPDATE SET ${updateAssignments.join(', ')}
    RETURNING ${COLUMNS}
  `
  const result = await query(user, sql, insertValues)
  return mapRow(result.rows[0])
}

export const clearSharedFoodItemOverride = async (
  user: string,
  sharedFoodItemId: string,
): Promise<boolean> => {
  const result = await query(user, `DELETE FROM shared_food_item_overrides WHERE shared_food_item_id = $1`, [
    sharedFoodItemId,
  ])
  return (result.rowCount ?? 0) > 0
}
