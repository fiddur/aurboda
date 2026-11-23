import type { UploadTarget } from '@aurboda/api-spec'
import type { QueryResultRow } from 'pg'

import { query } from './connection.ts'

export interface UploadUrlRecord {
  token_hash: string
  target: UploadTarget
  target_id: string | null
  created_at: Date
  expires_at: Date
  used_at: Date | null
}

export interface NewUploadUrl {
  token_hash: string
  target: UploadTarget
  target_id: string | null
  expires_at: Date
}

const COLUMNS = 'token_hash, target, target_id, created_at, expires_at, used_at'

const mapRow = (row: QueryResultRow): UploadUrlRecord => ({
  created_at: new Date(row.created_at),
  expires_at: new Date(row.expires_at),
  target: row.target,
  target_id: row.target_id ?? null,
  token_hash: row.token_hash,
  used_at: row.used_at ? new Date(row.used_at) : null,
})

/** Stores a minted URL, sweeping the rows that expired over a day ago. */
export const insertUploadUrl = async (user: string, url: NewUploadUrl): Promise<UploadUrlRecord> => {
  await query(user, `DELETE FROM upload_urls WHERE expires_at < NOW() - INTERVAL '1 day'`)
  const result = await query(
    user,
    `INSERT INTO upload_urls (token_hash, target, target_id, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLUMNS}`,
    [url.token_hash, url.target, url.target_id, url.expires_at],
  )
  return mapRow(result.rows[0])
}

/** The URL while it is unused and unexpired; reading it does not use it. */
export const findLiveUploadUrl = async (
  user: string,
  tokenHash: string,
): Promise<UploadUrlRecord | undefined> => {
  const result = await query(
    user,
    `SELECT ${COLUMNS} FROM upload_urls
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
    [tokenHash],
  )
  return result.rows[0] ? mapRow(result.rows[0]) : undefined
}

/** Uses the URL up, or answers undefined when another request already did or it expired meanwhile. */
export const spendUploadUrl = async (
  user: string,
  tokenHash: string,
): Promise<UploadUrlRecord | undefined> => {
  const result = await query(
    user,
    `UPDATE upload_urls SET used_at = NOW()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
     RETURNING ${COLUMNS}`,
    [tokenHash],
  )
  return result.rows[0] ? mapRow(result.rows[0]) : undefined
}
