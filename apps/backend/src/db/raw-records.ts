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
