/**
 * Central (shared) food-item library.
 *
 * Lives in the central database — every user sees the same canonical
 * reference data (Livsmedelsverket today, possibly USDA / OpenFoodFacts /
 * barcode-scanned products later). User-private items continue to live in
 * each user's per-user `food_items` table; search/get layers compose both.
 *
 * The schema mirrors per-user `food_items` so meal_food_items snapshots can
 * copy values directly regardless of source.
 */

import type pg from 'pg'

import { FOOD_ITEM_QUALITY_TIER_SQL, NUTRIENT_FIELD_NAMES, nutrientColumnsDDL } from '@aurboda/api-spec'

export interface SharedFoodItemEntity {
  id: string
  name: string
  name_lower: string
  source: string
  source_id?: string
  default_quantity?: number
  default_unit?: string
  icon?: string
  created_at: Date
  updated_at: Date
  [nutrient: string]: string | number | Date | undefined
}

export interface InsertSharedFoodItemInput {
  name: string
  source?: string
  source_id?: string
  default_quantity?: number
  default_unit?: string
  icon?: string
  [nutrient: string]: string | number | undefined
}

export const CREATE_SHARED_FOOD_ITEMS_TABLE = `
  CREATE TABLE IF NOT EXISTS shared_food_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    name_lower      VARCHAR(255) NOT NULL,
    source          VARCHAR(50) NOT NULL,
    source_id       VARCHAR(100),
${nutrientColumnsDDL().replaceAll(/^ {6}/gm, '    ')},
    default_quantity DOUBLE PRECISION,
    default_unit    VARCHAR(100),
    icon            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`

export const CREATE_SHARED_FOOD_ITEMS_INDEXES = [
  'CREATE EXTENSION IF NOT EXISTS pg_trgm',
  'CREATE EXTENSION IF NOT EXISTS unaccent',
  // IMMUTABLE wrapper so we can index expressions over unaccent. The same
  // function exists in per-user DBs; keep names aligned so the search SQL
  // we send is identical across both code paths.
  `CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text AS $$
     SELECT public.unaccent('public.unaccent', $1)
   $$ LANGUAGE SQL IMMUTABLE PARALLEL SAFE STRICT`,
  'CREATE INDEX IF NOT EXISTS idx_shared_food_items_name_lower ON shared_food_items (name_lower)',
  `CREATE INDEX IF NOT EXISTS idx_shared_food_items_name_unaccent_trgm
     ON shared_food_items USING gin (immutable_unaccent(name_lower) gin_trgm_ops)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_food_items_source_id
     ON shared_food_items (source, source_id) WHERE source_id IS NOT NULL`,
]

const COLUMNS = [
  'id',
  'name',
  'name_lower',
  'source',
  'source_id',
  'default_quantity',
  'default_unit',
  ...NUTRIENT_FIELD_NAMES,
  'icon',
  'created_at',
  'updated_at',
].join(', ')

const mapRow = (row: Record<string, unknown>): SharedFoodItemEntity => {
  const entity: Record<string, unknown> = {
    id: row.id,
    name: row.name,
    name_lower: row.name_lower,
    source: row.source,
    source_id: row.source_id ?? undefined,
    default_quantity: row.default_quantity ?? undefined,
    default_unit: row.default_unit ?? undefined,
    icon: row.icon ?? undefined,
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
  }
  for (const field of NUTRIENT_FIELD_NAMES) {
    const val = row[field]
    if (val !== null && val !== undefined) entity[field] = val
  }
  return entity as unknown as SharedFoodItemEntity
}

const TRIGRAM_THRESHOLD = 0.2
const TRIGRAM_MIN_LEN = 3

const escapeLike = (s: string): string => s.replaceAll(/[\\%_]/g, '\\$&')

export interface SharedFoodItemsApi {
  searchSharedFoodItems: (q: string, limit?: number) => Promise<SharedFoodItemEntity[]>
  getSharedFoodItemById: (id: string) => Promise<SharedFoodItemEntity | null>
  getSharedFoodItemsByIds: (ids: string[]) => Promise<Map<string, SharedFoodItemEntity>>
  getSharedFoodItemByName: (name: string) => Promise<SharedFoodItemEntity | null>
  upsertSharedFoodItem: (input: InsertSharedFoodItemInput) => Promise<SharedFoodItemEntity>
  listSharedFoodItems: (limit?: number) => Promise<SharedFoodItemEntity[]>
}

export const createSharedFoodItemsApi = (getClient: () => Promise<pg.Client>): SharedFoodItemsApi => ({
  searchSharedFoodItems: async (q, limit = 20) => {
    const trimmed = q.trim()
    if (!trimmed) return []
    const enableTrigram = trimmed.length >= TRIGRAM_MIN_LEN
    const likePattern = `%${escapeLike(trimmed)}%`
    const client = await getClient()
    const result = await client.query(
      `SELECT ${COLUMNS}
       FROM shared_food_items
       WHERE immutable_unaccent(name_lower) ILIKE immutable_unaccent($1) ESCAPE '\\'
          OR ($4 AND similarity(immutable_unaccent(name_lower), immutable_unaccent($2)) > $5)
       ORDER BY
         CASE WHEN immutable_unaccent(name_lower) ILIKE immutable_unaccent($1) ESCAPE '\\' THEN 0 ELSE 1 END,
         ${FOOD_ITEM_QUALITY_TIER_SQL},
         POSITION(immutable_unaccent($2) IN immutable_unaccent(name_lower)),
         similarity(immutable_unaccent(name_lower), immutable_unaccent($2)) DESC,
         name_lower
       LIMIT $3`,
      [likePattern, trimmed, limit, enableTrigram, TRIGRAM_THRESHOLD],
    )
    return result.rows.map(mapRow)
  },

  getSharedFoodItemById: async (id) => {
    const client = await getClient()
    const result = await client.query(`SELECT ${COLUMNS} FROM shared_food_items WHERE id = $1`, [id])
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  },

  getSharedFoodItemsByIds: async (ids) => {
    const map = new Map<string, SharedFoodItemEntity>()
    if (ids.length === 0) return map
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
    const client = await getClient()
    const result = await client.query(
      `SELECT ${COLUMNS} FROM shared_food_items WHERE id IN (${placeholders})`,
      ids,
    )
    for (const row of result.rows) {
      const item = mapRow(row)
      map.set(item.id, item)
    }
    return map
  },

  getSharedFoodItemByName: async (name) => {
    const client = await getClient()
    const result = await client.query(`SELECT ${COLUMNS} FROM shared_food_items WHERE name_lower = $1`, [
      name.toLowerCase().trim(),
    ])
    return result.rows.length > 0 ? mapRow(result.rows[0]) : null
  },

  listSharedFoodItems: async (limit = 100) => {
    const client = await getClient()
    const result = await client.query(
      `SELECT ${COLUMNS} FROM shared_food_items ORDER BY name_lower LIMIT $1`,
      [limit],
    )
    return result.rows.map(mapRow)
  },

  upsertSharedFoodItem: async (input) => {
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
    // shared_food_items has no global UNIQUE on name_lower (different sources
    // can ship the same name), so the only conflict target we care about is
    // (source, source_id) for re-imports. Without a source_id we just insert.
    const conflictTarget =
      input.source_id && input.source ? '(source, source_id) WHERE source_id IS NOT NULL' : null
    const sql = conflictTarget
      ? `INSERT INTO shared_food_items (${fields.join(', ')})
         VALUES (${placeholders})
         ON CONFLICT ${conflictTarget} DO UPDATE SET ${updateSet}, updated_at = NOW()
         RETURNING ${COLUMNS}`
      : `INSERT INTO shared_food_items (${fields.join(', ')})
         VALUES (${placeholders})
         RETURNING ${COLUMNS}`
    const client = await getClient()
    const result = await client.query(sql, values)
    return mapRow(result.rows[0])
  },
})
