/**
 * Reports service — CRUD operations for structured lab reports.
 *
 * Reports group related measurements (InBody scans, blood panels, etc.)
 * and write through to the time_series table for metric queries.
 */

import type { Confidence, ReportFlag } from '@aurboda/api-spec'
import {
  deleteReport as dbDeleteReport,
  getLatestMetricValue as dbGetLatestMetricValue,
  getReportById as dbGetReportById,
  getReports as dbGetReports,
  insertReport as dbInsertReport,
  getReportEntryMetrics,
  insertTimeSeries,
  query,
  type Report,
  type ReportEntry,
} from '../db'

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
 * Writes through each entry to time_series with source 'lab_report'.
 */
export async function addReport(user: string, input: AddReportInput): Promise<ReportResult> {
  const reportDate = new Date(input.date)

  // Process entries: auto-derive flags
  const entries = input.entries.map((e) => ({
    ...e,
    flag: e.flag ?? deriveFlag(e.value, e.reference_low, e.reference_high),
  }))

  // Insert report + entries
  const report = await dbInsertReport(user, {
    entries,
    location: input.location,
    notes: input.notes,
    report_date: reportDate,
    report_type: input.report_type,
  })

  // Write-through to time_series
  const timeSeriesPoints = report.entries.map((entry) => ({
    metric: entry.metric,
    source: 'lab_report' as const,
    time: reportDate,
    unit: entry.unit,
    value: entry.value,
  }))

  if (timeSeriesPoints.length > 0) {
    await insertTimeSeries(user, timeSeriesPoints)
  }

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
 * Delete a report and its write-through metrics.
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

  // Clean up write-through time_series data
  // We delete by exact (time, metric, source='lab_report') to avoid removing data from other sources
  for (const { metric, report_date } of entryMetrics) {
    await query(user, `DELETE FROM time_series WHERE metric = $1 AND time = $2 AND source = 'lab_report'`, [
      metric,
      report_date,
    ])
  }

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
