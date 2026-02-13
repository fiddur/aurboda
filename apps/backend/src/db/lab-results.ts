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
      result.testDate,
      result.testName,
      result.testCategory,
      result.value,
      result.unit,
      result.referenceLow,
      result.referenceHigh,
      result.flag,
      result.labName,
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
    labName: row.lab_name,
    notes: row.notes,
    referenceHigh: row.reference_high,
    referenceLow: row.reference_low,
    testCategory: row.test_category,
    testDate: new Date(row.test_date),
    testName: row.test_name,
    unit: row.unit,
    value: row.value,
  }))
}
