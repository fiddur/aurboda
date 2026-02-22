/**
 * Notes CRUD operations.
 */
import { query } from './connection'
import { mapNoteRow } from './row-mappers'
import type { EntityType, Note } from './types'

const NOTE_COLUMNS = 'id, entity_type, entity_id, content, created_at, updated_at'

export const insertNote = async (
  user: string,
  entityType: EntityType,
  entityId: string,
  content: string,
): Promise<Note> => {
  const result = await query(
    user,
    `INSERT INTO notes (entity_type, entity_id, content)
     VALUES ($1, $2, $3)
     RETURNING ${NOTE_COLUMNS}`,
    [entityType, entityId, content],
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

export const deleteNote = async (user: string, id: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM notes WHERE id = $1`, [id])
  return (result.rowCount ?? 0) > 0
}
