/**
 * Raw record storage for incoming health data.
 */
import format from 'pg-format'

import type { RawRecord } from './types.ts'

import { query } from './connection.ts'
import { dedupeLastWins } from './dedupe.ts'

export const insertRawRecord = async (user: string, record: RawRecord) => {
  await query(
    user,
    `INSERT INTO raw_records (source, record_type, external_id, recorded_at, data)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (source, record_type, external_id) DO UPDATE SET
       data = EXCLUDED.data,
       received_at = NOW()`,
    [record.source, record.record_type, record.external_id, record.recorded_at, record.data],
  )
}

export const insertRawRecords = async (user: string, records: RawRecord[]) => {
  if (records.length === 0) return

  // Collapse duplicate (source, record_type, external_id) within the batch so the
  // upsert never tries to touch the same row twice (21000). Rows with a NULL
  // external_id are distinct in the unique index, so they never collide — keep
  // them all. Mirrors the dedupe insertActivities does (#770).
  const deduped = dedupeLastWins(records, (r) =>
    r.external_id == null ? null : `${r.source}|${r.record_type}|${r.external_id}`,
  )

  const values = deduped.map((r) => [r.source, r.record_type, r.external_id, r.recorded_at, r.data])

  await query(
    user,
    format(
      `INSERT INTO raw_records (source, record_type, external_id, recorded_at, data)
       VALUES %L
       ON CONFLICT (source, record_type, external_id) DO UPDATE SET
         data = EXCLUDED.data,
         received_at = NOW()`,
      values,
    ),
  )
}

export interface ScrobbleRecord {
  recorded_at: Date
  track: string
  artist: string
  album: string
}

/**
 * Query all Last.fm scrobbles from raw_records (no time range bounds).
 * Used for re-tagging all scrobbles when rules change.
 */
export const getAllScrobbles = async (user: string): Promise<ScrobbleRecord[]> => {
  const result = await query(
    user,
    `SELECT recorded_at, data
     FROM raw_records
     WHERE source = 'lastfm' AND record_type = 'scrobble'
     ORDER BY recorded_at ASC`,
    [],
  )

  return result.rows.map((row) => ({
    album: (row.data.album as string) ?? '',
    artist: (row.data.artist as string) ?? '',
    recorded_at: row.recorded_at as Date,
    track: (row.data.track as string) ?? '',
  }))
}

export interface RawRecordRow {
  id: string
  source: string
  record_type: string
  external_id: string | null
  recorded_at: Date
  received_at: Date
  data: Record<string, unknown>
}

export interface QueryRawRecordsParams {
  source?: string
  record_type?: string
  external_id?: string
  start?: Date
  end?: Date
  limit?: number
  offset?: number
}

/**
 * Query raw records with optional filters. Ordered by recorded_at DESC.
 */
export const queryRawRecords = async (
  user: string,
  params: QueryRawRecordsParams = {},
): Promise<{ rows: RawRecordRow[]; total: number }> => {
  const conditions: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  if (params.source) {
    conditions.push(`source = $${paramIndex++}`)
    values.push(params.source)
  }
  if (params.record_type) {
    conditions.push(`record_type = $${paramIndex++}`)
    values.push(params.record_type)
  }
  if (params.external_id) {
    conditions.push(`external_id = $${paramIndex++}`)
    values.push(params.external_id)
  }
  if (params.start) {
    conditions.push(`recorded_at >= $${paramIndex++}`)
    values.push(params.start)
  }
  if (params.end) {
    conditions.push(`recorded_at < $${paramIndex++}`)
    values.push(params.end)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = params.limit ?? 50
  const offset = params.offset ?? 0

  const countResult = await query<{ total: number }>(
    user,
    `SELECT COUNT(*)::int AS total FROM raw_records ${where}`,
    values,
  )
  const total = countResult.rows[0]?.total ?? 0

  const dataResult = await query<RawRecordRow>(
    user,
    `SELECT id, source, record_type, external_id, recorded_at, received_at, data
       FROM raw_records ${where}
       ORDER BY recorded_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...values, limit, offset],
  )

  return { rows: dataResult.rows, total }
}

/**
 * Query Last.fm scrobbles from raw_records within a time range.
 */
export const getScrobbles = async (user: string, start: Date, end: Date): Promise<ScrobbleRecord[]> => {
  const result = await query(
    user,
    `SELECT recorded_at, data
     FROM raw_records
     WHERE source = 'lastfm' AND record_type = 'scrobble'
       AND recorded_at >= $1 AND recorded_at < $2
     ORDER BY recorded_at ASC`,
    [start, end],
  )

  return result.rows.map((row) => ({
    album: (row.data.album as string) ?? '',
    artist: (row.data.artist as string) ?? '',
    recorded_at: row.recorded_at as Date,
    track: (row.data.track as string) ?? '',
  }))
}
