/**
 * Reports service — CRUD operations for structured lab reports.
 *
 * Reports group related measurements (InBody scans, blood panels, etc.).
 * Entry values/units are stored in time_series (source='lab_report') as the single source of truth.
 * report_entries stores only lab-specific metadata (reference ranges, flags, etc.).
 */

import type { Confidence, ReportFlag } from '@aurboda/api-spec'

import {
  deleteReport as dbDeleteReport,
  getLatestMetricValue as dbGetLatestMetricValue,
  getReportById as dbGetReportById,
  getReports as dbGetReports,
  insertReport as dbInsertReport,
  updateReport as dbUpdateReport,
  getReportEntryMetrics,
  insertTimeSeries,
  query,
  updateNoteTimesForEntity,
  type Report,
  type ReportEntry,
} from '../db/index.ts'

// ============================================================================
// Types
// ============================================================================

interface AddReportEntryInput {
  metric: string
  value: number
  unit: string
  method?: string
  confidence?: Confidence
  reference_low?: number
  reference_high?: number
  flag?: ReportFlag
}

export interface AddReportInput {
  report_type: string
  date: string // ISO 8601
  location?: string
  notes?: string
  entries: AddReportEntryInput[]
}

export interface UpdateReportInput {
  report_type?: string
  date?: string // ISO 8601
  location?: string | null
  notes?: string | null
  entries?: AddReportEntryInput[]
}

interface ReportEntryResponse {
  id: string
  metric: string
  value: number
  unit: string
  method?: string
  confidence?: Confidence
  reference_low?: number
  reference_high?: number
  flag?: ReportFlag
}

interface ReportResponse {
  id: string
  report_type: string
  date: string
  location?: string
  notes?: string
  created_at: string
  entries: ReportEntryResponse[]
}

interface ReportResult {
  success: boolean
  data?: ReportResponse
  error?: string
}

interface ReportsResult {
  success: boolean
  data?: ReportResponse[]
  error?: string
}

interface LatestMetricResult {
  success: boolean
  metric?: string
  value?: number
  unit?: string
  source?: string
  time?: string
  error?: string
}

// ============================================================================
// Flag Auto-derivation
// ============================================================================

/**
 * Derive a flag from value vs reference range if not explicitly set.
 */
const deriveFlag = (value: number, referenceLow?: number, referenceHigh?: number): ReportFlag | undefined => {
  if (referenceLow === undefined && referenceHigh === undefined) return undefined

  if (referenceLow !== undefined && value < referenceLow) {
    // Use a crude heuristic for critical: more than 50% below lower bound
    const criticalThreshold = referenceLow - referenceLow * 0.5
    return value < criticalThreshold ? 'critical_low' : 'low'
  }

  if (referenceHigh !== undefined && value > referenceHigh) {
    // More than 50% above upper bound
    const criticalThreshold = referenceHigh + referenceHigh * 0.5
    return value > criticalThreshold ? 'critical_high' : 'high'
  }

  return 'normal'
}

// ============================================================================
// Helpers
// ============================================================================

/** Extract metadata-only entries (no value/unit) for the DB layer. */
const toDbEntries = (entries: AddReportEntryInput[]) =>
  entries.map((e) => ({
    confidence: e.confidence,
    flag: e.flag,
    method: e.method,
    metric: e.metric,
    reference_high: e.reference_high,
    reference_low: e.reference_low,
  }))

/** Build time_series points from entries + date. */
const toTimeSeriesPoints = (entries: AddReportEntryInput[], time: Date) =>
  entries.map((entry) => ({
    metric: entry.metric,
    source: 'lab_report' as const,
    time,
    unit: entry.unit,
    value: entry.value,
  }))

/** Clean up all lab_report time_series entries for a given set of metrics/dates. */
const cleanupTimeSeries = async (
  user: string,
  entryMetrics: Array<{ metric: string; report_date: Date }>,
): Promise<void> => {
  for (const { metric, report_date } of entryMetrics) {
    await query(user, `DELETE FROM time_series WHERE metric = $1 AND time = $2 AND source = 'lab_report'`, [
      metric,
      report_date,
    ])
  }
}

// ============================================================================
// Formatters
// ============================================================================

const formatEntry = (entry: ReportEntry): ReportEntryResponse => ({
  confidence: entry.confidence,
  flag: entry.flag,
  id: entry.id,
  method: entry.method,
  metric: entry.metric,
  reference_high: entry.reference_high,
  reference_low: entry.reference_low,
  unit: entry.unit,
  value: entry.value,
})

const formatReport = (report: Report): ReportResponse => ({
  created_at: report.created_at.toISOString(),
  date: report.report_date.toISOString(),
  entries: report.entries.map(formatEntry),
  id: report.id,
  location: report.location,
  notes: report.notes,
  report_type: report.report_type,
})

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Create a new report with entries.
 * Auto-derives flags from reference ranges if not set.
 * Writes entry values to time_series with source 'lab_report'.
 */
export async function addReport(user: string, input: AddReportInput): Promise<ReportResult> {
  const reportDate = new Date(input.date)

  // Process entries: auto-derive flags
  const entries = input.entries.map((e) => ({
    ...e,
    flag: e.flag ?? deriveFlag(e.value, e.reference_low, e.reference_high),
  }))

  // Write values to time_series FIRST (single source of truth for metric values).
  // Must happen before insertReport because the DB layer joins with time_series on read.
  const timeSeriesPoints = toTimeSeriesPoints(entries, reportDate)
  if (timeSeriesPoints.length > 0) {
    await insertTimeSeries(user, timeSeriesPoints)
  }

  // Insert report + entry metadata (no value/unit — values come from time_series join)
  const report = await dbInsertReport(user, {
    entries: toDbEntries(entries),
    location: input.location,
    notes: input.notes,
    report_date: reportDate,
    report_type: input.report_type,
  })

  return { data: formatReport(report), success: true }
}

/**
 * Get a single report by ID.
 */
export async function getReport(user: string, id: string): Promise<ReportResult> {
  const report = await dbGetReportById(user, id)
  if (!report) {
    return { error: 'Report not found', success: false }
  }
  return { data: formatReport(report), success: true }
}

/**
 * Query reports with optional filters.
 */
export async function queryReports(
  user: string,
  filters: { report_type?: string; start?: string; end?: string },
): Promise<ReportsResult> {
  const reports = await dbGetReports(user, {
    end: filters.end ? new Date(filters.end) : undefined,
    report_type: filters.report_type,
    start: filters.start ? new Date(filters.start) : undefined,
  })

  return { data: reports.map(formatReport), success: true }
}

/**
 * Update a report's metadata and/or entries.
 * When entries are provided, they fully replace existing entries.
 * Maintains time_series consistency (cleanup old, insert new).
 */
export async function updateReport(
  user: string,
  id: string,
  input: UpdateReportInput,
): Promise<ReportResult> {
  // 1. Fetch existing report
  const existing = await dbGetReportById(user, id)
  if (!existing) {
    return { error: 'Report not found', success: false }
  }

  // 2. Get old entry metrics for time_series cleanup
  const oldEntryMetrics = await getReportEntryMetrics(user, id)

  // 3. Process new entries if provided: auto-derive flags
  const processedEntries = input.entries?.map((e) => ({
    ...e,
    flag: e.flag ?? deriveFlag(e.value, e.reference_low, e.reference_high),
  }))

  // 4. Time_series maintenance: clean old, insert new.
  // Must happen BEFORE dbUpdateReport because it joins with time_series on read.
  await cleanupTimeSeries(user, oldEntryMetrics)

  const newDate = input.date ? new Date(input.date) : existing.report_date
  const currentEntries =
    processedEntries ??
    input.entries ??
    existing.entries.map((e) => ({
      metric: e.metric,
      unit: e.unit,
      value: e.value,
    }))
  const timeSeriesPoints = toTimeSeriesPoints(currentEntries as AddReportEntryInput[], newDate)
  if (timeSeriesPoints.length > 0) {
    await insertTimeSeries(user, timeSeriesPoints)
  }

  // 5. Build DB update input (entries without value/unit)
  const dbInput: Parameters<typeof dbUpdateReport>[2] = {}
  if (input.report_type !== undefined) dbInput.report_type = input.report_type
  if (input.date !== undefined) dbInput.report_date = new Date(input.date)
  if (input.location !== undefined) dbInput.location = input.location
  if (input.notes !== undefined) dbInput.notes = input.notes
  if (processedEntries !== undefined) dbInput.entries = toDbEntries(processedEntries)

  const updated = await dbUpdateReport(user, id, dbInput)
  if (!updated) {
    return { error: 'Report not found', success: false }
  }

  // 6. Sync note times if date changed
  if (input.date && new Date(input.date).getTime() !== existing.report_date.getTime()) {
    await updateNoteTimesForEntity(user, 'report', id, new Date(input.date), undefined)
  }

  return { data: formatReport(updated), success: true }
}

/**
 * Delete a report and its time_series metrics.
 */
export async function deleteReportById(
  user: string,
  id: string,
): Promise<{ success: boolean; error?: string }> {
  // First, get the entry metrics so we can clean up time_series
  const entryMetrics = await getReportEntryMetrics(user, id)

  if (entryMetrics.length === 0) {
    // Report might not exist or has no entries — try deleting anyway
    const deleted = await dbDeleteReport(user, id)
    if (!deleted) {
      return { error: 'Report not found', success: false }
    }
    return { success: true }
  }

  // Delete the report (CASCADE deletes entries)
  const deleted = await dbDeleteReport(user, id)
  if (!deleted) {
    return { error: 'Report not found', success: false }
  }

  // Clean up time_series data
  await cleanupTimeSeries(user, entryMetrics)

  return { success: true }
}

/**
 * Get the latest value for a metric, regardless of age.
 * Useful for lab data that may be months old.
 */
export async function getLatestMetric(user: string, metric: string): Promise<LatestMetricResult> {
  const result = await dbGetLatestMetricValue(user, metric)

  if (!result) {
    return { error: `No data found for metric "${metric}"`, metric, success: false }
  }

  return {
    metric,
    source: result.source,
    success: true,
    time: result.time.toISOString(),
    unit: result.unit,
    value: result.value,
  }
}
