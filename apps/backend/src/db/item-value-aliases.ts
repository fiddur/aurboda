import { query } from './connection.ts'

export interface ItemValueAliasRow {
  id: string
  field: string
  alias: string
  value: string
  created_at: Date
}

const COLUMNS = 'id, field, alias, value, created_at'

export const listItemValueAliases = async (user: string, field?: string): Promise<ItemValueAliasRow[]> => {
  const result = await query<ItemValueAliasRow>(
    user,
    `SELECT ${COLUMNS} FROM item_value_aliases
      WHERE $1::text IS NULL OR field = $1
      ORDER BY lower(alias), alias`,
    [field ?? null],
  )
  return result.rows
}

export const upsertItemValueAlias = async (
  user: string,
  field: string,
  alias: string,
  value: string,
): Promise<ItemValueAliasRow> => {
  const result = await query<ItemValueAliasRow>(
    user,
    `INSERT INTO item_value_aliases (field, alias, value) VALUES ($1, $2, $3)
     ON CONFLICT (field, lower(btrim(alias))) DO UPDATE SET value = EXCLUDED.value, alias = EXCLUDED.alias
     RETURNING ${COLUMNS}`,
    [field, alias, value],
  )
  return result.rows[0]
}

export const deleteItemValueAlias = async (user: string, id: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM item_value_aliases WHERE id = $1`, [id])
  return (result.rowCount ?? 0) > 0
}

export const repointItemValueAliases = async (
  user: string,
  field: string,
  fromValue: string,
  toValue: string,
): Promise<number> => {
  const result = await query(
    user,
    `UPDATE item_value_aliases SET value = $3
      WHERE field = $1 AND lower(btrim(value)) = lower(btrim($2))`,
    [field, fromValue, toValue],
  )
  return result.rowCount ?? 0
}

export const deleteItemValueAliasesByAlias = async (
  user: string,
  field: string,
  alias: string,
): Promise<number> => {
  const result = await query(
    user,
    `DELETE FROM item_value_aliases WHERE field = $1 AND lower(btrim(alias)) = lower(btrim($2))`,
    [field, alias],
  )
  return result.rowCount ?? 0
}
