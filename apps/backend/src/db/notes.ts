import type { DataSource } from '@aurboda/api-spec'

import type { EntityType, Note } from './types.ts'

import { query } from './connection.ts'
import { buildDynamicUpdate } from './dynamic-update.ts'
import { mapNoteRow } from './row-mappers.ts'

const NOTE_COLUMNS =
  'id, entity_type, entity_id, content, source, start_time, end_time, created_at, updated_at'

export const insertNote = async (
  user: string,
  entityType: EntityType,
  entityId: string | null,
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

export interface NoteFieldUpdates {
  content?: string
  start_time?: Date
  end_time?: Date | null
}

/** `updated_at` is always bumped, so passing no fields still touches the row. */
export const updateNoteFields = async (
  user: string,
  id: string,
  fields: NoteFieldUpdates,
): Promise<Note | null> => {
  const entries = []
  if (fields.content !== undefined) entries.push({ column: 'content', value: fields.content })
  if (fields.start_time !== undefined) entries.push({ column: 'start_time', value: fields.start_time })
  if (fields.end_time !== undefined) entries.push({ column: 'end_time', value: fields.end_time })

  const update = buildDynamicUpdate('notes', id, entries, {
    defaultClauses: ['updated_at = NOW()'],
    returning: NOTE_COLUMNS,
  })
  if (!update) return null

  const result = await query(user, update.sql, update.params)

  if (result.rows.length === 0) return null
  return mapNoteRow(result.rows[0])
}

/**
 * Resolve a note to its thread root. A reply (`entity_type = 'note'`) resolves
 * to the note its `entity_id` points at; anything else resolves to itself.
 * One hop is enough: replies-to-replies are re-anchored at write time.
 */
export const getNoteRoot = async (user: string, id: string): Promise<Note | null> => {
  const note = await getNoteById(user, id)
  if (!note) return null
  if (note.entity_type !== 'note' || !note.entity_id) return note
  return getNoteById(user, note.entity_id)
}

/** Called when the parent entity's timing changes (e.g. a tag is updated). */
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

  // Replies sit at the same point in time as the comment they hang off.
  await query(
    user,
    `UPDATE notes SET start_time = $1, end_time = $2, updated_at = NOW()
     WHERE entity_type = 'note'
       AND entity_id IN (SELECT id::text FROM notes WHERE entity_type = $3 AND entity_id = $4)`,
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
    if (note.entity_id === null) continue
    const existing = map.get(note.entity_id) ?? []
    existing.push(note)
    map.set(note.entity_id, existing)
  }
  return map
}

/** Threads are one level deep, so the result never needs recursing into. */
export const getRepliesForRootIds = async (user: string, rootIds: string[]): Promise<Map<string, Note[]>> =>
  getNotesByEntityIds(user, 'note', rootIds)

/**
 * Notes with no start_time (e.g. metric notes using composite entity_id) are excluded from this query.
 * Replies (`entity_type = 'note'`) are excluded too — they only ever surface nested under their root.
 */
export const getNotesForTimeRange = async (user: string, start: Date, end: Date): Promise<Note[]> => {
  const result = await query(
    user,
    `SELECT ${NOTE_COLUMNS} FROM notes
     WHERE start_time IS NOT NULL
       AND entity_type <> 'note'
       AND ((end_time IS NOT NULL AND start_time <= $2 AND end_time >= $1)
            OR (end_time IS NULL AND start_time >= $1 AND start_time <= $2))
     ORDER BY start_time ASC, created_at ASC`,
    [start, end],
  )

  return result.rows.map(mapNoteRow)
}

/**
 * Delete a note and, when it is a thread root, every reply hanging off it.
 * There is no FK between a reply and its root, so the cascade is explicit.
 */
export const deleteNote = async (user: string, id: string): Promise<boolean> => {
  const result = await query(
    user,
    `DELETE FROM notes WHERE id = $1 OR (entity_type = 'note' AND entity_id = $1::text)`,
    [id],
  )
  return (result.rowCount ?? 0) > 0
}

/**
 * Delete every comment on an entity, replies included. For an entity that is
 * removed for good (a meal, unlike a soft-deleted activity), its comments have
 * nothing left to hang off: they would keep drawing a Timeline bubble linking
 * to a page that 404s. Returns how many thread roots were removed.
 */
export const deleteNotesForEntity = async (
  user: string,
  entityType: EntityType,
  entityId: string,
): Promise<number> => {
  await query(user, 'BEGIN')
  try {
    const deleted = await query<{ id: string }>(
      user,
      `DELETE FROM notes WHERE entity_type = $1 AND entity_id = $2 RETURNING id`,
      [entityType, entityId],
    )
    const deletedIds = deleted.rows.map((r) => r.id)
    if (deletedIds.length > 0) {
      await query(user, `DELETE FROM notes WHERE entity_type = 'note' AND entity_id = ANY($1)`, [deletedIds])
    }
    await query(user, 'COMMIT')
    return deletedIds.length
  } catch (err) {
    await query(user, 'ROLLBACK').catch(() => {})
    throw err
  }
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
    const deleted = await query<{ id: string }>(
      user,
      `DELETE FROM notes WHERE entity_type = $1 AND entity_id = $2 AND source IS NULL RETURNING id`,
      [entityType, entityId],
    )
    // Replies hang off the notes we just removed; drop them too rather than
    // leaving them orphaned (there is no FK to cascade for us).
    const deletedIds = deleted.rows.map((r) => r.id)
    if (deletedIds.length > 0) {
      await query(user, `DELETE FROM notes WHERE entity_type = 'note' AND entity_id = ANY($1)`, [deletedIds])
    }
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
 *
 * Replies never surface here: they carry `entity_type = 'note'`, so the
 * entity_type filter already excludes them.
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

/** An empty/null content deletes the synced note (the comment was removed upstream). */
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
