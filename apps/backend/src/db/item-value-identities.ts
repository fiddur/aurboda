import { query } from './connection.ts'

export interface ItemValueIdentityRow {
  id: string
  field: string
  value: string
  catalog_key: string | null
  created_at: Date
  updated_at: Date
}

const COLUMNS = 'id, field, value, catalog_key, created_at, updated_at'

export const listItemValueIdentities = async (
  user: string,
  field: string,
): Promise<ItemValueIdentityRow[]> => {
  const result = await query<ItemValueIdentityRow>(
    user,
    `SELECT ${COLUMNS} FROM item_value_identities WHERE field = $1 ORDER BY lower(value), value`,
    [field],
  )
  return result.rows
}

export const upsertItemValueIdentity = async (
  user: string,
  field: string,
  value: string,
  catalogKey: string | null,
): Promise<ItemValueIdentityRow> => {
  const result = await query<ItemValueIdentityRow>(
    user,
    `INSERT INTO item_value_identities (field, value, catalog_key) VALUES ($1, $2, $3)
     ON CONFLICT (field, lower(btrim(value))) DO UPDATE
       SET catalog_key = EXCLUDED.catalog_key, value = EXCLUDED.value, updated_at = NOW()
     RETURNING ${COLUMNS}`,
    [field, value, catalogKey],
  )
  return result.rows[0]
}

export const deleteItemValueIdentity = async (
  user: string,
  field: string,
  value: string,
): Promise<boolean> => {
  const result = await query(
    user,
    `DELETE FROM item_value_identities WHERE field = $1 AND lower(btrim(value)) = lower(btrim($2))`,
    [field, value],
  )
  return (result.rowCount ?? 0) > 0
}

export type MoveItemValueIdentityOutcome = 'dropped' | 'moved' | 'none'

/**
 * Follow a merge of `fromValue` into `toValue`: the stored row of `fromValue` moves to `toValue`
 * unless `toValue` has its own, in which case it is dropped. A spelling-only merge keeps the row
 * under the new spelling.
 */
export const moveItemValueIdentity = async (
  user: string,
  field: string,
  fromValue: string,
  toValue: string,
): Promise<MoveItemValueIdentityOutcome> => {
  const moved = await query(
    user,
    `UPDATE item_value_identities SET value = $3
      WHERE field = $1 AND lower(btrim(value)) = lower(btrim($2))
        AND (lower(btrim($2)) = lower(btrim($3)) OR NOT EXISTS (
          SELECT 1 FROM item_value_identities
           WHERE field = $1 AND lower(btrim(value)) = lower(btrim($3))))`,
    [field, fromValue, toValue],
  )
  if ((moved.rowCount ?? 0) > 0) return 'moved'
  const dropped = await query(
    user,
    `DELETE FROM item_value_identities
      WHERE field = $1 AND lower(btrim(value)) = lower(btrim($2)) AND lower(btrim($2)) <> lower(btrim($3))`,
    [field, fromValue, toValue],
  )
  return (dropped.rowCount ?? 0) > 0 ? 'dropped' : 'none'
}
