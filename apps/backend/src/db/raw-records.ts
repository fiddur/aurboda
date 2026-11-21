import format from 'pg-format'

import type { RawRecord } from './types.ts'

import { recordIngestBySource, recordUsage } from '../services/usage-recorder.ts'
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
  recordUsage(user, 'ingest', record.source)
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
  recordIngestBySource(user, deduped, (r) => r.source)
}

export interface ScrobbleRecord {
  recorded_at: Date
  track: string
  artist: string
  album: string
}

/** No time range bounds — used for re-tagging all scrobbles when rules change. */
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

export const hasRawRecord = async (
  user: string,
  source: string,
  recordType: string,
  externalId: string,
): Promise<boolean> => {
  const result = await query(
    user,
    `SELECT 1 FROM raw_records WHERE source = $1 AND record_type = $2 AND external_id = $3 LIMIT 1`,
    [source, recordType, externalId],
  )
  return result.rows.length > 0
}

/** The stored data of each found record of one type, by external id. */
export const getRawRecordsByExternalIds = async (
  user: string,
  source: string,
  recordType: string,
  externalIds: string[],
): Promise<Map<string, Record<string, unknown>>> => {
  if (externalIds.length === 0) return new Map()
  const result = await query<{ external_id: string; data: Record<string, unknown> }>(
    user,
    `SELECT external_id, data FROM raw_records
     WHERE source = $1 AND record_type = $2 AND external_id = ANY($3::text[])`,
    [source, recordType, externalIds],
  )
  return new Map(result.rows.map((row) => [row.external_id, row.data]))
}

const likePrefix = (prefix: string): string => `${prefix.replaceAll(/[\\%_]/g, (c) => `\\${c}`)}%`

/** The keys of the records whose type starts with the prefix, stored or updated since the time, oldest first. */
export const listRawRecordKeysReceivedSince = async (
  user: string,
  source: string,
  recordTypePrefix: string,
  since: Date,
): Promise<{ record_type: string; external_id: string }[]> => {
  const result = await query<{ record_type: string; external_id: string }>(
    user,
    `SELECT record_type, external_id FROM raw_records
     WHERE source = $1 AND record_type LIKE $2 AND received_at >= $3 AND external_id IS NOT NULL
     ORDER BY received_at, id`,
    [source, likePrefix(recordTypePrefix), since],
  )
  return result.rows
}

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

export interface StepRecord {
  start: Date
  end: Date
  count: number
  modified?: Date
}

const STEP_RECORD_LOOKBACK = '1 hour'

const validDate = (value: unknown): Date | undefined => {
  if (typeof value !== 'string' && !(value instanceof Date)) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const toStepRecord = (data: Record<string, unknown>): StepRecord | null => {
  const start = validDate(data.startTime)
  const end = validDate(data.endTime)
  const count = typeof data.count === 'string' ? Number(data.count) : data.count
  if (!start || !end || typeof count !== 'number' || !Number.isFinite(count)) return null
  const metadata = data.metadata as Record<string, unknown> | undefined
  const modified = validDate(metadata?.lastModifiedTime)
  return modified ? { count, end, modified, start } : { count, end, start }
}

/** The Health Connect step records one app wrote that start before `end` and at most an hour before `start`. */
export const getHealthConnectStepRecords = async (
  user: string,
  dataOrigin: string,
  start: Date,
  end: Date,
): Promise<StepRecord[]> => {
  const result = await query(
    user,
    `SELECT data
     FROM raw_records
     WHERE source = 'health_connect' AND record_type = 'StepsRecord'
       AND recorded_at >= $2::timestamptz - interval '${STEP_RECORD_LOOKBACK}' AND recorded_at < $3
       AND data->'metadata'->>'dataOrigin' = $1
     ORDER BY recorded_at ASC`,
    [dataOrigin, start, end],
  )
  return result.rows.flatMap((row) => {
    const record = toStepRecord(row.data as Record<string, unknown>)
    return record ? [record] : []
  })
}
