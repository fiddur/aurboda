/**
 * Uploaded icons CRUD operations.
 */
import { query } from './connection.ts'

export const insertIcon = async (user: string, contentType: string, data: Buffer): Promise<string> => {
  const result = await query(
    user,
    `INSERT INTO uploaded_icons (content_type, data) VALUES ($1, $2) RETURNING id`,
    [contentType, data],
  )
  return result.rows[0].id as string
}

export const getIcon = async (
  user: string,
  id: string,
): Promise<{ content_type: string; data: Buffer } | undefined> => {
  const result = await query(user, `SELECT content_type, data FROM uploaded_icons WHERE id = $1`, [id])
  if (result.rows.length === 0) return undefined
  return { content_type: result.rows[0].content_type as string, data: result.rows[0].data as Buffer }
}

export const deleteIcon = async (user: string, id: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM uploaded_icons WHERE id = $1`, [id])
  return (result.rowCount ?? 0) > 0
}
