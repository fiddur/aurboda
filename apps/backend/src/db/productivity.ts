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
    r.start_time,
    r.end_time,
    r.activity,
    r.category,
    r.productivity,
    r.duration_sec,
    r.is_mobile || false,
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
         duration_sec = EXCLUDED.duration_sec
       WHERE productivity.deleted_at IS NULL`,
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
    `SELECT id, source, start_time, end_time, activity, category, productivity, duration_sec, is_mobile
     FROM productivity
     WHERE start_time >= $1 AND start_time <= $2
       AND deleted_at IS NULL
     ORDER BY start_time`,
    [start, end],
  )

  return result.rows.map((row) => ({
    activity: row.activity,
    category: row.category,
    duration_sec: row.duration_sec,
    end_time: new Date(row.end_time),
    id: row.id,
    is_mobile: row.is_mobile,
    productivity: row.productivity,
    source: row.source,
    start_time: new Date(row.start_time),
  }))
}

export const deleteProductivityRecord = async (user: string, id: string): Promise<boolean> => {
  const result = await query(
    user,
    `UPDATE productivity SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  )

  return (result.rowCount ?? 0) > 0
}

export const restoreProductivityRecord = async (user: string, id: string): Promise<boolean> => {
  const result = await query(
    user,
    `UPDATE productivity SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL`,
    [id],
  )

  return (result.rowCount ?? 0) > 0
}
