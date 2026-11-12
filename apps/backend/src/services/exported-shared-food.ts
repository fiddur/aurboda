/**
 * A user's data points at food items by soft UUID, and some of those ids belong to the
 * server's central `shared_food_items` library, which a database dump does not carry. The
 * export appends the referenced shared rows to the dump as `exported_shared_food_items`;
 * after a restore, `reconcileExportedSharedFoodItems` resolves each of them against the new
 * server's library and drops the table.
 */

import { NUTRIENT_FIELD_NAMES } from '@aurboda/api-spec'
import format from 'pg-format'

import type { Queryable } from '../db/pool.ts'
import type { SharedFoodItemEntity, SharedFoodItemsApi } from './central-food-items.ts'

import { query, withUserTransaction } from '../db/connection.ts'
import { getCentralDb } from './central-db.ts'

export const EXPORTED_SHARED_FOOD_TABLE = 'exported_shared_food_items'
const QUALIFIED_TABLE = `public.${EXPORTED_SHARED_FOOD_TABLE}`

const EXPORTED_COLUMNS: [string, string][] = [
  ['id', 'uuid PRIMARY KEY'],
  ['name', 'text NOT NULL'],
  ['name_lower', 'text NOT NULL'],
  ['source', 'text NOT NULL'],
  ['source_id', 'text'],
  ['default_quantity', 'double precision'],
  ['default_unit', 'text'],
  ...NUTRIENT_FIELD_NAMES.map((field): [string, string] => [field, 'double precision']),
  ['icon', 'text'],
  ['created_at', 'timestamptz'],
  ['updated_at', 'timestamptz'],
]

const UUID_PATTERN = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

const REFERENCED_IDS_SQL = `
  SELECT DISTINCT refs.id::text AS id FROM (
    SELECT food_item_id AS id FROM meal_food_items
    UNION SELECT food_item_id FROM food_item_portions
    UNION SELECT food_item_id FROM food_item_sensitivities
    UNION SELECT ingredient_food_item_id FROM food_item_ingredients
    UNION SELECT shared_food_item_id FROM shared_food_item_overrides
    UNION SELECT reference_food_item_id FROM food_items
    UNION SELECT (item->>'food_item_id')::uuid
      FROM meals
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(meals.food_items) = 'array' THEN meals.food_items ELSE '[]'::jsonb END
      ) AS item
     WHERE item->>'food_item_id' ~ '${UUID_PATTERN}'
  ) refs
  WHERE refs.id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM food_items own WHERE own.id = refs.id)
  ORDER BY 1`

/** Ids the user's data points at that are not the user's own food items. */
export const referencedForeignFoodItemIds = async (db: Queryable | string): Promise<string[]> =>
  (await query<{ id: string }>(db, REFERENCED_IDS_SQL)).rows.map((row) => row.id)

const ID_CHUNK = 1000

const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export const loadReferencedSharedFoodItems = async (
  user: string,
  central: Pick<SharedFoodItemsApi, 'getSharedFoodItemsByIds'> = getCentralDb(),
): Promise<SharedFoodItemEntity[]> => {
  const ids = await referencedForeignFoodItemIds(user)
  const items: SharedFoodItemEntity[] = []
  for (const chunk of chunks(ids, ID_CHUNK)) {
    const found = await central.getSharedFoodItemsByIds(chunk)
    for (const id of chunk) {
      const item = found.get(id)
      if (item) items.push(item)
    }
  }
  return items
}

const literalValue = (value: unknown): unknown => {
  if (value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  return value
}

const INSERT_BATCH = 200

/**
 * SQL appended to the plain dump after pg_dump's own output. pg_dump empties `search_path`,
 * so the table is schema-qualified. `IF NOT EXISTS` / `ON CONFLICT` keep the restore working
 * when the dumped database still held an unreconciled table of its own.
 */
export const exportedSharedFoodTrailer = (items: SharedFoodItemEntity[]): string => {
  if (items.length === 0) return ''
  const names = EXPORTED_COLUMNS.map(([name]) => name)
  const lines = [
    '',
    '-- Aurboda: the server-library food items this data references (see docs/data-export.md).',
    `CREATE TABLE IF NOT EXISTS ${QUALIFIED_TABLE} (`,
    EXPORTED_COLUMNS.map(([name, type]) => `    ${name} ${type}`).join(',\n'),
    ');',
  ]
  for (const batch of chunks(items, INSERT_BATCH)) {
    const rows = batch.map((item) => names.map((name) => literalValue(item[name])))
    lines.push(
      format(
        `INSERT INTO ${QUALIFIED_TABLE} (${names.join(', ')}) VALUES %L ON CONFLICT (id) DO NOTHING;`,
        rows,
      ),
    )
  }
  return `${lines.join('\n')}\n`
}

export interface ExportedSharedFoodRow {
  id: string
  name: string
  source: string
  source_id: string | null
  [column: string]: unknown
}

export type ReconcileAction =
  | { kind: 'keep'; id: string }
  | { kind: 'repoint'; from: string; to: string; target: 'central' | 'user' }
  | { kind: 'copy'; row: ExportedSharedFoodRow; name: string }

export interface ReconcileLookup {
  centralIds: ReadonlySet<string>
  /** Central id by `sourceKey(source, source_id)`. */
  centralIdBySource: ReadonlyMap<string, string>
  userIds: ReadonlySet<string>
  /** The user's own food item id by `sourceKey(source, source_id)`. */
  userIdBySource: ReadonlyMap<string, string>
  userNamesLower: ReadonlySet<string>
}

export const sourceKey = (source: string, sourceId: string): string => `${source}\u0000${sourceId}`

const MAX_NAME = 255

const nameLower = (name: string): string => name.toLowerCase().trim()

/** `food_items.name_lower` is unique, so a copy whose name the user already has gets the source appended. */
const uniqueName = (row: ExportedSharedFoodRow, taken: ReadonlySet<string>): string => {
  if (!taken.has(nameLower(row.name))) return row.name
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? ` (${row.source})` : ` (${row.source} ${n})`
    const candidate = `${row.name.slice(0, MAX_NAME - suffix.length)}${suffix}`
    if (!taken.has(nameLower(candidate))) return candidate
  }
}

export const planSharedFoodReconcile = (
  rows: ExportedSharedFoodRow[],
  lookup: ReconcileLookup,
): ReconcileAction[] => {
  const taken = new Set(lookup.userNamesLower)
  return rows.map((row): ReconcileAction => {
    if (lookup.centralIds.has(row.id) || lookup.userIds.has(row.id)) return { id: row.id, kind: 'keep' }
    if (row.source_id) {
      const key = sourceKey(row.source, row.source_id)
      const central = lookup.centralIdBySource.get(key)
      if (central) return { from: row.id, kind: 'repoint', target: 'central', to: central }
      const own = lookup.userIdBySource.get(key)
      if (own) return { from: row.id, kind: 'repoint', target: 'user', to: own }
    }
    const name = uniqueName(row, taken)
    taken.add(nameLower(name))
    return { kind: 'copy', name, row }
  })
}

export type CentralFoodLookup = Pick<
  SharedFoodItemsApi,
  'getSharedFoodItemsByIds' | 'getSharedFoodItemsBySourceIds'
>

const buildLookup = async (
  tx: Queryable,
  rows: ExportedSharedFoodRow[],
  central: CentralFoodLookup,
): Promise<ReconcileLookup> => {
  const centralIds = new Set<string>()
  for (const chunk of chunks(
    rows.map((row) => row.id),
    ID_CHUNK,
  )) {
    for (const id of (await central.getSharedFoodItemsByIds(chunk)).keys()) centralIds.add(id)
  }

  const sourceKeys = rows
    .filter((row) => !centralIds.has(row.id) && row.source_id)
    .map((row) => ({ source: row.source, source_id: row.source_id as string }))
  const centralIdBySource = new Map<string, string>()
  for (const chunk of chunks(sourceKeys, ID_CHUNK)) {
    for (const item of await central.getSharedFoodItemsBySourceIds(chunk)) {
      if (item.source_id) centralIdBySource.set(sourceKey(item.source, item.source_id), item.id)
    }
  }

  const own = await tx.query<{ id: string; name_lower: string; source: string; source_id: string | null }>(
    'SELECT id::text AS id, name_lower, source, source_id FROM food_items',
  )
  const userIdBySource = new Map<string, string>()
  for (const row of own.rows) {
    if (row.source_id) userIdBySource.set(sourceKey(row.source, row.source_id), row.id)
  }
  return {
    centralIdBySource,
    centralIds,
    userIdBySource,
    userIds: new Set(own.rows.map((row) => row.id)),
    userNamesLower: new Set(own.rows.map((row) => row.name_lower)),
  }
}

const repoint = async (tx: Queryable, from: string, to: string, target: 'central' | 'user') => {
  const params = [from, to]
  await tx.query('UPDATE meal_food_items SET food_item_id = $2 WHERE food_item_id = $1', params)
  await tx.query(
    'UPDATE food_item_portions SET food_item_id = $2, updated_at = NOW() WHERE food_item_id = $1',
    params,
  )
  await tx.query(
    `UPDATE food_item_ingredients SET ingredient_food_item_id = $2, updated_at = NOW()
      WHERE ingredient_food_item_id = $1`,
    params,
  )
  await tx.query(
    'UPDATE food_items SET reference_food_item_id = $2, updated_at = NOW() WHERE reference_food_item_id = $1',
    params,
  )
  await tx.query(
    `INSERT INTO food_item_sensitivities (food_item_id, sensitivity_flag_id, created_at)
     SELECT $2, sensitivity_flag_id, created_at FROM food_item_sensitivities WHERE food_item_id = $1
     ON CONFLICT (food_item_id, sensitivity_flag_id) DO NOTHING`,
    params,
  )
  await tx.query('DELETE FROM food_item_sensitivities WHERE food_item_id = $1', [from])
  // Overrides only apply to central items, and the target's own override row wins over the old one.
  if (target === 'central') {
    await tx.query(
      `DELETE FROM shared_food_item_overrides
        WHERE shared_food_item_id = $1
          AND EXISTS (SELECT 1 FROM shared_food_item_overrides WHERE shared_food_item_id = $2)`,
      params,
    )
    await tx.query(
      'UPDATE shared_food_item_overrides SET shared_food_item_id = $2 WHERE shared_food_item_id = $1',
      params,
    )
  } else {
    await tx.query('DELETE FROM shared_food_item_overrides WHERE shared_food_item_id = $1', [from])
  }
  await tx.query(
    `UPDATE meals SET food_items = (
       SELECT jsonb_agg(
                CASE WHEN item->>'food_item_id' = $1::text
                     THEN jsonb_set(item, '{food_item_id}', to_jsonb($2::text))
                     ELSE item END
                ORDER BY ord)
         FROM jsonb_array_elements(meals.food_items) WITH ORDINALITY AS t(item, ord))
      WHERE jsonb_typeof(food_items) = 'array'
        AND food_items @> jsonb_build_array(jsonb_build_object('food_item_id', $1::text))`,
    params,
  )
}

interface OverrideRow {
  shared_food_item_id: string
  icon: string | null
  icon_overridden: boolean
  default_portion_id: string | null
  default_log_quantity: number | null
}

const COPY_COLUMNS = [
  'id',
  'name',
  'name_lower',
  'source',
  'source_id',
  'default_quantity',
  'default_unit',
  ...NUTRIENT_FIELD_NAMES,
  'icon',
  'default_portion_id',
  'default_log_quantity',
]

const copyAsOwn = async (tx: Queryable, row: ExportedSharedFoodRow, name: string, override?: OverrideRow) => {
  const values: Record<string, unknown> = {
    ...row,
    default_log_quantity: override?.default_log_quantity ?? null,
    default_portion_id: override?.default_portion_id ?? null,
    icon: override?.icon_overridden ? override.icon : row.icon,
    name,
    name_lower: nameLower(name),
  }
  const placeholders = COPY_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
  await tx.query(
    `INSERT INTO food_items (${COPY_COLUMNS.join(', ')}) VALUES (${placeholders})`,
    COPY_COLUMNS.map((column) => values[column] ?? null),
  )
  await tx.query('DELETE FROM shared_food_item_overrides WHERE shared_food_item_id = $1', [row.id])
}

export interface ReconcileSummary {
  kept: number
  matched: number
  copied: number
}

const tablePresent = async (db: Queryable | string): Promise<boolean> =>
  (await query<{ present: boolean }>(db, `SELECT to_regclass('${QUALIFIED_TABLE}') IS NOT NULL AS present`))
    .rows[0].present

/**
 * Resolve a restored dump's `exported_shared_food_items` against this server's library: an
 * id the library has stays as it is, a row the library has under another id (same source and
 * source id) has every reference re-pointed to it, and anything else becomes the user's own
 * food item under the same id, so the references resolve without re-pointing. Returns null
 * when there is nothing to reconcile. A failure rolls back and leaves the table for next time.
 */
export const reconcileExportedSharedFoodItems = async (
  user: string,
  { central }: { central?: CentralFoodLookup } = {},
): Promise<ReconcileSummary | null> => {
  if (!(await tablePresent(user))) return null
  const summary = await withUserTransaction(user, async (tx): Promise<ReconcileSummary | null> => {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext('aurboda:${EXPORTED_SHARED_FOOD_TABLE}'))`)
    if (!(await tablePresent(tx))) return null
    const rows = (await tx.query<ExportedSharedFoodRow>(`SELECT * FROM ${QUALIFIED_TABLE} ORDER BY id`)).rows
    const actions = planSharedFoodReconcile(rows, await buildLookup(tx, rows, central ?? getCentralDb()))
    const copies = actions.filter((action) => action.kind === 'copy')
    const overrides = new Map(
      (
        await tx.query<OverrideRow>(
          `SELECT shared_food_item_id::text AS shared_food_item_id, icon, icon_overridden,
                  default_portion_id::text AS default_portion_id, default_log_quantity
             FROM shared_food_item_overrides WHERE shared_food_item_id = ANY($1::uuid[])`,
          [copies.map((action) => action.row.id)],
        )
      ).rows.map((row) => [row.shared_food_item_id, row]),
    )
    const result: ReconcileSummary = { copied: 0, kept: 0, matched: 0 }
    for (const action of actions) {
      if (action.kind === 'keep') {
        result.kept += 1
      } else if (action.kind === 'repoint') {
        await repoint(tx, action.from, action.to, action.target)
        result.matched += 1
      } else {
        await copyAsOwn(tx, action.row, action.name, overrides.get(action.row.id))
        result.copied += 1
      }
    }
    await tx.query(`DROP TABLE ${QUALIFIED_TABLE}`)
    return result
  })
  if (summary) {
    console.info(
      `🍎 Reconciled exported shared food items for ${user}: ${summary.kept} kept, ` +
        `${summary.matched} matched, ${summary.copied} copied`,
    )
  }
  return summary
}
