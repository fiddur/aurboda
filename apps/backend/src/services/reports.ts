/**
 * Reports group related measurements (InBody scans, blood panels, etc.).
 * Entry values/units are stored in time_series (source='lab_report') as the single source of truth.
 * report_entries stores only lab-specific metadata (reference ranges, flags, etc.).
 */

import type {
  Confidence,
  CustomMetricDefinition,
  ReportFlag,
  StoredMetricCatalog,
  StoredMetricCatalogEntry,
} from '@aurboda/api-spec'

import {
  adoptCatalogMetric,
  deleteNotesForEntityIn,
  deleteReport as dbDeleteReport,
  getLatestMetricValue as dbGetLatestMetricValue,
  getReportById as dbGetReportById,
  getReports as dbGetReports,
  insertReport as dbInsertReport,
  updateReport as dbUpdateReport,
  getCustomMetricDefinitions,
  getReportEntryMetrics,
  insertTimeSeries,
  query,
  updateNoteTimesForEntity,
  withUserTransaction,
  type Queryable,
  type Report,
  type ReportEntry,
} from '../db/index.ts'
import { catalogMetricDefinition, loadMetricCatalog } from './metric-catalog.ts'
import { resolveMetricForWrite, valueForWrite } from './metric-resolution.ts'

export const REPORT_NOT_FOUND = 'Report not found'

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
  stored_value?: number
  stored_unit?: string
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

export interface PreparedReportEntry extends AddReportEntryInput {
  series_value: number
  series_unit: string
}

export type PreparedReportEntries =
  | { errors: string[] }
  | { adopt: CustomMetricDefinition[]; entries: PreparedReportEntry[] }

interface PreparedEntry {
  entry: PreparedReportEntry
  catalogEntry?: StoredMetricCatalogEntry
  adopt?: StoredMetricCatalogEntry
}

const prepareEntry = (
  input: AddReportEntryInput,
  customMetrics: CustomMetricDefinition[],
  catalog: StoredMetricCatalog,
): PreparedEntry | { error: string } => {
  const asGiven = { entry: { ...input, series_unit: input.unit, series_value: input.value } }
  const resolved = resolveMetricForWrite(input.metric, customMetrics, catalog)
  if (!resolved?.entry) return resolved ? { entry: { ...asGiven.entry, metric: resolved.metric } } : asGiven
  const converted = valueForWrite(resolved, input.value, input.unit)
  if ('error' in converted) return { error: `Entry "${input.metric}": ${converted.error}` }
  return {
    ...(resolved.adopt ? { adopt: resolved.entry } : {}),
    catalogEntry: resolved.entry,
    entry: { ...input, metric: resolved.metric, series_unit: resolved.unit, series_value: converted.value },
  }
}

/**
 * Resolves every entry to its metric and the value and unit for the metric series, before anything is
 * written. Only metrics with a catalogue entry are converted or refused; any other entry is kept as given.
 */
export const prepareReportEntries = (
  entries: AddReportEntryInput[],
  customMetrics: CustomMetricDefinition[],
  catalog: StoredMetricCatalog,
): PreparedReportEntries => {
  const known = [...customMetrics]
  const errors: string[] = []
  const prepared: PreparedReportEntry[] = []
  const adopt: CustomMetricDefinition[] = []
  const givenByCatalogMetric = new Map<string, string>()

  for (const input of entries) {
    const result = prepareEntry(input, known, catalog)
    if ('error' in result) {
      errors.push(result.error)
      continue
    }
    if (result.catalogEntry) {
      const earlier = givenByCatalogMetric.get(result.entry.metric)
      if (earlier !== undefined) {
        errors.push(`"${earlier}" and "${input.metric}" are the same metric`)
        continue
      }
      givenByCatalogMetric.set(result.entry.metric, input.metric)
    }
    if (result.adopt) {
      const definition = catalogMetricDefinition(result.adopt)
      adopt.push(definition)
      known.push(definition)
    }
    prepared.push(result.entry)
  }

  return errors.length > 0 ? { errors } : { adopt, entries: prepared }
}

const converted = (entry: PreparedReportEntry): boolean =>
  entry.series_value !== entry.value || entry.series_unit !== entry.unit

/** Entry metadata for the DB layer, with the printed value/unit only when the series holds another. */
const toDbEntries = (entries: PreparedReportEntry[]) =>
  entries.map((e) => ({
    confidence: e.confidence,
    flag: e.flag,
    method: e.method,
    metric: e.metric,
    reference_high: e.reference_high,
    reference_low: e.reference_low,
    ...(converted(e) ? { reported_unit: e.unit, reported_value: e.value } : {}),
  }))

const toTimeSeriesPoints = (
  entries: Array<Pick<PreparedReportEntry, 'metric' | 'series_unit' | 'series_value'>>,
  time: Date,
) =>
  entries.map((entry) => ({
    metric: entry.metric,
    source: 'lab_report' as const,
    time,
    unit: entry.series_unit,
    value: entry.series_value,
  }))

const withFlags = (entries: PreparedReportEntry[]): PreparedReportEntry[] =>
  entries.map((e) => ({ ...e, flag: e.flag ?? deriveFlag(e.value, e.reference_low, e.reference_high) }))

const prepareForUser = async (
  user: string,
  entries: AddReportEntryInput[],
  catalog: StoredMetricCatalog,
): Promise<{ error: string } | { entries: PreparedReportEntry[] }> => {
  const prepared = prepareReportEntries(entries, await getCustomMetricDefinitions(user), catalog)
  if ('errors' in prepared) return { error: prepared.errors.join('\n') }
  for (const definition of prepared.adopt) await adoptCatalogMetric(user, definition)
  return { entries: withFlags(prepared.entries) }
}

const cleanupTimeSeries = async (
  db: Queryable | string,
  entryMetrics: Array<{ metric: string; report_date: Date }>,
): Promise<void> => {
  for (const { metric, report_date } of entryMetrics) {
    await query(db, `DELETE FROM time_series WHERE metric = $1 AND time = $2 AND source = 'lab_report'`, [
      metric,
      report_date,
    ])
  }
}

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
  ...(entry.stored_value !== undefined
    ? { stored_unit: entry.stored_unit, stored_value: entry.stored_value }
    : {}),
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

/**
 * Auto-derives flags from reference ranges if not set. Nothing is written when an entry is refused.
 */
export async function addReport(
  user: string,
  input: AddReportInput,
  catalog: StoredMetricCatalog = loadMetricCatalog(),
): Promise<ReportResult> {
  const reportDate = new Date(input.date)

  const prepared = await prepareForUser(user, input.entries, catalog)
  if ('error' in prepared) return { error: prepared.error, success: false }
  const { entries } = prepared

  // Write values to time_series FIRST (single source of truth for metric values).
  // Must happen before insertReport because the DB layer joins with time_series on read.
  const timeSeriesPoints = toTimeSeriesPoints(entries, reportDate)
  if (timeSeriesPoints.length > 0) {
    await insertTimeSeries(user, timeSeriesPoints)
  }

  const report = await dbInsertReport(user, {
    entries: toDbEntries(entries),
    location: input.location,
    notes: input.notes,
    report_date: reportDate,
    report_type: input.report_type,
  })

  return { data: formatReport(report), success: true }
}

export async function getReport(user: string, id: string): Promise<ReportResult> {
  const report = await dbGetReportById(user, id)
  if (!report) {
    return { error: REPORT_NOT_FOUND, success: false }
  }
  return { data: formatReport(report), success: true }
}

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

const reportUpdates = (
  input: UpdateReportInput,
  entries: PreparedReportEntry[] | undefined,
): Parameters<typeof dbUpdateReport>[2] => {
  const dbInput: Parameters<typeof dbUpdateReport>[2] = {}
  if (input.report_type !== undefined) dbInput.report_type = input.report_type
  if (input.date !== undefined) dbInput.report_date = new Date(input.date)
  if (input.location !== undefined) dbInput.location = input.location
  if (input.notes !== undefined) dbInput.notes = input.notes
  if (entries !== undefined) dbInput.entries = toDbEntries(entries)
  return dbInput
}

/**
 * When entries are provided, they fully replace existing entries.
 */
export async function updateReport(
  user: string,
  id: string,
  input: UpdateReportInput,
  catalog: StoredMetricCatalog = loadMetricCatalog(),
): Promise<ReportResult> {
  const existing = await dbGetReportById(user, id)
  if (!existing) {
    return { error: REPORT_NOT_FOUND, success: false }
  }

  let processedEntries: PreparedReportEntry[] | undefined
  if (input.entries) {
    const prepared = await prepareForUser(user, input.entries, catalog)
    if ('error' in prepared) return { error: prepared.error, success: false }
    processedEntries = prepared.entries
  }

  const oldEntryMetrics = await getReportEntryMetrics(user, id)

  // Must happen BEFORE dbUpdateReport because it joins with time_series on read.
  await cleanupTimeSeries(user, oldEntryMetrics)

  const newDate = input.date ? new Date(input.date) : existing.report_date
  const seriesEntries =
    processedEntries ??
    existing.entries.map((e) => ({
      metric: e.metric,
      series_unit: e.stored_unit ?? e.unit,
      series_value: e.stored_value ?? e.value,
    }))
  const timeSeriesPoints = toTimeSeriesPoints(seriesEntries, newDate)
  if (timeSeriesPoints.length > 0) {
    await insertTimeSeries(user, timeSeriesPoints)
  }

  const updated = await dbUpdateReport(user, id, reportUpdates(input, processedEntries))
  if (!updated) {
    return { error: REPORT_NOT_FOUND, success: false }
  }

  if (input.date && new Date(input.date).getTime() !== existing.report_date.getTime()) {
    await updateNoteTimesForEntity(user, 'report', id, new Date(input.date), undefined)
  }

  return { data: formatReport(updated), success: true }
}

/**
 * Delete a report, its time_series metrics and its comment threads. Like a
 * meal, a report is removed for good, so its comments have nothing left to
 * hang off.
 */
export async function deleteReportById(
  user: string,
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const entryMetrics = await getReportEntryMetrics(user, id)

  const deleted = await withUserTransaction(user, async (tx) => {
    // CASCADE deletes the entries
    if (!(await dbDeleteReport(tx, id))) return false
    await cleanupTimeSeries(tx, entryMetrics)
    await deleteNotesForEntityIn(tx, 'report', id)
    return true
  })

  return deleted ? { success: true } : { error: REPORT_NOT_FOUND, success: false }
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
