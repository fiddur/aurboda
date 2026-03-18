/**
 * Productivity data storage and retrieval (RescueTime, ActivityWatch, etc.)
 */
import format from 'pg-format'

import type { ProductivityRecord } from './types.ts'

import { query } from './connection.ts'

/**
 * Convert a JS string array to a PostgreSQL array literal.
 *
 * pg-format's %L treats JS arrays as sub-tuples for multi-row VALUES,
 * so we must serialize TEXT[] columns ourselves before formatting.
 *
 * Examples:
 *   ['TV']                       → '{TV}'
 *   ['Work', 'Programming']      → '{Work,Programming}'
 *   ['has "quotes"', 'a,comma']  → '{"has \\"quotes\\"","a,comma"}'
 *   null / undefined              → null
 */
export const toPgArray = (arr: string[] | null | undefined): string | null => {
  if (arr == null) return null

  const escaped = arr.map((s) => {
    // Quote the element if it contains special chars, is empty, or looks like a keyword
    if (s === '' || /[{},"\\\s]/.test(s) || s.toUpperCase() === 'NULL') {
      return '"' + s.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"'
    }
    return s
  })

  return '{' + escaped.join(',') + '}'
}

export const insertProductivity = async (user: string, records: ProductivityRecord[]) => {
  if (records.length === 0) return

  const values = records.map((r) => [
    r.source || 'rescuetime',
    r.start_time,
    r.end_time,
    r.activity,
    r.title || null,
    r.category,
    r.productivity,
    r.duration_sec,
    r.is_mobile || false,
    r.device_name ?? '',
    toPgArray(r.resolved_category) ?? null,
  ])

  await query(
    user,
    format(
      `INSERT INTO productivity (source, start_time, end_time, activity, title, category, productivity, duration_sec, is_mobile, device_name, resolved_category)
       VALUES %L
       ON CONFLICT (source, start_time, activity, device_name) DO UPDATE SET
         end_time = EXCLUDED.end_time,
         title = EXCLUDED.title,
         category = EXCLUDED.category,
         productivity = EXCLUDED.productivity,
         duration_sec = EXCLUDED.duration_sec,
         resolved_category = EXCLUDED.resolved_category
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
    `SELECT id, source, start_time, end_time, activity, title, category, productivity, duration_sec, is_mobile, device_name, resolved_category
     FROM productivity
     WHERE start_time >= $1 AND start_time <= $2
       AND deleted_at IS NULL
     ORDER BY start_time`,
    [start, end],
  )

  return result.rows.map((row) => ({
    activity: row.activity,
    category: row.category,
    device_name: row.device_name || undefined,
    duration_sec: row.duration_sec,
    end_time: new Date(row.end_time),
    id: row.id,
    is_mobile: row.is_mobile,
    productivity: row.productivity,
    resolved_category: row.resolved_category || undefined,
    source: row.source,
    start_time: new Date(row.start_time),
    title: row.title || undefined,
  }))
}

export const getProductivityById = async (user: string, id: string): Promise<ProductivityRecord | null> => {
  const result = await query(
    user,
    `SELECT id, source, start_time, end_time, activity, title, category, productivity, duration_sec, is_mobile, device_name, resolved_category
     FROM productivity
     WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  )

  if (result.rows.length === 0) return null
  const row = result.rows[0]
  return {
    activity: row.activity,
    category: row.category,
    device_name: row.device_name || undefined,
    duration_sec: row.duration_sec,
    end_time: new Date(row.end_time),
    id: row.id,
    is_mobile: row.is_mobile,
    productivity: row.productivity,
    resolved_category: row.resolved_category || undefined,
    source: row.source,
    start_time: new Date(row.start_time),
    title: row.title || undefined,
  }
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

/**
 * Batch update resolved_category on productivity records.
 * Used after category rules change to recategorize all records.
 */
export const batchUpdateResolvedCategory = async (
  user: string,
  updates: Array<{ id: string; resolved_category: string[] | null }>,
) => {
  if (updates.length === 0) return

  // Use a CTE with VALUES for efficient batch update
  // Convert JS arrays to PostgreSQL array literals; pg-format %L treats
  // JS arrays as sub-tuples, which produces invalid TEXT[] values.
  const values = updates.map((u) => [u.id, toPgArray(u.resolved_category)])

  await query(
    user,
    format(
      `UPDATE productivity AS p
       SET resolved_category = v.resolved_category::TEXT[]
       FROM (VALUES %L) AS v(id, resolved_category)
       WHERE p.id = v.id::UUID`,
      values,
    ),
  )
}

/**
 * Get distinct app/title combinations with their resolved categories and usage stats.
 *
 * Groups by (activity, title, resolved_category) so that e.g. "firefox" opened to
 * a Netflix page appears separately from "firefox" opened to GitHub — making it
 * clear why a browser app shows up under a particular category.
 *
 * Useful for category management UI: shows what's matched and what isn't, with
 * enough context to understand why.
 */
export const getDistinctApps = async (
  user: string,
): Promise<
  Array<{
    activity: string
    title?: string
    resolved_category?: string[]
    total_duration_sec: number
    record_count: number
  }>
> => {
  const result = await query(
    user,
    `SELECT activity, title, resolved_category,
            SUM(duration_sec)::int AS total_duration_sec,
            COUNT(*)::int AS record_count
     FROM productivity
     WHERE deleted_at IS NULL
     GROUP BY activity, title, resolved_category
     ORDER BY SUM(duration_sec) DESC`,
  )

  return result.rows.map((row) => ({
    activity: row.activity,
    record_count: row.record_count,
    resolved_category: row.resolved_category || undefined,
    title: row.title || undefined,
    total_duration_sec: row.total_duration_sec,
  }))
}

/**
 * Get all non-deleted productivity records (for recategorization).
 * Returns only id, activity, and title to minimize memory usage.
 */
export const getAllProductivityForCategorization = async (
  user: string,
): Promise<Array<{ id: string; activity: string; title?: string }>> => {
  const result = await query(user, `SELECT id, activity, title FROM productivity WHERE deleted_at IS NULL`)

  return result.rows.map((row) => ({
    activity: row.activity,
    id: row.id,
    title: row.title || undefined,
  }))
}
