/**
 * Lab results storage and retrieval.
 */
import { query } from './connection'
import type { LabResult } from './types'

export const insertLabResult = async (user: string, result: LabResult) => {
  await query(
    user,
    `INSERT INTO lab_results (test_date, test_name, test_category, value, unit, reference_low, reference_high, flag, lab_name, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      result.test_date,
      result.test_name,
      result.test_category,
      result.value,
      result.unit,
      result.reference_low,
      result.reference_high,
      result.flag,
      result.lab_name,
      result.notes,
    ],
  )
}

export const getLabResults = async (
  user: string,
  start: Date,
  end: Date,
  testCategory?: string,
): Promise<LabResult[]> => {
  let sql = `SELECT * FROM lab_results WHERE test_date >= $1 AND test_date <= $2`
  const params: unknown[] = [start, end]

  if (testCategory) {
    sql += ` AND test_category = $3`
    params.push(testCategory)
  }

  sql += ` ORDER BY test_date DESC, test_name`

  const result = await query(user, sql, params)

  return result.rows.map((row) => ({
    flag: row.flag,
    id: row.id,
    lab_name: row.lab_name,
    notes: row.notes,
    reference_high: row.reference_high,
    reference_low: row.reference_low,
    test_category: row.test_category,
    test_date: new Date(row.test_date),
    test_name: row.test_name,
    unit: row.unit,
    value: row.value,
  }))
}
