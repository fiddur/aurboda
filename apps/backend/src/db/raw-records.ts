/**
 * Raw record storage for incoming health data.
 */
import { query } from './connection'
import type { RawRecord } from './types'

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

export interface ScrobbleRecord {
  recorded_at: Date
  track: string
  artist: string
  album: string
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
