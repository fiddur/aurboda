import { query } from './connection.ts'

export interface FeedImageRecord {
  id: string
  content_type: string
  width: number
  height: number
  byte_size: number
  created_at: Date
}

export interface NewFeedImage {
  content_type: string
  data: Buffer
  width: number
  height: number
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isFeedImageId = (id: string): boolean => UUID_PATTERN.test(id)

const RECORD_COLUMNS = 'id, content_type, width, height, byte_size, created_at'

const toRecord = (row: Record<string, unknown>): FeedImageRecord => ({
  byte_size: row.byte_size as number,
  content_type: row.content_type as string,
  created_at: row.created_at as Date,
  height: row.height as number,
  id: row.id as string,
  width: row.width as number,
})

export const insertFeedImage = async (user: string, image: NewFeedImage): Promise<FeedImageRecord> => {
  const result = await query(
    user,
    `INSERT INTO feed_image (content_type, data, width, height, byte_size)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${RECORD_COLUMNS}`,
    [image.content_type, image.data, image.width, image.height, image.data.length],
  )
  return toRecord(result.rows[0])
}

export const getFeedImage = async (
  user: string,
  id: string,
): Promise<{ content_type: string; data: Buffer } | undefined> => {
  if (!isFeedImageId(id)) return undefined
  const result = await query(user, `SELECT content_type, data FROM feed_image WHERE id = $1`, [id])
  if (result.rows.length === 0) return undefined
  return { content_type: result.rows[0].content_type as string, data: result.rows[0].data as Buffer }
}

export const listFeedImages = async (user: string): Promise<FeedImageRecord[]> => {
  const result = await query(user, `SELECT ${RECORD_COLUMNS} FROM feed_image ORDER BY created_at DESC, id`)
  return result.rows.map(toRecord)
}

export const countFeedImages = async (user: string): Promise<number> => {
  const result = await query(user, `SELECT COUNT(*)::int AS count FROM feed_image`)
  return result.rows[0].count as number
}

export const deleteFeedImage = async (user: string, id: string): Promise<boolean> => {
  if (!isFeedImageId(id)) return false
  const result = await query(user, `DELETE FROM feed_image WHERE id = $1`, [id])
  return (result.rowCount ?? 0) > 0
}
