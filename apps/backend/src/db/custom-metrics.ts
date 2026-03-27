/**
 * Custom metric definitions CRUD operations.
 */
import type { CustomMetricDefinition } from '@aurboda/api-spec'

import { query } from './connection.ts'

const mapRow = (row: Record<string, unknown>): CustomMetricDefinition => ({
  name: row.name as string,
  unit: row.unit as string,
  ...(row.description != null ? { description: row.description as string } : {}),
  ...(row.min_value != null ? { min_value: row.min_value as number } : {}),
  ...(row.max_value != null ? { max_value: row.max_value as number } : {}),
})

export const getCustomMetricDefinitions = async (user: string): Promise<CustomMetricDefinition[]> => {
  const result = await query(
    user,
    `SELECT name, unit, description, min_value, max_value FROM custom_metrics ORDER BY name`,
  )
  return result.rows.map(mapRow)
}

export const getCustomMetricByName = async (
  user: string,
  name: string,
): Promise<CustomMetricDefinition | null> => {
  const result = await query(
    user,
    `SELECT name, unit, description, min_value, max_value FROM custom_metrics WHERE name = $1`,
    [name],
  )
  if (result.rows.length === 0) return null
  return mapRow(result.rows[0])
}

export const insertCustomMetricDefinition = async (
  user: string,
  definition: CustomMetricDefinition,
): Promise<void> => {
  await query(
    user,
    `INSERT INTO custom_metrics (name, unit, description, min_value, max_value)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      definition.name,
      definition.unit,
      definition.description ?? null,
      definition.min_value ?? null,
      definition.max_value ?? null,
    ],
  )
}

export const updateCustomMetricDefinition = async (
  user: string,
  name: string,
  updates: Partial<Pick<CustomMetricDefinition, 'unit' | 'description' | 'min_value' | 'max_value'>>,
): Promise<CustomMetricDefinition | null> => {
  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  if (updates.unit !== undefined) {
    setClauses.push(`unit = $${paramIndex++}`)
    values.push(updates.unit)
  }
  if (updates.description !== undefined) {
    setClauses.push(`description = $${paramIndex++}`)
    values.push(updates.description)
  }
  if (updates.min_value !== undefined) {
    setClauses.push(`min_value = $${paramIndex++}`)
    values.push(updates.min_value)
  }
  if (updates.max_value !== undefined) {
    setClauses.push(`max_value = $${paramIndex++}`)
    values.push(updates.max_value)
  }

  if (setClauses.length === 0) return getCustomMetricByName(user, name)

  setClauses.push(`updated_at = NOW()`)
  values.push(name)

  const result = await query(
    user,
    `UPDATE custom_metrics SET ${setClauses.join(', ')} WHERE name = $${paramIndex}
     RETURNING name, unit, description, min_value, max_value`,
    values,
  )
  if (result.rows.length === 0) return null
  return mapRow(result.rows[0])
}

export const deleteCustomMetricDefinition = async (user: string, name: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM custom_metrics WHERE name = $1`, [name])
  return (result.rowCount ?? 0) > 0
}

/**
 * Bulk insert custom metric definitions (used during migration from settings JSONB).
 */
export const bulkInsertCustomMetricDefinitions = async (
  user: string,
  definitions: CustomMetricDefinition[],
): Promise<void> => {
  for (const def of definitions) {
    await query(
      user,
      `INSERT INTO custom_metrics (name, unit, description, min_value, max_value)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name) DO NOTHING`,
      [def.name, def.unit, def.description ?? null, def.min_value ?? null, def.max_value ?? null],
    )
  }
}
