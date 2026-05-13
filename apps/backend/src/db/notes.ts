import type { DataSource } from '@aurboda/api-spec'

import type { EntityType, Note } from './types.ts'

/**
 * Notes CRUD operations.
 */
import { query } from './connection.ts'
import { mapNoteRow } from './row-mappers.ts'

const NOTE_COLUMNS =
  'id, entity_type, entity_id, content, source, start_time, end_time, created_at, updated_at'

export const insertNote = async (
  user: string,
  entityType: EntityType,
  entityId: string,
  content: string,
  startTime?: Date,
  endTime?: Date,
): Promise<Note> => {
  const result = await query(
    user,
    `INSERT INTO notes (entity_type, entity_id, content, start_time, end_time)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${NOTE_COLUMNS}`,
    [entityType, entityId, content, startTime ?? null, endTime ?? null],
  )

  return mapNoteRow(result.rows[0])
}

export const getNoteById = async (user: string, id: string): Promise<Note | null> => {
  const result = await query(user, `SELECT ${NOTE_COLUMNS} FROM notes WHERE id = $1`, [id])

  if (result.rows.length === 0) return null
  return mapNoteRow(result.rows[0])
}

export const getNotesForEntity = async (
  user: string,
  entityType: EntityType,
  entityId: string,
): Promise<Note[]> => {
  const result = await query(
    user,
    `SELECT ${NOTE_COLUMNS} FROM notes
     WHERE entity_type = $1 AND entity_id = $2
     ORDER BY created_at ASC`,
    [entityType, entityId],
  )

  return result.rows.map(mapNoteRow)
}

export const updateNote = async (user: string, id: string, content: string): Promise<Note | null> => {
  const result = await query(
    user,
    `UPDATE notes SET content = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING ${NOTE_COLUMNS}`,
    [content, id],
  )

  if (result.rows.length === 0) return null
  return mapNoteRow(result.rows[0])
}

/**
 * Update the inherited time fields on all notes for a given entity.
 * Called when the parent entity's timing changes (e.g. a tag is updated).
 */
export const updateNoteTimesForEntity = async (
  user: string,
  entityType: EntityType,
  entityId: string,
  startTime: Date,
  endTime?: Date,
): Promise<void> => {
  await query(
    user,
    `UPDATE notes SET start_time = $1, end_time = $2, updated_at = NOW()
     WHERE entity_type = $3 AND entity_id = $4`,
    [startTime, endTime ?? null, entityType, entityId],
  )
}

export const getNotesByEntityIds = async (
  user: string,
  entityType: EntityType,
  entityIds: string[],
): Promise<Map<string, Note[]>> => {
  if (entityIds.length === 0) return new Map()
  const result = await query(
    user,
    `SELECT ${NOTE_COLUMNS} FROM notes
     WHERE entity_type = $1 AND entity_id = ANY($2)
     ORDER BY created_at ASC`,
    [entityType, entityIds],
  )
  const map = new Map<string, Note[]>()
  for (const row of result.rows) {
    const note = mapNoteRow(row)
    const existing = map.get(note.entity_id) ?? []
    existing.push(note)
    map.set(note.entity_id, existing)
  }
  return map
}

/**
 * Get all notes whose time range overlaps [start, end].
 *
 * A note overlaps the window if:
 *  - It has a start_time and end_time, and they overlap [start, end] (i.e. start_time <= end AND end_time >= start)
 *  - It has a start_time but no end_time (point-in-time), and start_time falls within [start, end]
 *
 * Notes with no start_time (e.g. metric notes using composite entity_id) are excluded from this query.
 */
export const getNotesForTimeRange = async (user: string, start: Date, end: Date): Promise<Note[]> => {
  const result = await query(
    user,
    `SELECT ${NOTE_COLUMNS} FROM notes
     WHERE start_time IS NOT NULL
       AND ((end_time IS NOT NULL AND start_time <= $2 AND end_time >= $1)
            OR (end_time IS NULL AND start_time >= $1 AND start_time <= $2))
     ORDER BY start_time ASC, created_at ASC`,
    [start, end],
  )

  return result.rows.map(mapNoteRow)
}

export const deleteNote = async (user: string, id: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM notes WHERE id = $1`, [id])
  return (result.rowCount ?? 0) > 0
}

/**
 * Replace all user-authored notes (`source IS NULL`) for an entity with a
 * single new note. Synced notes (source = 'health_connect', 'oura', …) are
 * left untouched. If `content` is empty, just clears the user notes.
 *
 * Wrapped in a transaction so a concurrent edit can't observe the entity
 * with zero user notes between the DELETE and the INSERT.
 */
export const replaceUserNotes = async (
  user: string,
  entityType: EntityType,
  entityId: string,
  content: string,
  startTime?: Date,
  endTime?: Date,
): Promise<void> => {
  await query(user, 'BEGIN')
  try {
    await query(user, `DELETE FROM notes WHERE entity_type = $1 AND entity_id = $2 AND source IS NULL`, [
      entityType,
      entityId,
    ])
    if (content.length > 0) {
      await query(
        user,
        `INSERT INTO notes (entity_type, entity_id, content, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5)`,
        [entityType, entityId, content, startTime ?? null, endTime ?? null],
      )
    }
    await query(user, 'COMMIT')
  } catch (err) {
    await query(user, 'ROLLBACK').catch(() => {})
    throw err
  }
}

/**
 * Join all user-authored notes (`source IS NULL`) for an entity into a single
 * string, ordered chronologically by created_at. Returns undefined if none.
 * Used for outbound HC sync, where the destination has a single `notes` field.
 */
export const getUserNotesJoined = async (
  user: string,
  entityType: EntityType,
  entityId: string,
): Promise<string | undefined> => {
  const result = await query<{ content: string }>(
    user,
    `SELECT content FROM notes
     WHERE entity_type = $1 AND entity_id = $2 AND source IS NULL
     ORDER BY created_at ASC`,
    [entityType, entityId],
  )
  if (result.rows.length === 0) return undefined
  return result.rows.map((r) => r.content).join('\n')
}

/**
 * Re-anchor notes from a set of source entities to a new entity (e.g. when
 * `mergeActivities` collapses several activities into one). All notes whose
 * `entity_id` is in `sourceIds` are reassigned to `targetId`.
 */
export const reanchorNotes = async (
  user: string,
  entityType: EntityType,
  sourceIds: string[],
  targetId: string,
): Promise<void> => {
  if (sourceIds.length === 0) return
  await query(
    user,
    `UPDATE notes SET entity_id = $1, updated_at = NOW()
     WHERE entity_type = $2 AND entity_id = ANY($3)`,
    [targetId, entityType, sourceIds],
  )
}

/**
 * Upsert a note from an external sync source.
 * If a note with the same entity + source already exists, update its content.
 * If the content is empty/null, delete the synced note (comment was removed upstream).
 */
export const upsertSyncedNote = async (
  user: string,
  entityType: EntityType,
  entityId: string,
  source: DataSource,
  content: string | undefined,
  startTime?: Date,
  endTime?: Date,
): Promise<void> => {
  if (!content) {
    // Remove synced note if comment was cleared upstream
    await query(user, `DELETE FROM notes WHERE entity_type = $1 AND entity_id = $2 AND source = $3`, [
      entityType,
      entityId,
      source,
    ])
    return
  }

  const result = await query(
    user,
    `UPDATE notes SET content = $1, start_time = $5, end_time = $6, updated_at = NOW()
     WHERE entity_type = $2 AND entity_id = $3 AND source = $4`,
    [content, entityType, entityId, source, startTime ?? null, endTime ?? null],
  )

  if ((result.rowCount ?? 0) === 0) {
    await query(
      user,
      `INSERT INTO notes (entity_type, entity_id, content, source, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entityType, entityId, content, source, startTime ?? null, endTime ?? null],
    )
  }
}
