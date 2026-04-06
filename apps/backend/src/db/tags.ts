import type { Tag, TagDefinition } from './types.ts'

/**
 * Tag CRUD operations, tag definitions, and programmatic tag detection.
 */
import { query } from './connection.ts'
import { mapTagDefinitionRow, mapTagRow } from './row-mappers.ts'

export const insertTag = async (user: string, tag: Tag): Promise<string> => {
  const result = await query(
    user,
    `INSERT INTO tags (source, external_id, tag, tag_key, tag_definition_id, start_time, end_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (source, external_id) DO UPDATE SET
       tag = EXCLUDED.tag,
       tag_key = COALESCE(EXCLUDED.tag_key, tags.tag_key),
       tag_definition_id = COALESCE(EXCLUDED.tag_definition_id, tags.tag_definition_id),
       start_time = EXCLUDED.start_time,
       end_time = EXCLUDED.end_time
     WHERE tags.deleted_at IS NULL
     RETURNING id`,
    [tag.source, tag.external_id, tag.tag, tag.tag_key, tag.tag_definition_id, tag.start_time, tag.end_time],
  )
  return result.rows[0].id as string
}

// ============================================================================
// Tag Definitions
// ============================================================================

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
 * Create a tag definition.
 */
export const insertTagDefinition = async (
  user: string,
  input: { name: string; icon?: string; aliases?: string[] },
): Promise<TagDefinition> => {
  const aliases = normalizeAliases(input.name, input.aliases)
  const result = await query(
    user,
    `INSERT INTO tag_definitions (name, icon, aliases)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [input.name, input.icon ?? null, aliases],
  )
  return mapTagDefinitionRow(result.rows[0])
}

/**
 * Get all tag definitions with occurrence counts.
 */
export const getTagDefinitions = async (
  user: string,
): Promise<(TagDefinition & { count: number; latest_time: Date | null })[]> => {
  const result = await query(
    user,
    `SELECT td.*,
            COALESCE(t.cnt, 0)::int AS count,
            t.latest_time
     FROM tag_definitions td
     LEFT JOIN (
       SELECT tag_definition_id,
              COUNT(*) AS cnt,
              MAX(start_time) AS latest_time
       FROM tags
       WHERE deleted_at IS NULL AND tag_definition_id IS NOT NULL
       GROUP BY tag_definition_id
     ) t ON t.tag_definition_id = td.id
     ORDER BY t.latest_time DESC NULLS LAST, td.name`,
  )
  return result.rows.map((row) => ({
    ...mapTagDefinitionRow(row),
    count: parseInt(row.count, 10),
    latest_time: row.latest_time ? new Date(row.latest_time) : null,
  }))
}

/**
 * Get a single tag definition by ID with occurrence count.
 */
export const getTagDefinitionById = async (
  user: string,
  id: string,
): Promise<(TagDefinition & { count: number; latest_time: Date | null }) | null> => {
  const result = await query(
    user,
    `SELECT td.*,
            COALESCE(t.cnt, 0)::int AS count,
            t.latest_time
     FROM tag_definitions td
     LEFT JOIN (
       SELECT tag_definition_id,
              COUNT(*) AS cnt,
              MAX(start_time) AS latest_time
       FROM tags
       WHERE deleted_at IS NULL AND tag_definition_id IS NOT NULL
       GROUP BY tag_definition_id
     ) t ON t.tag_definition_id = td.id
     WHERE td.id = $1`,
    [id],
  )
  if (result.rows.length === 0) return null
  return {
    ...mapTagDefinitionRow(result.rows[0]),
    count: parseInt(result.rows[0].count, 10),
    latest_time: result.rows[0].latest_time ? new Date(result.rows[0].latest_time) : null,
  }
}

/**
 * Update a tag definition.
 */
export const updateTagDefinition = async (
  user: string,
  id: string,
  updates: { name?: string; icon?: string | null; aliases?: string[] },
): Promise<TagDefinition | null> => {
  // Fetch current definition to compute final aliases
  const current = await query(user, `SELECT * FROM tag_definitions WHERE id = $1`, [id])
  if (current.rows.length === 0) return null

  const currentDef = mapTagDefinitionRow(current.rows[0])
  const newName = updates.name ?? currentDef.name
  const newAliases = normalizeAliases(newName, updates.aliases ?? currentDef.aliases)

  const result = await query(
    user,
    `UPDATE tag_definitions
     SET name = $2, icon = $3, aliases = $4, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, newName, updates.icon !== undefined ? updates.icon : (currentDef.icon ?? null), newAliases],
  )
  if (result.rows.length === 0) return null

  // Also update the display name on all linked tags
  if (updates.name && updates.name !== currentDef.name) {
    await query(user, `UPDATE tags SET tag = $1 WHERE tag_definition_id = $2`, [updates.name, id])
  }

  return mapTagDefinitionRow(result.rows[0])
}

/**
 * Delete a tag definition. Unlinks all tags (sets tag_definition_id to NULL).
 */
export const deleteTagDefinition = async (user: string, id: string): Promise<boolean> => {
  await query(user, `UPDATE tags SET tag_definition_id = NULL WHERE tag_definition_id = $1`, [id])
  const result = await query(user, `DELETE FROM tag_definitions WHERE id = $1`, [id])
  return (result.rowCount ?? 0) > 0
}

/**
 * Resolve a tag name to a definition by checking aliases.
 * Returns the first matching definition, or null if no match.
 */
export const resolveTagDefinition = async (user: string, tagName: string): Promise<TagDefinition | null> => {
  const result = await query(user, `SELECT * FROM tag_definitions WHERE $1 = ANY(aliases) LIMIT 1`, [
    tagName.toLowerCase(),
  ])
  if (result.rows.length === 0) return null
  return mapTagDefinitionRow(result.rows[0])
}

/**
 * Resolve or auto-create a tag definition for a given tag name.
 * If no definition matches, creates one with the name and optional extras.
 */
export const resolveOrCreateTagDefinition = async (
  user: string,
  tagName: string,
  extras?: { icon?: string; aliases?: string[] },
): Promise<TagDefinition> => {
  const existing = await resolveTagDefinition(user, tagName)
  if (existing) return existing

  return insertTagDefinition(user, {
    aliases: extras?.aliases,
    icon: extras?.icon,
    name: tagName,
  })
}

/**
 * Merge source definition into target. Moves all aliases, re-links all tags,
 * then deletes the source definition.
 */
export const mergeTagDefinitions = async (
  user: string,
  sourceId: string,
  targetId: string,
): Promise<TagDefinition | null> => {
  if (sourceId === targetId) return null

  // Get source definition
  const sourceResult = await query(user, `SELECT * FROM tag_definitions WHERE id = $1`, [sourceId])
  if (sourceResult.rows.length === 0) return null
  const sourceDef = mapTagDefinitionRow(sourceResult.rows[0])

  // Get target definition
  const targetResult = await query(user, `SELECT * FROM tag_definitions WHERE id = $1`, [targetId])
  if (targetResult.rows.length === 0) return null
  const targetDef = mapTagDefinitionRow(targetResult.rows[0])

  // Merge aliases
  const mergedAliases = normalizeAliases(targetDef.name, [...targetDef.aliases, ...sourceDef.aliases])

  // Update target with merged aliases
  await query(user, `UPDATE tag_definitions SET aliases = $1, updated_at = NOW() WHERE id = $2`, [
    mergedAliases,
    targetId,
  ])

  // Re-link all tags from source to target and update display name
  await query(user, `UPDATE tags SET tag_definition_id = $1, tag = $2 WHERE tag_definition_id = $3`, [
    targetId,
    targetDef.name,
    sourceId,
  ])

  // Delete source definition
  await query(user, `DELETE FROM tag_definitions WHERE id = $1`, [sourceId])

  // Return updated target
  return getTagDefinitionById(user, targetId)
}

export const getTags = async (user: string, start: Date, end: Date): Promise<Tag[]> => {
  const result = await query(
    user,
    `SELECT id, source, external_id, tag, tag_key, tag_definition_id, start_time, end_time, deleted_at
     FROM tags
     WHERE deleted_at IS NULL
       AND ((end_time IS NOT NULL AND start_time <= $2 AND end_time >= $1)
            OR (end_time IS NULL AND start_time >= $1 AND start_time <= $2))
     ORDER BY start_time`,
    [start, end],
  )

  return result.rows.map(mapTagRow)
}

export const getTagById = async (user: string, id: string, includeDeleted = false): Promise<Tag | null> => {
  const deletedClause = includeDeleted ? '' : ' AND deleted_at IS NULL'
  const result = await query(
    user,
    `SELECT id, source, external_id, tag, tag_key, tag_definition_id, start_time, end_time, deleted_at
     FROM tags
     WHERE id = $1${deletedClause}`,
    [id],
  )

  if (result.rows.length === 0) return null
  return mapTagRow(result.rows[0])
}

export const deleteTag = async (user: string, externalId: string): Promise<boolean> => {
  const result = await query(
    user,
    `UPDATE tags SET deleted_at = NOW() WHERE external_id = $1 AND deleted_at IS NULL`,
    [externalId],
  )

  return (result.rowCount ?? 0) > 0
}

export const deleteTagById = async (user: string, id: string): Promise<boolean> => {
  const result = await query(
    user,
    `UPDATE tags SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  )

  return (result.rowCount ?? 0) > 0
}

export const restoreTag = async (user: string, id: string): Promise<boolean> => {
  const result = await query(
    user,
    `UPDATE tags SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL`,
    [id],
  )

  return (result.rowCount ?? 0) > 0
}

/**
 * Find a tag that can be merged with a new tag.
 * Matches on:
 * - Same tag name
 * - end_time within mergeSpanSeconds of newStartTime (for tags with end_time)
 * - OR start_time within mergeSpanSeconds of newStartTime (for point-in-time tags without end_time)
 * Only considers tags from the specified sources (defaults to both 'aurboda' and 'manual' for
 * backward compatibility with pre-existing user-created tags).
 */
export const findMergeableTag = async (
  user: string,
  tagName: string,
  newStartTime: Date,
  mergeSpanSeconds: number,
  sources: string | string[] = ['aurboda', 'manual'],
): Promise<Tag | undefined> => {
  // Calculate the earliest allowed end_time/start_time for merging
  const earliestMergeTime = new Date(newStartTime.getTime() - mergeSpanSeconds * 1000)
  const sourceArray = Array.isArray(sources) ? sources : [sources]

  const result = await query(
    user,
    `SELECT id, source, external_id, tag, tag_key, tag_definition_id, start_time, end_time, deleted_at
     FROM tags
     WHERE tag = $1
       AND source = ANY($4)
       AND deleted_at IS NULL
       AND (
         (end_time IS NOT NULL AND end_time >= $2 AND end_time <= $3)
         OR (end_time IS NULL AND start_time >= $2 AND start_time <= $3)
       )
     ORDER BY COALESCE(end_time, start_time) DESC
     LIMIT 1`,
    [tagName, earliestMergeTime, newStartTime, sourceArray],
  )

  if (result.rows.length === 0) return undefined

  return mapTagRow(result.rows[0])
}

/**
 * Update a tag's start_time and/or end_time by database ID.
 */
export const updateTag = async (
  user: string,
  id: string,
  updates: { start_time?: Date; end_time?: Date | null },
): Promise<boolean> => {
  const setClauses: string[] = []
  const params: unknown[] = []
  let paramIndex = 1

  if (updates.start_time !== undefined) {
    setClauses.push(`start_time = $${paramIndex++}`)
    params.push(updates.start_time)
  }
  if (updates.end_time !== undefined) {
    setClauses.push(`end_time = $${paramIndex++}`)
    params.push(updates.end_time)
  }

  if (setClauses.length === 0) return true

  params.push(id)
  const result = await query(
    user,
    `UPDATE tags SET ${setClauses.join(', ')} WHERE id = $${paramIndex} AND deleted_at IS NULL`,
    params,
  )

  return (result.rowCount ?? 0) > 0
}

/**
 * Update the end_time of an existing tag.
 */
export const updateTagEndTime = async (user: string, externalId: string, endTime: Date): Promise<boolean> => {
  const result = await query(user, `UPDATE tags SET end_time = $1 WHERE external_id = $2`, [
    endTime,
    externalId,
  ])

  return (result.rowCount ?? 0) > 0
}

/**
 * Update the display name (tag column) for all tags with a given tag_key.
 * Used when a user changes a tag mapping to retroactively rename existing tags.
 */
export const updateTagNameByKey = async (user: string, tagKey: string, newName: string): Promise<number> => {
  const result = await query(user, `UPDATE tags SET tag = $1 WHERE tag_key = $2`, [newName, tagKey])
  return result.rowCount ?? 0
}

/**
 * Hard-delete all tags with a given source (including soft-deleted ones).
 * Used for full re-tagging of auto-generated tags.
 */
export const hardDeleteTagsBySource = async (user: string, source: string): Promise<number> => {
  const result = await query(user, `DELETE FROM tags WHERE source = $1`, [source])
  return result.rowCount ?? 0
}

/**
 * Hard-delete all tags whose external_id starts with the given prefix.
 * Used to clean up tags for a specific rule when it's deleted.
 */
export const hardDeleteTagsByExternalIdPrefix = async (user: string, prefix: string): Promise<number> => {
  const result = await query(user, `DELETE FROM tags WHERE external_id LIKE $1`, [prefix + '%'])
  return result.rowCount ?? 0
}

/**
 * Get unique tags from the database (all stored tag names).
 */
export const getUniqueTags = async (user: string): Promise<string[]> => {
  const result = await query(user, `SELECT DISTINCT tag FROM tags WHERE deleted_at IS NULL ORDER BY tag`)
  return result.rows.map((row) => row.tag)
}

/**
 * UUID regex pattern for matching programmatic tag identifiers.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Patterns for identifying programmatic tags that might need human-readable names.
 * - UUID pattern: Oura custom tags
 * - tag_* prefix: Oura preset tags
 */
const PROGRAMMATIC_TAG_PATTERNS = [UUID_PATTERN, /^tag_/]

/**
 * Check if a tag name looks programmatic (UUID or known prefix pattern).
 */
export const isProgrammaticTag = (tag: string): boolean =>
  PROGRAMMATIC_TAG_PATTERNS.some((pattern) => pattern.test(tag))

/**
 * Get all tags for the tag mapper.
 * Returns programmatic tags (UUIDs, tag_* prefixes) that need human-readable names,
 * plus all other tags so users can set icons on any tag.
 *
 * Uses tag_key column when available (populated by Oura sync), falling back to
 * checking the tag column for programmatic patterns (for pre-migration data).
 * Also includes non-programmatic tags grouped by display name.
 */
export const getProgrammaticTags = async (
  user: string,
): Promise<{ tagKey: string; count: number; latestTime: Date; isProgrammatic: boolean }[]> => {
  // Query tags with tag_key set (the canonical source — Oura tags)
  const tagKeyResult = await query(
    user,
    `SELECT
       tag_key,
       COUNT(*) as count,
       MAX(start_time) as latest_time
     FROM tags
     WHERE tag_key IS NOT NULL AND deleted_at IS NULL
     GROUP BY tag_key
     ORDER BY MAX(start_time) DESC`,
  )

  const fromTagKey = tagKeyResult.rows.map((row) => ({
    count: parseInt(row.count, 10),
    isProgrammatic: true,
    latestTime: new Date(row.latest_time),
    tagKey: row.tag_key as string,
  }))

  // Also check tags without tag_key, grouped by tag name
  const tagKeyValues = new Set(fromTagKey.map((t) => t.tagKey))
  const fallbackResult = await query(
    user,
    `SELECT
       tag,
       COUNT(*) as count,
       MAX(start_time) as latest_time
     FROM tags
     WHERE tag_key IS NULL AND deleted_at IS NULL
     GROUP BY tag
     ORDER BY MAX(start_time) DESC`,
  )

  const fromTag = fallbackResult.rows
    .filter((row) => !tagKeyValues.has(row.tag))
    .map((row) => ({
      count: parseInt(row.count, 10),
      isProgrammatic: isProgrammaticTag(row.tag),
      latestTime: new Date(row.latest_time),
      tagKey: row.tag as string,
    }))

  return [...fromTagKey, ...fromTag].sort((a, b) => b.latestTime.getTime() - a.latestTime.getTime())
}
