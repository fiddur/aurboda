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
  'default_quantity',
  'default_unit',
  ...NUTRIENT_FIELD_NAMES,
  'created_at',
  'updated_at',
].join(', ')

const mapFoodItemRow = (row: Record<string, unknown>): FoodItemEntity => {
  const entity: Record<string, unknown> = {
    id: row.id,
    name: row.name,
    name_lower: row.name_lower,
    source: row.source,
    default_quantity: row.default_quantity ?? undefined,
    default_unit: row.default_unit ?? undefined,
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
  default_quantity?: number
  default_unit?: string
  [nutrient: string]: string | number | undefined
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Search food items by name prefix (case-insensitive).
 */
export const searchFoodItems = async (user: string, q: string, limit = 20): Promise<FoodItemEntity[]> => {
  const result = await query(
    user,
    `SELECT ${FOOD_ITEM_COLUMNS} FROM food_items WHERE name_lower LIKE $1 ORDER BY name_lower LIMIT $2`,
    [`${q.toLowerCase().trim()}%`, limit],
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
 * Upsert a food item (insert or update on name conflict).
 * On conflict, updates all provided nutrient values.
 */
export const upsertFoodItem = async (user: string, input: InsertFoodItemInput): Promise<FoodItemEntity> => {
  const nameLower = input.name.toLowerCase().trim()
  const fields = ['name', 'name_lower', 'source', 'default_quantity', 'default_unit']
  const values: unknown[] = [
    input.name,
    nameLower,
    input.source ?? 'manual',
    input.default_quantity ?? null,
    input.default_unit ?? null,
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

  const result = await query(
    user,
    `INSERT INTO food_items (${fields.join(', ')})
     VALUES (${placeholders})
     ON CONFLICT (name_lower) DO UPDATE SET ${updateSet}, updated_at = NOW()
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
