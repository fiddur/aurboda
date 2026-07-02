/**
 * Per-user overrides for central `shared_food_items` rows.
 *
 * The central library is read-only from a user's perspective, so any
 * customization (icon today, more fields later) goes here. The semantics
 * for each override column are:
 *
 *   - `string` value → user-set override (the value the user picked)
 *   - `null`         → "use no value" (explicit revert to empty — e.g. user
 *                      hides the central icon)
 *   - row absent     → no override at all; the central value passes through
 *
 * Because of those three states, an empty input on `setSharedFoodItemOverride`
 * (no override fields supplied) is treated as caller error — without it we'd
 * silently insert a row whose every column is NULL and then the read path
 * couldn't tell that apart from "user explicitly chose no value", erasing the
 * central icon by accident. Use `clearSharedFoodItemOverride` to revert.
 *
 * `shared_food_item_id` is a soft pointer (no FK — central lives in a
 * separate database), same pattern as `meal_food_items.food_item_id` and
 * `food_item_sensitivities.food_item_id`. If a central row is removed the
 * orphan override row is harmless: lookups by id won't find anything to
 * apply it to, and the row carries no data on its own. We don't currently
 * sweep them.
 */

import { query } from './connection.ts'

export interface SharedFoodItemOverride {
  shared_food_item_id: string
  /**
   * User-set icon for the central item — only meaningful when
   * `icon_overridden` is true. `null` then means "user explicitly chose
   * no icon" (hide the central icon); `string` is a user-supplied icon.
   * When `icon_overridden` is false, this field's value is incidental and
   * the read layer must pass through the central icon untouched.
   */
  icon: string | null
  /**
   * Whether the user supplied an icon value (a string OR explicit null).
   * Required because the column default is NULL — without this flag, a
   * `default_portion_id`-only override row would have `icon = NULL` that
   * the read path can't distinguish from "user-hid-central-icon".
   */
  icon_overridden: boolean
  /**
   * User-preselected portion id (unit) for the central item. NULL means "no
   * override" — fall back to the central row's own default_portion_id (which
   * is itself usually NULL → use the base portion).
   */
  default_portion_id: string | null
  /**
   * User-preselected default quantity for the central item, in the unit named
   * by default_portion_id (or the base unit). NULL means "no override" — fall
   * back to the base default_quantity.
   */
  default_log_quantity: number | null
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
  /**
   * `string` sets the preselected portion id (unit), `null` clears the
   * override (revert to whatever the central row says — usually the base
   * portion). `undefined` leaves the column unchanged.
   */
  default_portion_id?: string | null
  /**
   * `number` sets the default quantity, `null` clears the override (revert to
   * the base quantity). `undefined` leaves the column unchanged.
   */
  default_log_quantity?: number | null
}

const COLUMNS =
  'shared_food_item_id, icon, icon_overridden, default_portion_id, default_log_quantity, created_at, updated_at'

const mapRow = (row: Record<string, unknown>): SharedFoodItemOverride => ({
  shared_food_item_id: row.shared_food_item_id as string,
  icon: row.icon as string | null,
  icon_overridden: row.icon_overridden === true,
  default_portion_id: (row.default_portion_id as string | null) ?? null,
  default_log_quantity: (row.default_log_quantity as number | null) ?? null,
  created_at: row.created_at as Date,
  updated_at: row.updated_at as Date,
})

const OVERRIDE_FIELDS = ['icon', 'default_portion_id', 'default_log_quantity'] as const

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
 * Upsert override columns for a central food item. At least one override
 * field must be supplied — passing `{}` is rejected, since it would
 * otherwise insert a row with every override NULL and the read path can't
 * tell that apart from "user explicitly chose no value", silently erasing
 * the central icon. Callers wanting to revert should use
 * `clearSharedFoodItemOverride` instead.
 *
 * For an existing row, only the explicitly-provided columns are updated;
 * omitted fields keep their current value.
 */
export const setSharedFoodItemOverride = async (
  user: string,
  sharedFoodItemId: string,
  input: SharedFoodItemOverrideInput,
): Promise<SharedFoodItemOverride> => {
  const insertFields = ['shared_food_item_id']
  const insertValues: unknown[] = [sharedFoodItemId]
  const updateAssignments: string[] = []

  for (const field of OVERRIDE_FIELDS) {
    const value = input[field]
    if (value !== undefined) {
      insertFields.push(field)
      insertValues.push(value)
      updateAssignments.push(`${field} = EXCLUDED.${field}`)
    }
  }

  if (updateAssignments.length === 0) {
    throw new Error(
      'setSharedFoodItemOverride requires at least one override field; use clearSharedFoodItemOverride to revert',
    )
  }

  // Track "user supplied an icon value" so the read path can distinguish
  // a fresh `default_portion_id`-only row (icon NULL by column default —
  // pass central through) from an explicit icon hide (`icon: null` in
  // input — replace central with no-icon).
  if (input.icon !== undefined) {
    insertFields.push('icon_overridden')
    insertValues.push(true)
    updateAssignments.push('icon_overridden = EXCLUDED.icon_overridden')
  }

  // Always bump updated_at on conflict so the row reflects the most recent
  // user action.
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
