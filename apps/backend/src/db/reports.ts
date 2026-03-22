/**
 * Reports CRUD operations.
 *
 * Reports group related lab measurements (InBody, blood panels, etc.) with entries.
 * Entry values/units live in the time_series table (source='lab_report');
 * report_entries stores only lab-specific metadata (reference ranges, flags, etc.).
 */
import format from 'pg-format'

import type { Report, ReportEntry } from './types.ts'

import { query } from './connection.ts'
import { mapReportEntryRow, mapReportRow } from './row-mappers.ts'

const REPORT_COLUMNS = 'id, report_type, report_date, location, notes, created_at'

/** Columns for reading entries — joins with time_series to get value/unit. */
const ENTRY_SELECT = `re.id, re.report_id, re.metric, re.method, re.confidence,
       re.reference_low, re.reference_high, re.flag,
       ts.value, ts.unit`

/** Columns for inserting entries — metadata only, no value/unit. */
const ENTRY_INSERT_COLUMNS = 'report_id, metric, method, confidence, reference_low, reference_high, flag'

interface InsertReportInput {
  report_type: string
  report_date: Date
  location?: string
  notes?: string
  entries: Array<{
    metric: string
    method?: string
    confidence?: string
    reference_low?: number
    reference_high?: number
    flag?: string
  }>
}

/** Fetch entries for a single report, joining with time_series for value/unit. */
const fetchEntriesForReport = async (
  user: string,
  reportId: string,
  reportDate: Date,
): Promise<ReportEntry[]> => {
  const entriesResult = await query(
    user,
    `SELECT ${ENTRY_SELECT}
     FROM report_entries re
     LEFT JOIN time_series ts
       ON ts.metric = re.metric AND ts.time = $2 AND ts.source = 'lab_report'
     WHERE re.report_id = $1
     ORDER BY re.metric`,
    [reportId, reportDate],
  )
  return entriesResult.rows.map(mapReportEntryRow)
}

/** Bulk-insert entry metadata (no value/unit — those go to time_series). */
const insertEntryMetadata = async (
  user: string,
  reportId: string,
  entries: InsertReportInput['entries'],
): Promise<void> => {
  if (entries.length === 0) return

  const values = entries.map((e) => [
    reportId,
    e.metric,
    e.method ?? null,
    e.confidence ?? null,
    e.reference_low ?? null,
    e.reference_high ?? null,
    e.flag ?? null,
  ])

  await query(
    user,
    format(
      `INSERT INTO report_entries (${ENTRY_INSERT_COLUMNS})
       VALUES %L`,
      values,
    ),
  )
}

/**
 * Insert a report with all its entries in a single operation.
 * Returns the full report with generated IDs.
 * Note: caller is responsible for inserting corresponding time_series data.
 */
export const insertReport = async (user: string, input: InsertReportInput): Promise<Report> => {
  const reportResult = await query(
    user,
    `INSERT INTO reports (report_type, report_date, location, notes)
     VALUES ($1, $2, $3, $4)
     RETURNING ${REPORT_COLUMNS}`,
    [input.report_type, input.report_date, input.location ?? null, input.notes ?? null],
  )

  const reportRow = reportResult.rows[0]
  const reportId = reportRow.id as string

  await insertEntryMetadata(user, reportId, input.entries)

  const entries = await fetchEntriesForReport(user, reportId, input.report_date)
  return mapReportRow(reportRow, entries)
}

/**
 * Get a single report by ID with all its entries.
 */
export const getReportById = async (user: string, id: string): Promise<Report | null> => {
  const reportResult = await query(user, `SELECT ${REPORT_COLUMNS} FROM reports WHERE id = $1`, [id])

  if (reportResult.rows.length === 0) return null

  const reportRow = reportResult.rows[0]
  const reportDate = new Date(reportRow.report_date)
  const entries = await fetchEntriesForReport(user, id, reportDate)
  return mapReportRow(reportRow, entries)
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

  // Fetch all entries for these reports in one query, joining with time_series
  const reportIds = reportResult.rows.map((r) => r.id as string)

  const entriesResult = await query(
    user,
    format(
      `SELECT ${ENTRY_SELECT}
       FROM report_entries re
       LEFT JOIN LATERAL (
         SELECT ts.value, ts.unit
         FROM time_series ts
         JOIN reports r ON r.id = re.report_id
         WHERE ts.metric = re.metric AND ts.time = r.report_date AND ts.source = 'lab_report'
         LIMIT 1
       ) ts ON true
       WHERE re.report_id IN (%L)
       ORDER BY re.report_id, re.metric`,
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
 * Get the metrics from a report's entries (needed for cleaning up time_series data).
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

// ============================================================================
// Update Report
// ============================================================================

interface UpdateReportInput {
  report_type?: string
  report_date?: Date
  location?: string | null
  notes?: string | null
  entries?: Array<{
    metric: string
    method?: string
    confidence?: string
    reference_low?: number
    reference_high?: number
    flag?: string
  }>
}

/**
 * Update a report's metadata and/or replace its entries.
 * Returns the updated report, or null if not found.
 * Note: caller is responsible for updating corresponding time_series data.
 */
export const updateReport = async (
  user: string,
  id: string,
  input: UpdateReportInput,
): Promise<Report | null> => {
  // Build dynamic UPDATE for metadata fields
  const setClauses: string[] = []
  const params: unknown[] = []
  let paramIdx = 1

  if (input.report_type !== undefined) {
    setClauses.push(`report_type = $${paramIdx++}`)
    params.push(input.report_type)
  }
  if (input.report_date !== undefined) {
    setClauses.push(`report_date = $${paramIdx++}`)
    params.push(input.report_date)
  }
  if (input.location !== undefined) {
    setClauses.push(`location = $${paramIdx++}`)
    params.push(input.location)
  }
  if (input.notes !== undefined) {
    setClauses.push(`notes = $${paramIdx++}`)
    params.push(input.notes)
  }

  // Update metadata if any fields changed
  if (setClauses.length > 0) {
    const updateResult = await query(
      user,
      `UPDATE reports SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING ${REPORT_COLUMNS}`,
      [...params, id],
    )
    if (updateResult.rows.length === 0) return null
  }

  // Replace entries if provided
  if (input.entries !== undefined) {
    // Verify report exists if we didn't do an update above
    if (setClauses.length === 0) {
      const exists = await query(user, `SELECT id FROM reports WHERE id = $1`, [id])
      if (exists.rows.length === 0) return null
    }

    await query(user, `DELETE FROM report_entries WHERE report_id = $1`, [id])
    await insertEntryMetadata(user, id, input.entries)
  }

  // Return the full updated report
  return getReportById(user, id)
}
