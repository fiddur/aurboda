/**
 * Tag CRUD operations and programmatic tag detection.
 */
import { query } from './connection'
import { mapTagRow } from './row-mappers'
import type { Tag } from './types'

export const insertTag = async (user: string, tag: Tag) => {
  await query(
    user,
    `INSERT INTO tags (source, external_id, tag, start_time, end_time)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (source, external_id) DO UPDATE SET
       tag = EXCLUDED.tag,
       start_time = EXCLUDED.start_time,
       end_time = EXCLUDED.end_time`,
    [tag.source, tag.external_id, tag.tag, tag.start_time, tag.end_time],
  )
}

export const getTags = async (user: string, start: Date, end: Date): Promise<Tag[]> => {
  const result = await query(
    user,
    `SELECT id, source, external_id, tag, start_time, end_time
     FROM tags
     WHERE start_time >= $1 AND start_time <= $2
     ORDER BY start_time`,
    [start, end],
  )

  return result.rows.map(mapTagRow)
}

export const deleteTag = async (user: string, externalId: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM tags WHERE external_id = $1`, [externalId])

  return (result.rowCount ?? 0) > 0
}

/**
 * Find a tag that can be merged with a new tag.
 * Matches on:
 * - Same tag name
 * - end_time within mergeSpanSeconds of newStartTime (for tags with end_time)
 * - OR start_time within mergeSpanSeconds of newStartTime (for point-in-time tags without end_time)
 * Only considers tags from the specified source (defaults to 'manual').
 */
export const findMergeableTag = async (
  user: string,
  tagName: string,
  newStartTime: Date,
  mergeSpanSeconds: number,
  source: string = 'manual',
): Promise<Tag | undefined> => {
  // Calculate the earliest allowed end_time/start_time for merging
  const earliestMergeTime = new Date(newStartTime.getTime() - mergeSpanSeconds * 1000)

  const result = await query(
    user,
    `SELECT id, source, external_id, tag, start_time, end_time
     FROM tags
     WHERE tag = $1
       AND source = $4
       AND (
         (end_time IS NOT NULL AND end_time >= $2 AND end_time <= $3)
         OR (end_time IS NULL AND start_time >= $2 AND start_time <= $3)
       )
     ORDER BY COALESCE(end_time, start_time) DESC
     LIMIT 1`,
    [tagName, earliestMergeTime, newStartTime, source],
  )

  if (result.rows.length === 0) return undefined

  return mapTagRow(result.rows[0])
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
 * Get unique tags from the database (all stored tag names).
 */
export const getUniqueTags = async (user: string): Promise<string[]> => {
  const result = await query(user, `SELECT DISTINCT tag FROM tags ORDER BY tag`)
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
 * Get programmatic tags from the tags table.
 * Returns tags that look like they need human-readable names (UUIDs, tag_* prefixes, etc.)
 * along with usage counts and last seen times.
 */
export const getProgrammaticTags = async (
  user: string,
): Promise<{ tagKey: string; count: number; latestTime: Date }[]> => {
  // Query all unique tags with counts - we filter in JS for pattern matching flexibility
  const result = await query(
    user,
    `SELECT
       tag,
       COUNT(*) as count,
       MAX(start_time) as latest_time
     FROM tags
     GROUP BY tag
     ORDER BY MAX(start_time) DESC`,
  )

  return result.rows
    .filter((row) => isProgrammaticTag(row.tag))
    .map((row) => ({
      count: parseInt(row.count, 10),
      latestTime: new Date(row.latest_time),
      tagKey: row.tag,
    }))
}
