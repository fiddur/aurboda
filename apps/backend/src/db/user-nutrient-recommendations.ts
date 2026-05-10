/**
 * Per-user overrides of central nutrient recommendation defaults.
 *
 * Three states for each nutrient:
 *   - row absent       → no override; central default (if any) passes through
 *   - row with value   → user-set bound (overrides the central default)
 *   - row with NULL    → "suppress this nutrient's recommendation entirely",
 *                        distinct from "no override" — the read path checks
 *                        row existence, not just column NULL.
 *
 * `nutrient_name` is the natural primary key (matches NUTRIENT_FIELDS.name);
 * the central + user keys align so `getEffectiveRecommendations` can do a
 * straight per-key merge.
 */

import { query } from './connection.ts'

export interface UserNutrientRecommendationRow {
  nutrient_name: string
  recommended_low: number | null
  recommended_high: number | null
  created_at: Date
  updated_at: Date
}

export interface UserNutrientRecommendationInput {
  /** `number` sets a bound; `null` suppresses the central default. `undefined` leaves the column unchanged. */
  recommended_low?: number | null
  recommended_high?: number | null
}

const COLUMNS = 'nutrient_name, recommended_low, recommended_high, created_at, updated_at'

const mapRow = (row: Record<string, unknown>): UserNutrientRecommendationRow => ({
  nutrient_name: row.nutrient_name as string,
  recommended_low: (row.recommended_low as number | null) ?? null,
  recommended_high: (row.recommended_high as number | null) ?? null,
  created_at: row.created_at as Date,
  updated_at: row.updated_at as Date,
})

export const listUserNutrientRecommendations = async (
  user: string,
): Promise<UserNutrientRecommendationRow[]> => {
  const result = await query(user, `SELECT ${COLUMNS} FROM user_nutrient_recommendations`)
  return result.rows.map(mapRow)
}

export const getUserNutrientRecommendation = async (
  user: string,
  nutrientName: string,
): Promise<UserNutrientRecommendationRow | null> => {
  const result = await query(
    user,
    `SELECT ${COLUMNS} FROM user_nutrient_recommendations WHERE nutrient_name = $1`,
    [nutrientName],
  )
  return result.rows.length > 0 ? mapRow(result.rows[0]) : null
}

/**
 * Upsert a per-user nutrient recommendation. `undefined` columns in the
 * input are left unchanged (or default to NULL on first insert); `null`
 * columns explicitly suppress the central default for that bound.
 *
 * Throws if neither bound is supplied — without it the row would be all
 * NULLs and the read path couldn't distinguish that from a deliberate
 * "suppress everything" override.
 */
export const upsertUserNutrientRecommendation = async (
  user: string,
  nutrientName: string,
  input: UserNutrientRecommendationInput,
): Promise<UserNutrientRecommendationRow> => {
  if (!('recommended_low' in input) && !('recommended_high' in input)) {
    throw new Error(
      'upsertUserNutrientRecommendation requires at least one bound; use clearUserNutrientRecommendation to revert',
    )
  }

  const insertFields: string[] = ['nutrient_name']
  const insertValues: unknown[] = [nutrientName]
  const updateAssignments: string[] = []

  for (const field of ['recommended_low', 'recommended_high'] as const) {
    if (field in input) {
      insertFields.push(field)
      insertValues.push(input[field])
      updateAssignments.push(`${field} = EXCLUDED.${field}`)
    }
  }
  updateAssignments.push('updated_at = NOW()')

  const placeholders = insertValues.map((_, i) => `$${i + 1}`).join(', ')
  const sql = `
    INSERT INTO user_nutrient_recommendations (${insertFields.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT (nutrient_name) DO UPDATE SET ${updateAssignments.join(', ')}
    RETURNING ${COLUMNS}
  `
  const result = await query(user, sql, insertValues)
  return mapRow(result.rows[0])
}

export const clearUserNutrientRecommendation = async (
  user: string,
  nutrientName: string,
): Promise<boolean> => {
  const result = await query(user, `DELETE FROM user_nutrient_recommendations WHERE nutrient_name = $1`, [
    nutrientName,
  ])
  return (result.rowCount ?? 0) > 0
}
