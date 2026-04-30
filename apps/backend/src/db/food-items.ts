/**
 * Food items CRUD operations.
 *
 * Canonical food item library — each unique food is a first-class entity.
 */

import { NUTRIENT_FIELD_NAMES } from '@aurboda/api-spec'

import type { FoodItemEntity } from './types.ts'

import { query } from './connection.ts'

const FOOD_ITEM_COLUMNS = [
  'id',
  'name',
  'name_lower',
  'source',
  'source_id',
  'default_quantity',
  'default_unit',
  ...NUTRIENT_FIELD_NAMES,
  'icon',
  'is_composite',
  'reference_food_item_id',
  'created_at',
  'updated_at',
].join(', ')

const mapFoodItemRow = (row: Record<string, unknown>): FoodItemEntity => {
  const entity: Record<string, unknown> = {
    id: row.id,
    name: row.name,
    name_lower: row.name_lower,
    source: row.source,
    source_id: row.source_id ?? undefined,
    default_quantity: row.default_quantity ?? undefined,
    default_unit: row.default_unit ?? undefined,
    icon: row.icon ?? undefined,
    is_composite: row.is_composite === true,
    reference_food_item_id: (row.reference_food_item_id as string | null) ?? undefined,
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
  }
  for (const field of NUTRIENT_FIELD_NAMES) {
    const val = row[field]
    if (val !== null && val !== undefined) entity[field] = val
  }
  return entity as unknown as FoodItemEntity
}

// ── Input types ──────────────────────────────────────────────────────────────

export interface InsertFoodItemInput {
  name: string
  source?: string
  /**
   * Stable identifier from the upstream source (e.g. Livsmedelsverket
   * `nummer`). When provided alongside `source`, upsertFoodItem uses
   * (source, source_id) as the conflict key — re-imports refresh the same
   * row even if the upstream name changes.
   */
  source_id?: string
  default_quantity?: number
  default_unit?: string
  icon?: string
  [nutrient: string]: string | number | undefined
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

const TRIGRAM_SIMILARITY_THRESHOLD = 0.2
const TRIGRAM_MIN_QUERY_LENGTH = 3

// Escape user-provided LIKE wildcards so a search for "50%" doesn't match
// anything-starting-with-50. The ESCAPE clause in the SQL pairs with this.
const escapeLikeWildcards = (s: string): string => s.replaceAll(/[\\%_]/g, '\\$&')

/**
 * Search food items by name. Substring + accent-folded match wins; a trigram
 * similarity pass on top picks up typos like "hushalsost" → "Hushållsost"
 * once the query is at least TRIGRAM_MIN_QUERY_LENGTH chars. Substring hits
 * always rank above fuzzy-only hits, then earliest match position, then
 * similarity score.
 */
export const searchFoodItems = async (user: string, q: string, limit = 20): Promise<FoodItemEntity[]> => {
  const trimmed = q.trim()
  if (!trimmed) return []
  const enableTrigram = trimmed.length >= TRIGRAM_MIN_QUERY_LENGTH
  const likePattern = `%${escapeLikeWildcards(trimmed)}%`
  const result = await query(
    user,
    `SELECT ${FOOD_ITEM_COLUMNS}
     FROM food_items
     WHERE immutable_unaccent(name_lower) ILIKE immutable_unaccent($1) ESCAPE '\\'
        OR ($4 AND similarity(immutable_unaccent(name_lower), immutable_unaccent($2)) > $5)
     ORDER BY
       CASE WHEN immutable_unaccent(name_lower) ILIKE immutable_unaccent($1) ESCAPE '\\' THEN 0 ELSE 1 END,
       POSITION(immutable_unaccent($2) IN immutable_unaccent(name_lower)),
       similarity(immutable_unaccent(name_lower), immutable_unaccent($2)) DESC,
       name_lower
     LIMIT $3`,
    [likePattern, trimmed, limit, enableTrigram, TRIGRAM_SIMILARITY_THRESHOLD],
  )
  return result.rows.map(mapFoodItemRow)
}

/**
 * Get all food items (with optional limit).
 */
export const listFoodItems = async (user: string, limit = 100): Promise<FoodItemEntity[]> => {
  const result = await query(
    user,
    `SELECT ${FOOD_ITEM_COLUMNS} FROM food_items ORDER BY name_lower LIMIT $1`,
    [limit],
  )
  return result.rows.map(mapFoodItemRow)
}

/**
 * Get a food item by ID.
 */
export const getFoodItemById = async (user: string, id: string): Promise<FoodItemEntity | null> => {
  const result = await query(user, `SELECT ${FOOD_ITEM_COLUMNS} FROM food_items WHERE id = $1`, [id])
  return result.rows.length > 0 ? mapFoodItemRow(result.rows[0]) : null
}

/**
 * Get a food item by name (case-insensitive exact match).
 */
export const getFoodItemByName = async (user: string, name: string): Promise<FoodItemEntity | null> => {
  const result = await query(user, `SELECT ${FOOD_ITEM_COLUMNS} FROM food_items WHERE name_lower = $1`, [
    name.toLowerCase().trim(),
  ])
  return result.rows.length > 0 ? mapFoodItemRow(result.rows[0]) : null
}

/**
 * Upsert a food item.
 *
 * Conflict resolution depends on what's provided:
 * - `source` + `source_id` → conflict on the partial unique index
 *   `(source, source_id)`. Re-imports update the same row even if the
 *   upstream name changes.
 * - Otherwise → conflict on `name_lower`. Manual entries stay deduped by
 *   name as before.
 */
export const upsertFoodItem = async (user: string, input: InsertFoodItemInput): Promise<FoodItemEntity> => {
  const nameLower = input.name.toLowerCase().trim()
  const fields = ['name', 'name_lower', 'source', 'source_id', 'default_quantity', 'default_unit', 'icon']
  const values: unknown[] = [
    input.name,
    nameLower,
    input.source ?? 'manual',
    input.source_id ?? null,
    input.default_quantity ?? null,
    input.default_unit ?? null,
    input.icon ?? null,
  ]

  for (const field of NUTRIENT_FIELD_NAMES) {
    fields.push(field)
    values.push(input[field] ?? null)
  }

  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ')
  const updateSet = fields
    .filter((f) => f !== 'name_lower')
    .map((f) => `${f} = EXCLUDED.${f}`)
    .join(', ')

  const conflictTarget =
    input.source_id && input.source ? '(source, source_id) WHERE source_id IS NOT NULL' : '(name_lower)'

  const result = await query(
    user,
    `INSERT INTO food_items (${fields.join(', ')})
     VALUES (${placeholders})
     ON CONFLICT ${conflictTarget} DO UPDATE SET ${updateSet}, updated_at = NOW()
     RETURNING ${FOOD_ITEM_COLUMNS}`,
    values,
  )
  return mapFoodItemRow(result.rows[0])
}

/**
 * Update a food item by ID.
 */
export const updateFoodItem = async (
  user: string,
  id: string,
  input: Record<string, unknown>,
): Promise<FoodItemEntity | null> => {
  const setClauses: string[] = []
  const params: unknown[] = []
  let idx = 1

  if (typeof input.name === 'string') {
    setClauses.push(`name = $${idx}`)
    params.push(input.name)
    idx++
    setClauses.push(`name_lower = $${idx}`)
    params.push(input.name.toLowerCase().trim())
    idx++
  }
  if (input.default_quantity !== undefined) {
    setClauses.push(`default_quantity = $${idx++}`)
    params.push(input.default_quantity)
  }
  if (input.default_unit !== undefined) {
    setClauses.push(`default_unit = $${idx++}`)
    params.push(input.default_unit)
  }
  if (input.icon !== undefined) {
    setClauses.push(`icon = $${idx++}`)
    params.push(input.icon)
  }

  for (const field of NUTRIENT_FIELD_NAMES) {
    if (input[field] !== undefined) {
      setClauses.push(`${field} = $${idx++}`)
      params.push(input[field])
    }
  }

  if (setClauses.length === 0) return getFoodItemById(user, id)

  setClauses.push('updated_at = NOW()')
  params.push(id)

  const result = await query(
    user,
    `UPDATE food_items SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING ${FOOD_ITEM_COLUMNS}`,
    params,
  )
  return result.rows.length > 0 ? mapFoodItemRow(result.rows[0]) : null
}

/**
 * Delete a food item by ID.
 */
export const deleteFoodItem = async (user: string, id: string): Promise<boolean> => {
  const result = await query(user, 'DELETE FROM food_items WHERE id = $1', [id])
  return (result.rowCount ?? 0) > 0
}

/**
 * Set or clear the reference_food_item_id soft pointer. Pass null to clear.
 * Caller is responsible for validating the reference target exists in the
 * merged user+central library. Refuses to set a reference on composite rows
 * as defence-in-depth — the route + MCP layers also check.
 */
export const setFoodItemReference = async (
  user: string,
  id: string,
  referenceId: string | null,
): Promise<FoodItemEntity | null> => {
  // Allow clearing (referenceId === null) on any row; only block setting on a
  // composite parent.
  const whereClause = referenceId === null ? 'WHERE id = $1' : 'WHERE id = $1 AND is_composite = FALSE'
  const result = await query(
    user,
    `UPDATE food_items SET reference_food_item_id = $2, updated_at = NOW()
     ${whereClause}
     RETURNING ${FOOD_ITEM_COLUMNS}`,
    [id, referenceId],
  )
  return result.rows.length > 0 ? mapFoodItemRow(result.rows[0]) : null
}

/**
 * Find a food item by name, or create it if it doesn't exist.
 * Returns the existing or newly created food item.
 */
export const findOrCreateFoodItem = async (
  user: string,
  name: string,
  defaults?: Partial<InsertFoodItemInput>,
): Promise<FoodItemEntity> => {
  const existing = await getFoodItemByName(user, name)
  if (existing) return existing
  return upsertFoodItem(user, { name, ...defaults })
}

export interface MergeFoodItemResult {
  meals_repointed: number
  ingredients_repointed: number
  fills_applied: string[]
  source_was_composite: boolean
}

/**
 * Merge a per-user food item (`source`) into another food item (`target`).
 *
 * - `meal_food_items.food_item_id` rows pointing at the source are re-pointed
 *   to the target. The snapshotted nutrient columns on those rows are NOT
 *   touched — past meals keep the macros/micros they were logged with.
 * - `food_item_ingredients.ingredient_food_item_id` rows pointing at the
 *   source are re-pointed too, so future composite-recipe derivations use
 *   the target's nutrients.
 * - If `fillEmptyFromSource` is true, any nutrient/icon/default_quantity/
 *   default_unit field that's NULL on the target is filled from the source.
 *   Pass `targetIsUserItem` to enable this — central items can't be edited
 *   from a per-user merge, the caller has already validated.
 * - The source's own ingredients (if it was a composite parent) are dropped
 *   via the existing `ON DELETE CASCADE` on food_item_ingredients.
 * - Source row is deleted at the end. All in one transaction so a partial
 *   failure leaves nothing dangling.
 */
export const mergeFoodItems = async (
  user: string,
  sourceId: string,
  targetId: string,
  options: { fillEmptyFromSource?: boolean; targetIsUserItem?: boolean } = {},
): Promise<MergeFoodItemResult> => {
  if (sourceId === targetId) throw new Error('Cannot merge a food item into itself')

  // Pre-fetch source so we can return useful counts and (optionally) fill the
  // target's empty fields from it. Do this before BEGIN so the FROM-source
  // closure is captured even if the source row is deleted later in the txn.
  const source = await getFoodItemById(user, sourceId)
  if (!source) throw new Error(`Source food item not found: ${sourceId}`)

  // Whether the source had its own ingredients (composite parent) — surfaced
  // in the result so the caller (UI) can confirm the discard-ingredients
  // expectation matched reality.
  const sourceIngredientsRes = await query(
    user,
    `SELECT 1 FROM food_item_ingredients WHERE parent_food_item_id = $1 LIMIT 1`,
    [sourceId],
  )
  const sourceWasComposite = sourceIngredientsRes.rows.length > 0

  try {
    await query(user, 'BEGIN')

    // Re-point past-meal references. food_item_id on meal_food_items is a
    // soft pointer (#695 dropped the FK because central rows live in another
    // database); the snapshot columns remain untouched here, satisfying the
    // "old meals must not change nutritionally" requirement.
    const mealsResult = await query(
      user,
      `UPDATE meal_food_items SET food_item_id = $2 WHERE food_item_id = $1`,
      [sourceId, targetId],
    )

    // Re-point composite ingredient references. Future re-derivation of
    // those composites will pick up the target's current nutrients.
    const ingredientsResult = await query(
      user,
      `UPDATE food_item_ingredients
         SET ingredient_food_item_id = $2, updated_at = NOW()
       WHERE ingredient_food_item_id = $1`,
      [sourceId, targetId],
    )

    // Optionally fill the target's empty fields from the source. We only
    // touch the per-user `food_items` table; central targets are filtered
    // out at the service layer.
    let fillsApplied: string[] = []
    if (options.fillEmptyFromSource && options.targetIsUserItem) {
      fillsApplied = await fillTargetFromSource(user, sourceId, targetId)
    }

    // Source row goes last — its food_item_ingredients (parent rows) cascade
    // away on delete; that's the "ingredients are discarded" semantic.
    await query(user, `DELETE FROM food_items WHERE id = $1`, [sourceId])

    await query(user, 'COMMIT')

    return {
      fills_applied: fillsApplied,
      ingredients_repointed: ingredientsResult.rowCount ?? 0,
      meals_repointed: mealsResult.rowCount ?? 0,
      source_was_composite: sourceWasComposite,
    }
  } catch (err) {
    await query(user, 'ROLLBACK').catch(() => {})
    throw err
  }
}

const FILLABLE_FIELDS = [...NUTRIENT_FIELD_NAMES, 'icon', 'default_quantity', 'default_unit'] as const

/**
 * Copy each NUTRIENT/icon/default_* field from source to target where the
 * target is currently NULL and the source has a value. Returns the names of
 * the fields that were actually filled — useful for the result summary.
 */
const fillTargetFromSource = async (user: string, sourceId: string, targetId: string): Promise<string[]> => {
  const target = await getFoodItemById(user, targetId)
  const source = await getFoodItemById(user, sourceId)
  if (!target || !source) return []

  const fields: string[] = []
  const setClauses: string[] = []
  const params: unknown[] = []
  let idx = 1
  for (const field of FILLABLE_FIELDS) {
    const targetVal = target[field]
    const sourceVal = source[field]
    const targetEmpty = targetVal === undefined || targetVal === null
    const sourceHas = sourceVal !== undefined && sourceVal !== null
    if (targetEmpty && sourceHas) {
      setClauses.push(`${field} = $${idx++}`)
      params.push(sourceVal)
      fields.push(field)
    }
  }
  if (setClauses.length === 0) return []
  setClauses.push('updated_at = NOW()')
  params.push(targetId)
  await query(user, `UPDATE food_items SET ${setClauses.join(', ')} WHERE id = $${idx}`, params)
  return fields
}
