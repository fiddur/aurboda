import type { EntityType, Note } from './types.ts'

/**
 * Notes CRUD operations.
 */
import { query } from './connection.ts'
import { mapNoteRow } from './row-mappers.ts'

const NOTE_COLUMNS = 'id, entity_type, entity_id, content, start_time, end_time, created_at, updated_at'

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
