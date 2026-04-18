/**
 * Activity type definition CRUD operations.
 */
import type { ActivityTypeDefinition, DataSchemaDefinition, DisplayCategory } from '@aurboda/api-spec'

import { query } from './connection.ts'

const mapRow = (row: Record<string, unknown>): ActivityTypeDefinition => ({
  aliases: (row.aliases as string[]) ?? [],
  color: row.color as string,
  ...(row.data_schema != null ? { data_schema: row.data_schema as DataSchemaDefinition } : {}),
  display_category: row.display_category as DisplayCategory,
  display_name: row.display_name as string,
  ...(row.icon != null ? { icon: row.icon as string } : {}),
  is_builtin: row.is_builtin as boolean,
  name: row.name as string,
  ...(row.parent_type != null ? { parent_type: row.parent_type as string } : {}),
  show_on_timeline: (row.show_on_timeline as boolean) ?? true,
})

const SELECT_COLS =
  'name, display_name, display_category, color, icon, aliases, health_connect_record_type, health_connect_exercise_type, is_builtin, show_on_timeline, data_schema, parent_type'

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

/**
 * Ensure aliases always include the lowercased name.
 */
const normalizeAliases = (name: string, aliases: string[] = []): string[] => {
  const lowerName = name.toLowerCase()
  const uniqueAliases = new Set(aliases.map((a) => a.toLowerCase()))
  uniqueAliases.add(lowerName)
  return [...uniqueAliases]
}

/**
 * Check if setting parent_type=candidateParent on the type named typeName would
 * introduce a cycle. Walks up the candidate parent's chain; if we encounter
 * typeName before hitting a null parent, a cycle would form.
 */
const lookupParentType = async (user: string, name: string): Promise<string | null> => {
  const result = await query<{ parent_type: string | null }>(
    user,
    `SELECT parent_type FROM activity_type_definitions WHERE name = $1`,
    [name],
  )
  if (result.rows.length === 0) return null
  return result.rows[0].parent_type ?? null
}

const validateParentTypeUpdate = async (
  user: string,
  name: string,
  candidateParent: string | null,
): Promise<void> => {
  if (candidateParent === null) return
  if (candidateParent === name) {
    throw new Error('parent_type cannot reference the type itself')
  }
  const parentExists = await activityTypeExists(user, candidateParent)
  if (!parentExists) throw new Error(`parent_type "${candidateParent}" does not exist`)
  if (await wouldCreateCycle(user, name, candidateParent)) {
    throw new Error(`setting parent_type to "${candidateParent}" would create a cycle`)
  }
}

async function wouldCreateCycle(user: string, typeName: string, candidateParent: string): Promise<boolean> {
  const visited = new Set<string>()
  let currentName: string | null = candidateParent
  while (currentName !== null) {
    if (currentName === typeName) return true
    if (visited.has(currentName)) return false
    visited.add(currentName)
    currentName = await lookupParentType(user, currentName)
  }
  return false
}

/**
 * Return all descendant type names for a given parent (recursive).
 * Does NOT include the parent itself.
 */
export const getDescendantTypes = async (user: string, parentName: string): Promise<string[]> => {
  const result = await query(
    user,
    `WITH RECURSIVE descendants AS (
       SELECT name FROM activity_type_definitions WHERE parent_type = $1
       UNION ALL
       SELECT atd.name
         FROM activity_type_definitions atd
         JOIN descendants d ON atd.parent_type = d.name
     )
     SELECT name FROM descendants`,
    [parentName],
  )
  return result.rows.map((r) => r.name as string)
}

/**
 * Expand a list of activity type names to include all descendants.
 * Each input type is returned along with its recursive children.
 * Returns deduplicated names.
 */
export const expandActivityTypes = async (user: string, types: string[]): Promise<string[]> => {
  if (types.length === 0) return []
  const result = await query(
    user,
    `WITH RECURSIVE tree AS (
       SELECT name FROM activity_type_definitions WHERE name = ANY($1)
       UNION ALL
       SELECT atd.name
         FROM activity_type_definitions atd
         JOIN tree t ON atd.parent_type = t.name
     )
     SELECT DISTINCT name FROM tree`,
    [types],
  )
  return result.rows.map((r) => r.name as string)
}

export const insertActivityTypeDefinition = async (
  user: string,
  def: {
    name: string
    display_name: string
    display_category: string
    color?: string
    icon?: string
    aliases?: string[]
    show_on_timeline?: boolean
    data_schema?: DataSchemaDefinition
    parent_type?: string
  },
): Promise<ActivityTypeDefinition> => {
  const aliases = normalizeAliases(def.name, def.aliases)
  if (def.parent_type) {
    if (def.parent_type === def.name) {
      throw new Error('parent_type cannot reference the type itself')
    }
    const parentExists = await activityTypeExists(user, def.parent_type)
    if (!parentExists) throw new Error(`parent_type "${def.parent_type}" does not exist`)
  }
  const result = await query(
    user,
    `INSERT INTO activity_type_definitions (name, display_name, display_category, color, icon, aliases, show_on_timeline, data_schema, parent_type)
     VALUES ($1, $2, $3, COALESCE($4, '#6b7280'), $5, $6, COALESCE($7, true), $8, $9)
     RETURNING ${SELECT_COLS}`,
    [
      def.name,
      def.display_name,
      def.display_category,
      def.color ?? null,
      def.icon ?? null,
      aliases,
      def.show_on_timeline ?? null,
      def.data_schema ? JSON.stringify(def.data_schema) : null,
      def.parent_type ?? null,
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
    icon?: string | null
    aliases?: string[]
    show_on_timeline?: boolean
    data_schema?: DataSchemaDefinition | null
    parent_type?: string | null
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
  if (updates.aliases !== undefined) {
    setClauses.push(`aliases = $${paramIndex++}`)
    values.push(normalizeAliases(name, updates.aliases))
  }
  if (updates.show_on_timeline !== undefined) {
    setClauses.push(`show_on_timeline = $${paramIndex++}`)
    values.push(updates.show_on_timeline)
  }
  if (updates.data_schema !== undefined) {
    setClauses.push(`data_schema = $${paramIndex++}`)
    values.push(updates.data_schema ? JSON.stringify(updates.data_schema) : null)
  }
  if (updates.parent_type !== undefined) {
    await validateParentTypeUpdate(user, name, updates.parent_type)
    setClauses.push(`parent_type = $${paramIndex++}`)
    values.push(updates.parent_type)
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

/**
 * Resolve a free-form string to an activity type definition by checking aliases.
 * Returns the definition name if found, or null if no match.
 */
export const resolveActivityTypeByAlias = async (user: string, alias: string): Promise<string | null> => {
  const lowerAlias = alias.toLowerCase()
  const result = await query(
    user,
    `SELECT name FROM activity_type_definitions WHERE $1 = ANY(aliases) LIMIT 1`,
    [lowerAlias],
  )
  if (result.rows.length === 0) return null
  return result.rows[0].name as string
}

/**
 * Resolve or create an activity type definition from a display name.
 * Used during sync to ensure all incoming types get a definition.
 */
export const resolveOrCreateActivityType = async (
  user: string,
  displayName: string,
  displayCategory = 'other',
): Promise<string> => {
  // Try direct name match first
  const snakeName =
    displayName
      .replaceAll(/[[\]()]/g, '')
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '_')
      .replaceAll(/^_|_$/g, '')
      .replaceAll(/_+/g, '_') || 'unknown'

  // Ensure name starts with a letter (activity_type schema requires ^[a-z])
  const safeName = /^[a-z]/.test(snakeName) ? snakeName : `t_${snakeName}`

  const existing = await getActivityTypeDefinition(user, safeName)
  if (existing) return existing.name

  // Try alias match
  const aliasMatch = await resolveActivityTypeByAlias(user, displayName)
  if (aliasMatch) return aliasMatch

  // Create new definition
  const created = await insertActivityTypeDefinition(user, {
    aliases: [displayName.toLowerCase()],
    display_category: displayCategory,
    display_name: displayName,
    name: safeName,
  })
  return created.name
}

/**
 * Look up the Health Connect exercise type int for an activity type.
 */
export const getHealthConnectExerciseType = async (
  user: string,
  activityType: string,
): Promise<number | null> => {
  const result = await query(
    user,
    `SELECT health_connect_exercise_type FROM activity_type_definitions WHERE name = $1`,
    [activityType],
  )
  if (result.rows.length === 0) return null
  return (result.rows[0].health_connect_exercise_type as number) ?? null
}

/**
 * Resolve an activity type from a Health Connect exercise type int.
 */
export const resolveActivityTypeFromHcExerciseType = async (
  user: string,
  hcExerciseType: number,
): Promise<string | null> => {
  const result = await query(
    user,
    `SELECT name FROM activity_type_definitions WHERE health_connect_exercise_type = $1 LIMIT 1`,
    [hcExerciseType],
  )
  if (result.rows.length === 0) return null
  return result.rows[0].name as string
}

/**
 * Merge a custom activity type into another activity type.
 * Merges aliases, reassigns all activities, updates deduction rules, then deletes the source.
 */
export const mergeActivityTypeDefinition = async (
  user: string,
  sourceName: string,
  targetName: string,
): Promise<{
  activities_reassigned: number
  deduction_rules_updated: number
  target: ActivityTypeDefinition
} | null> => {
  if (sourceName === targetName) return null

  // Get source — must exist and not be built-in
  const sourceResult = await query(
    user,
    `SELECT ${SELECT_COLS} FROM activity_type_definitions WHERE name = $1`,
    [sourceName],
  )
  if (sourceResult.rows.length === 0) return null
  const sourceDef = mapRow(sourceResult.rows[0])
  if (sourceDef.is_builtin) return null

  // Get target — must exist
  const targetResult = await query(
    user,
    `SELECT ${SELECT_COLS} FROM activity_type_definitions WHERE name = $1`,
    [targetName],
  )
  if (targetResult.rows.length === 0) return null
  const targetDef = mapRow(targetResult.rows[0])

  // Merge aliases from source into target
  const mergedAliases = normalizeAliases(targetDef.name, [
    ...(targetDef.aliases ?? []),
    ...(sourceDef.aliases ?? []),
  ])
  await query(user, `UPDATE activity_type_definitions SET aliases = $1, updated_at = NOW() WHERE name = $2`, [
    mergedAliases,
    targetName,
  ])

  // Reassign all activities from source to target
  const activitiesResult = await query(
    user,
    `UPDATE activities SET activity_type = $1 WHERE activity_type = $2 AND deleted_at IS NULL`,
    [targetName, sourceName],
  )
  const activities_reassigned = activitiesResult.rowCount ?? 0

  // Reparent any children of the source to the target
  await query(
    user,
    `UPDATE activity_type_definitions SET parent_type = $1, updated_at = NOW() WHERE parent_type = $2`,
    [targetName, sourceName],
  )

  // Update deduction rules: output_activity_type
  const outputResult = await query(
    user,
    `UPDATE deduction_rules SET output_activity_type = $1, updated_at = NOW() WHERE output_activity_type = $2`,
    [targetName, sourceName],
  )
  let deduction_rules_updated = outputResult.rowCount ?? 0

  // Update deduction rules: conditions JSONB where kind = 'activity' references the source type
  const conditionsResult = await query(
    user,
    `UPDATE deduction_rules
     SET conditions = (
       SELECT jsonb_agg(
         CASE
           WHEN elem->>'kind' = 'activity' AND elem->>'activity_type' = $2
           THEN jsonb_set(elem, '{activity_type}', to_jsonb($1::text))
           ELSE elem
         END
       )
       FROM jsonb_array_elements(conditions::jsonb) AS elem
     ),
     updated_at = NOW()
     WHERE EXISTS (
       SELECT 1 FROM jsonb_array_elements(conditions::jsonb) AS elem
       WHERE elem->>'kind' = 'activity' AND elem->>'activity_type' = $2
     )`,
    [targetName, sourceName],
  )
  deduction_rules_updated += conditionsResult.rowCount ?? 0

  // Delete source definition
  await query(user, `DELETE FROM activity_type_definitions WHERE name = $1 AND is_builtin = false`, [
    sourceName,
  ])

  // Return updated target
  const updated = await getActivityTypeDefinition(user, targetName)
  if (!updated) return null

  return { activities_reassigned, deduction_rules_updated, target: updated }
}

/**
 * Rename an activity type's snake_case name.
 * Updates the definition, reassigns all activities, and updates deduction rules.
 * Only allowed for custom (non-built-in) types. New name must not already exist.
 */
export const renameActivityTypeDefinition = async (
  user: string,
  oldName: string,
  newName: string,
): Promise<{
  activities_updated: number
  deduction_rules_updated: number
  definition: ActivityTypeDefinition
} | null> => {
  if (oldName === newName) return null

  // Verify source exists and is not built-in
  const sourceResult = await query(
    user,
    `SELECT ${SELECT_COLS} FROM activity_type_definitions WHERE name = $1`,
    [oldName],
  )
  if (sourceResult.rows.length === 0) return null
  const sourceDef = mapRow(sourceResult.rows[0])
  if (sourceDef.is_builtin) return null

  // Verify new name doesn't already exist
  const existingResult = await query(
    user,
    `SELECT 1 FROM activity_type_definitions WHERE name = $1 LIMIT 1`,
    [newName],
  )
  if (existingResult.rows.length > 0) return null

  // Count affected rows before rename (for return values)
  const activitiesCount = await query(
    user,
    `SELECT COUNT(*) AS count FROM activities WHERE activity_type = $1 AND deleted_at IS NULL`,
    [oldName],
  )
  const activities_updated = parseInt(activitiesCount.rows[0].count, 10)

  const rulesCount = await query(
    user,
    `SELECT COUNT(*) AS count FROM deduction_rules WHERE output_activity_type = $1`,
    [oldName],
  )
  let deduction_rules_updated = parseInt(rulesCount.rows[0].count, 10)

  // Update the definition name and aliases.
  // FK ON UPDATE CASCADE automatically propagates to activities.activity_type
  // and deduction_rules.output_activity_type.
  const updatedAliases = normalizeAliases(
    newName,
    (sourceDef.aliases ?? []).filter((a) => a !== oldName),
  )
  const defResult = await query(
    user,
    `UPDATE activity_type_definitions SET name = $1, aliases = $2, updated_at = NOW() WHERE name = $3
     RETURNING ${SELECT_COLS}`,
    [newName, updatedAliases, oldName],
  )
  if (defResult.rows.length === 0) return null

  // Update deduction rules: conditions JSONB (not covered by FK — values inside JSONB)
  const conditionsResult = await query(
    user,
    `UPDATE deduction_rules
     SET conditions = (
       SELECT jsonb_agg(
         CASE
           WHEN elem->>'kind' = 'activity' AND elem->>'activity_type' = $2
           THEN jsonb_set(elem, '{activity_type}', to_jsonb($1::text))
           ELSE elem
         END
       )
       FROM jsonb_array_elements(conditions::jsonb) AS elem
     ),
     updated_at = NOW()
     WHERE EXISTS (
       SELECT 1 FROM jsonb_array_elements(conditions::jsonb) AS elem
       WHERE elem->>'kind' = 'activity' AND elem->>'activity_type' = $2
     )`,
    [newName, oldName],
  )
  deduction_rules_updated += conditionsResult.rowCount ?? 0

  return { activities_updated, deduction_rules_updated, definition: mapRow(defResult.rows[0]) }
}

export const deleteActivityTypeDefinition = async (user: string, name: string): Promise<boolean> => {
  // Reparent children to the deleted type's parent (may be null, which makes them top-level).
  const parentResult = await query(
    user,
    `SELECT parent_type FROM activity_type_definitions WHERE name = $1`,
    [name],
  )
  if (parentResult.rows.length === 0) return false
  const grandparent = (parentResult.rows[0].parent_type as string | null) ?? null
  await query(
    user,
    `UPDATE activity_type_definitions SET parent_type = $1, updated_at = NOW() WHERE parent_type = $2`,
    [grandparent, name],
  )

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
