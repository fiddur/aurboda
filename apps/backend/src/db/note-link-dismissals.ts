import type { NoteRelatedEntityType } from '@aurboda/api-spec'

import { query } from './connection.ts'

export interface NoteLinkDismissal {
  entity_type: NoteRelatedEntityType
  entity_id: string
}

/** Remember that a suggestion was turned down for the note; dismissing it again changes nothing. */
export const insertNoteLinkDismissal = async (
  user: string,
  noteId: string,
  dismissal: NoteLinkDismissal,
): Promise<void> => {
  await query(
    user,
    `INSERT INTO note_link_dismissals (note_id, entity_type, entity_id)
     VALUES ($1, $2, $3::uuid)
     ON CONFLICT DO NOTHING`,
    [noteId, dismissal.entity_type, dismissal.entity_id.toLowerCase()],
  )
}

/** The dismissed suggestions of each note, in one query. */
export const getNoteLinkDismissalsForNoteIds = async (
  user: string,
  noteIds: string[],
): Promise<Map<string, NoteLinkDismissal[]>> => {
  if (noteIds.length === 0) return new Map()
  const result = await query<{ note_id: string; entity_type: NoteRelatedEntityType; entity_id: string }>(
    user,
    `SELECT note_id::text AS note_id, entity_type, entity_id::text AS entity_id
       FROM note_link_dismissals
      WHERE note_id = ANY($1::uuid[])
      ORDER BY note_id, created_at, entity_type, entity_id`,
    [noteIds],
  )
  const byNote = new Map<string, NoteLinkDismissal[]>()
  for (const row of result.rows) {
    byNote.getOrInsert(row.note_id, []).push({ entity_id: row.entity_id, entity_type: row.entity_type })
  }
  return byNote
}
