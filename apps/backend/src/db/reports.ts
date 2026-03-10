/**
 * Reports CRUD operations.
 *
 * Reports group related lab measurements (InBody, blood panels, etc.) with entries.
 */
import format from 'pg-format'
import { query } from './connection'
import { mapReportEntryRow, mapReportRow } from './row-mappers'
import type { Report, ReportEntry } from './types'

const REPORT_COLUMNS = 'id, report_type, report_date, location, notes, created_at'
const ENTRY_COLUMNS =
  'id, report_id, metric, value, unit, method, confidence, reference_low, reference_high, flag'

interface InsertReportInput {
  report_type: string
  report_date: Date
  location?: string
  notes?: string
  entries: Array<{
    metric: string
    value: number
    unit: string
    method?: string
    confidence?: string
    reference_low?: number
    reference_high?: number
    flag?: string
  }>
}

/**
 * Insert a report with all its entries in a single operation.
 * Returns the full report with generated IDs.
 */
export const insertReport = async (user: string, input: InsertReportInput): Promise<Report> => {
  // Insert the report header
  const reportResult = await query(
    user,
    `INSERT INTO reports (report_type, report_date, location, notes)
     VALUES ($1, $2, $3, $4)
     RETURNING ${REPORT_COLUMNS}`,
    [input.report_type, input.report_date, input.location ?? null, input.notes ?? null],
  )

  const reportRow = reportResult.rows[0]
  const reportId = reportRow.id as string

  // Insert entries in bulk
  if (input.entries.length > 0) {
    const values = input.entries.map((e) => [
      reportId,
      e.metric,
      e.value,
      e.unit,
      e.method ?? null,
      e.confidence ?? null,
      e.reference_low ?? null,
      e.reference_high ?? null,
      e.flag ?? null,
    ])

    await query(
      user,
      format(
        `INSERT INTO report_entries (report_id, metric, value, unit, method, confidence, reference_low, reference_high, flag)
         VALUES %L`,
        values,
      ),
    )
  }

  // Fetch entries back to get generated IDs
  const entriesResult = await query(
    user,
    `SELECT ${ENTRY_COLUMNS} FROM report_entries WHERE report_id = $1 ORDER BY metric`,
    [reportId],
  )

  const entries = entriesResult.rows.map(mapReportEntryRow)
  return mapReportRow(reportRow, entries)
}

/**
 * Get a single report by ID with all its entries.
 */
export const getReportById = async (user: string, id: string): Promise<Report | null> => {
  const reportResult = await query(user, `SELECT ${REPORT_COLUMNS} FROM reports WHERE id = $1`, [id])

  if (reportResult.rows.length === 0) return null

  const entriesResult = await query(
    user,
    `SELECT ${ENTRY_COLUMNS} FROM report_entries WHERE report_id = $1 ORDER BY metric`,
    [id],
  )

  const entries = entriesResult.rows.map(mapReportEntryRow)
  return mapReportRow(reportResult.rows[0], entries)
}

interface QueryReportsFilter {
  report_type?: string
  start?: Date
  end?: Date
}

/**
 * Query reports with optional filters. Returns reports with their entries.
 */
export const getReports = async (user: string, filter: QueryReportsFilter): Promise<Report[]> => {
  let sql = `SELECT ${REPORT_COLUMNS} FROM reports WHERE 1=1`
  const params: unknown[] = []
  let paramIdx = 1

  if (filter.report_type) {
    sql += ` AND report_type = $${paramIdx++}`
    params.push(filter.report_type)
  }

  if (filter.start) {
    sql += ` AND report_date >= $${paramIdx++}`
    params.push(filter.start)
  }

  if (filter.end) {
    sql += ` AND report_date <= $${paramIdx++}`
    params.push(filter.end)
  }

  sql += ` ORDER BY report_date DESC`

  const reportResult = await query(user, sql, params)

  if (reportResult.rows.length === 0) return []

  // Fetch all entries for these reports in one query
  const reportIds = reportResult.rows.map((r) => r.id as string)
  const entriesResult = await query(
    user,
    format(
      `SELECT ${ENTRY_COLUMNS} FROM report_entries WHERE report_id IN (%L) ORDER BY report_id, metric`,
      reportIds,
    ),
  )

  // Group entries by report_id
  const entriesByReport = new Map<string, ReportEntry[]>()
  for (const row of entriesResult.rows) {
    const entry = mapReportEntryRow(row)
    const existing = entriesByReport.get(entry.report_id) ?? []
    existing.push(entry)
    entriesByReport.set(entry.report_id, existing)
  }

  return reportResult.rows.map((row) => mapReportRow(row, entriesByReport.get(row.id as string) ?? []))
}

/**
 * Delete a report and all its entries (CASCADE handles entries).
 * Returns true if the report was found and deleted.
 */
export const deleteReport = async (user: string, id: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM reports WHERE id = $1`, [id])
  return (result.rowCount ?? 0) > 0
}

/**
 * Get the metrics from a report's entries (needed for cleaning up write-through time_series data).
 */
export const getReportEntryMetrics = async (
  user: string,
  reportId: string,
): Promise<Array<{ metric: string; report_date: Date }>> => {
  const result = await query(
    user,
    `SELECT re.metric, r.report_date
     FROM report_entries re
     JOIN reports r ON r.id = re.report_id
     WHERE re.report_id = $1`,
    [reportId],
  )

  return result.rows.map((row) => ({
    metric: row.metric as string,
    report_date: new Date(row.report_date),
  }))
}

/**
 * Get the latest value for a metric from time_series, regardless of age.
 */
export const getLatestMetricValue = async (
  user: string,
  metric: string,
): Promise<{ time: Date; value: number; unit: string; source: string } | null> => {
  const result = await query(
    user,
    `SELECT time, value, unit, source
     FROM time_series
     WHERE metric = $1
     ORDER BY time DESC
     LIMIT 1`,
    [metric],
  )

  if (result.rows.length === 0) return null

  const row = result.rows[0]
  return {
    source: row.source as string,
    time: new Date(row.time),
    unit: row.unit as string,
    value: row.value as number,
  }
}
