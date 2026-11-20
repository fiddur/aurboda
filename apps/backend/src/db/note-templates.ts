import type { QueryResultRow } from 'pg'

import { query } from './connection.ts'

export interface NoteTemplateRecord {
  id: string
  name: string
  content: string
  created_at: Date
  updated_at: Date
  deleted_at?: Date
}

const COLUMNS = 'id, name, content, created_at, updated_at, deleted_at'

const toRecord = (row: QueryResultRow): NoteTemplateRecord => ({
  content: row.content,
  created_at: new Date(row.created_at),
  deleted_at: row.deleted_at ? new Date(row.deleted_at) : undefined,
  id: row.id,
  name: row.name,
  updated_at: new Date(row.updated_at),
})

export const insertNoteTemplate = async (
  user: string,
  template: { name: string; content: string },
): Promise<NoteTemplateRecord> => {
  const result = await query(
    user,
    `INSERT INTO note_templates (name, content) VALUES ($1, $2) RETURNING ${COLUMNS}`,
    [template.name, template.content],
  )
  return toRecord(result.rows[0])
}

/** The live templates by name, or with `deleted` the deleted ones, newest deletion first. */
export const listNoteTemplates = async (
  user: string,
  options: { deleted?: boolean } = {},
): Promise<NoteTemplateRecord[]> => {
  const result = await query(
    user,
    options.deleted
      ? `SELECT ${COLUMNS} FROM note_templates WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id DESC`
      : `SELECT ${COLUMNS} FROM note_templates WHERE deleted_at IS NULL ORDER BY lower(name), created_at, id`,
  )
  return result.rows.map(toRecord)
}

export const updateNoteTemplate = async (
  user: string,
  id: string,
  fields: { name?: string; content?: string },
): Promise<NoteTemplateRecord | null> => {
  const result = await query(
    user,
    `UPDATE note_templates
        SET name = COALESCE($2, name), content = COALESCE($3, content), updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING ${COLUMNS}`,
    [id, fields.name ?? null, fields.content ?? null],
  )
  return result.rows.length === 0 ? null : toRecord(result.rows[0])
}

export const softDeleteNoteTemplate = async (user: string, id: string): Promise<boolean> => {
  const result = await query(
    user,
    `UPDATE note_templates SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  )
  return (result.rowCount ?? 0) > 0
}

export const purgeNoteTemplate = async (user: string, id: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM note_templates WHERE id = $1`, [id])
  return (result.rowCount ?? 0) > 0
}

/** Bring back a deleted template; a live one is answered as it is. */
export const restoreNoteTemplate = async (user: string, id: string): Promise<NoteTemplateRecord | null> => {
  const result = await query(
    user,
    `UPDATE note_templates SET deleted_at = NULL WHERE id = $1 RETURNING ${COLUMNS}`,
    [id],
  )
  return result.rows.length === 0 ? null : toRecord(result.rows[0])
}
