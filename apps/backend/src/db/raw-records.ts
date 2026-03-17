/**
 * Raw record storage for incoming health data.
 */
import format from 'pg-format'

import type { RawRecord } from './types.ts'

import { query } from './connection.ts'

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

  const values = records.map((r) => [r.source, r.record_type, r.external_id, r.recorded_at, r.data])

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
