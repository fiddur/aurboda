/**
 * RescueTime productivity data storage and retrieval.
 */
import format from 'pg-format'
import { query } from './connection'
import type { ProductivityRecord } from './types'

export const insertProductivity = async (user: string, records: ProductivityRecord[]) => {
  if (records.length === 0) return

  const values = records.map((r) => [
    r.source || 'rescuetime',
    r.startTime,
    r.endTime,
    r.activity,
    r.category,
    r.productivity,
    r.durationSec,
    r.isMobile || false,
  ])

  await query(
    user,
    format(
      `INSERT INTO productivity (source, start_time, end_time, activity, category, productivity, duration_sec, is_mobile)
       VALUES %L
       ON CONFLICT (source, start_time, activity) DO UPDATE SET
         end_time = EXCLUDED.end_time,
         category = EXCLUDED.category,
         productivity = EXCLUDED.productivity,
         duration_sec = EXCLUDED.duration_sec`,
      values,
    ),
  )
}

export const getProductivity = async (
  user: string,
  start: Date,
  end: Date,
): Promise<ProductivityRecord[]> => {
  const result = await query(
    user,
    `SELECT source, start_time, end_time, activity, category, productivity, duration_sec, is_mobile
     FROM productivity
     WHERE start_time >= $1 AND start_time <= $2
     ORDER BY start_time`,
    [start, end],
  )

  return result.rows.map((row) => ({
    activity: row.activity,
    category: row.category,
    durationSec: row.duration_sec,
    endTime: new Date(row.end_time),
    isMobile: row.is_mobile,
    productivity: row.productivity,
    source: row.source,
    startTime: new Date(row.start_time),
  }))
}
