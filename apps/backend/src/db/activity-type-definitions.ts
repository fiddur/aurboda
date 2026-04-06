/**
 * Activity type definition CRUD operations.
 */
import type { ActivityTypeDefinition, DisplayCategory } from '@aurboda/api-spec'

import { query } from './connection.ts'

const mapRow = (row: Record<string, unknown>): ActivityTypeDefinition => ({
  color: row.color as string,
  display_category: row.display_category as DisplayCategory,
  display_name: row.display_name as string,
  ...(row.icon != null ? { icon: row.icon as string } : {}),
  is_builtin: row.is_builtin as boolean,
  name: row.name as string,
  show_on_timeline: (row.show_on_timeline as boolean) ?? true,
})

const SELECT_COLS = 'name, display_name, display_category, color, icon, is_builtin, show_on_timeline'

export const getActivityTypeDefinitions = async (user: string): Promise<ActivityTypeDefinition[]> => {
  const result = await query(
    user,
    `SELECT ${SELECT_COLS} FROM activity_type_definitions ORDER BY is_builtin DESC, name`,
  )
  return result.rows.map(mapRow)
}

export const getActivityTypeDefinition = async (
  user: string,
  name: string,
): Promise<ActivityTypeDefinition | null> => {
  const result = await query(user, `SELECT ${SELECT_COLS} FROM activity_type_definitions WHERE name = $1`, [
    name,
  ])
  if (result.rows.length === 0) return null
  return mapRow(result.rows[0])
}

export const activityTypeExists = async (user: string, name: string): Promise<boolean> => {
  const result = await query(user, `SELECT 1 FROM activity_type_definitions WHERE name = $1 LIMIT 1`, [name])
  return result.rows.length > 0
}

export const insertActivityTypeDefinition = async (
  user: string,
  def: {
    name: string
    display_name: string
    display_category: string
    color?: string
    icon?: string
    show_on_timeline?: boolean
  },
): Promise<ActivityTypeDefinition> => {
  const result = await query(
    user,
    `INSERT INTO activity_type_definitions (name, display_name, display_category, color, icon, show_on_timeline)
     VALUES ($1, $2, $3, COALESCE($4, '#6b7280'), $5, COALESCE($6, true))
     RETURNING ${SELECT_COLS}`,
    [
      def.name,
      def.display_name,
      def.display_category,
      def.color ?? null,
      def.icon ?? null,
      def.show_on_timeline ?? null,
    ],
  )
  return mapRow(result.rows[0])
}

export const updateActivityTypeDefinition = async (
  user: string,
  name: string,
  updates: {
    display_name?: string
    display_category?: string
    color?: string
    icon?: string
    show_on_timeline?: boolean
  },
): Promise<ActivityTypeDefinition | null> => {
  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  if (updates.display_name !== undefined) {
    setClauses.push(`display_name = $${paramIndex++}`)
    values.push(updates.display_name)
  }
  if (updates.display_category !== undefined) {
    setClauses.push(`display_category = $${paramIndex++}`)
    values.push(updates.display_category)
  }
  if (updates.color !== undefined) {
    setClauses.push(`color = $${paramIndex++}`)
    values.push(updates.color)
  }
  if (updates.icon !== undefined) {
    setClauses.push(`icon = $${paramIndex++}`)
    values.push(updates.icon)
  }
  if (updates.show_on_timeline !== undefined) {
    setClauses.push(`show_on_timeline = $${paramIndex++}`)
    values.push(updates.show_on_timeline)
  }

  if (setClauses.length === 0) return getActivityTypeDefinition(user, name)

  setClauses.push(`updated_at = NOW()`)
  values.push(name)

  const result = await query(
    user,
    `UPDATE activity_type_definitions SET ${setClauses.join(', ')} WHERE name = $${paramIndex}
     RETURNING ${SELECT_COLS}`,
    values,
  )
  if (result.rows.length === 0) return null
  return mapRow(result.rows[0])
}

export const deleteActivityTypeDefinition = async (user: string, name: string): Promise<boolean> => {
  const result = await query(
    user,
    `DELETE FROM activity_type_definitions WHERE name = $1 AND is_builtin = false`,
    [name],
  )
  return (result.rowCount ?? 0) > 0
}

/** Get all activity type names (for quick validation lookups). */
export const getActivityTypeNames = async (user: string): Promise<string[]> => {
  const result = await query(user, `SELECT name FROM activity_type_definitions ORDER BY name`)
  return result.rows.map((r) => r.name as string)
}
