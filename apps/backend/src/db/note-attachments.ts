import type { NoteAttachmentKind } from '@aurboda/api-spec'
import type { QueryResultRow } from 'pg'

import { query } from './connection.ts'

export interface NoteAttachmentRecord {
  id: string
  note_id: string
  kind: NoteAttachmentKind
  mime: string
  size: number
  width?: number
  height?: number
  position: number
  created_at: Date
  deleted_at?: Date
}

export interface NewNoteAttachment {
  kind: NoteAttachmentKind
  mime: string
  bytes: Buffer
  width?: number
  height?: number
}

export interface NoteAttachmentUsage {
  /** The note's attachments that are not deleted. */
  live_count: number
  /** The note's highest position, deleted ones included; null when it has none. */
  max_position: number | null
  /** The stored sizes of all the user's attachments, deleted ones included. */
  account_bytes: number
}

const RECORD_COLUMNS =
  'a.id, a.note_id, a.kind, a.mime, a.size, a.width, a.height, a.position, a.created_at, a.deleted_at'

const toRecord = (row: QueryResultRow): NoteAttachmentRecord => ({
  created_at: new Date(row.created_at),
  deleted_at: row.deleted_at ? new Date(row.deleted_at) : undefined,
  height: row.height ?? undefined,
  id: row.id,
  kind: row.kind === 'audio' ? 'audio' : 'image',
  mime: row.mime,
  note_id: row.note_id,
  position: row.position,
  size: row.size,
  width: row.width ?? undefined,
})

const LIVE_NOTE = `EXISTS (SELECT 1 FROM notes n WHERE n.id = a.note_id AND n.deleted_at IS NULL)`

export const insertNoteAttachment = async (
  user: string,
  noteId: string,
  position: number,
  attachment: NewNoteAttachment,
): Promise<NoteAttachmentRecord> => {
  const result = await query(
    user,
    `INSERT INTO note_attachments AS a (note_id, kind, mime, bytes, size, width, height, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${RECORD_COLUMNS}`,
    [
      noteId,
      attachment.kind,
      attachment.mime,
      attachment.bytes,
      attachment.bytes.length,
      attachment.width ?? null,
      attachment.height ?? null,
      position,
    ],
  )
  return toRecord(result.rows[0])
}

export const getNoteAttachmentUsage = async (user: string, noteId: string): Promise<NoteAttachmentUsage> => {
  const result = await query(
    user,
    `SELECT
       (SELECT COUNT(*) FROM note_attachments WHERE note_id = $1 AND deleted_at IS NULL)::int AS live_count,
       (SELECT MAX(position) FROM note_attachments WHERE note_id = $1) AS max_position,
       (SELECT COALESCE(SUM(size), 0) FROM note_attachments)::bigint AS account_bytes`,
    [noteId],
  )
  const row = result.rows[0]
  return {
    account_bytes: Number(row.account_bytes),
    live_count: row.live_count,
    max_position: row.max_position ?? null,
  }
}

/** The live attachments of each note, by position, in one query. */
export const getNoteAttachmentsForNoteIds = async (
  user: string,
  noteIds: string[],
): Promise<Map<string, NoteAttachmentRecord[]>> => {
  if (noteIds.length === 0) return new Map()
  const result = await query(
    user,
    `SELECT ${RECORD_COLUMNS} FROM note_attachments a
      WHERE a.note_id = ANY($1::uuid[]) AND a.deleted_at IS NULL
      ORDER BY a.note_id, a.position, a.created_at`,
    [noteIds],
  )
  const map = new Map<string, NoteAttachmentRecord[]>()
  for (const row of result.rows) map.getOrInsert(row.note_id, []).push(toRecord(row))
  return map
}

/** A note's deleted attachments, newest deletion first. */
export const getDeletedNoteAttachments = async (
  user: string,
  noteId: string,
): Promise<NoteAttachmentRecord[]> => {
  const result = await query(
    user,
    `SELECT ${RECORD_COLUMNS} FROM note_attachments a
      WHERE a.note_id = $1 AND a.deleted_at IS NOT NULL
      ORDER BY a.deleted_at DESC, a.id DESC`,
    [noteId],
  )
  return result.rows.map(toRecord)
}

/** An attachment of a live note; a deleted one only when asked for. */
export const getNoteAttachment = async (
  user: string,
  noteId: string,
  id: string,
  options: { include_deleted?: boolean } = {},
): Promise<NoteAttachmentRecord | null> => {
  const result = await query(
    user,
    `SELECT ${RECORD_COLUMNS} FROM note_attachments a
      WHERE a.id = $1 AND a.note_id = $2 AND ${LIVE_NOTE}
        ${options.include_deleted ? '' : 'AND a.deleted_at IS NULL'}`,
    [id, noteId],
  )
  return result.rows.length === 0 ? null : toRecord(result.rows[0])
}

/** The bytes of a live attachment on a live note: the one query that reads them. */
export const getNoteAttachmentBytes = async (
  user: string,
  noteId: string,
  id: string,
): Promise<{ kind: NoteAttachmentKind; mime: string; bytes: Buffer } | null> => {
  const result = await query(
    user,
    `SELECT a.kind, a.mime, a.bytes FROM note_attachments a
      WHERE a.id = $1 AND a.note_id = $2 AND a.deleted_at IS NULL AND ${LIVE_NOTE}`,
    [id, noteId],
  )
  if (result.rows.length === 0) return null
  const row = result.rows[0]
  return { bytes: row.bytes as Buffer, kind: row.kind === 'audio' ? 'audio' : 'image', mime: row.mime }
}

export const softDeleteNoteAttachment = async (
  user: string,
  noteId: string,
  id: string,
): Promise<boolean> => {
  const result = await query(
    user,
    `UPDATE note_attachments a SET deleted_at = NOW()
      WHERE a.id = $1 AND a.note_id = $2 AND a.deleted_at IS NULL AND ${LIVE_NOTE}`,
    [id, noteId],
  )
  return (result.rowCount ?? 0) > 0
}

export const purgeNoteAttachment = async (user: string, noteId: string, id: string): Promise<boolean> => {
  const result = await query(
    user,
    `DELETE FROM note_attachments a WHERE a.id = $1 AND a.note_id = $2 AND ${LIVE_NOTE}`,
    [id, noteId],
  )
  return (result.rowCount ?? 0) > 0
}

export const restoreNoteAttachment = async (
  user: string,
  noteId: string,
  id: string,
): Promise<NoteAttachmentRecord | null> => {
  const result = await query(
    user,
    `UPDATE note_attachments a SET deleted_at = NULL
      WHERE a.id = $1 AND a.note_id = $2 AND ${LIVE_NOTE}
      RETURNING ${RECORD_COLUMNS}`,
    [id, noteId],
  )
  return result.rows.length === 0 ? null : toRecord(result.rows[0])
}
