import type {
  CustomMetricDefinition,
  ImportReportsBody,
  ImportReportsResult,
  ReportImportRow,
  ReportImportSummary,
  StoredMetricCatalog,
} from '@aurboda/api-spec'

import { parseTable, REPORT_IMPORT_MAX_ROWS } from '@aurboda/api-spec'

import { getCustomMetricDefinitions, upsertUserSettings } from '../db/index.ts'
import { dayEndInTz, dayKey, dayStartInTz } from './day-keys.ts'
import { loadMetricCatalog } from './metric-catalog.ts'
import { resolveMetricForWrite } from './metric-resolution.ts'
import { type ExtractedTable, extractCells, type ImportCell } from './report-import-parse.ts'
import {
  type AddReportInput,
  addReport,
  prepareReportEntries,
  queryReports,
  updateReport,
} from './reports.ts'
import { getUserTimezone } from './settings.ts'

type EntryInput = AddReportInput['entries'][number]

export interface ExistingReport {
  id: string
  date: string
  report_type: string
  entries: EntryInput[]
}

export interface DatePlan {
  date: string
  update?: ExistingReport
  cells: ImportCell[]
  entries: EntryInput[]
}

export interface ImportPlan {
  dates: DatePlan[]
  rows: ReportImportRow[]
}

export const MAX_RESPONSE_ROWS = 2000

const cellRow = (cell: ImportCell, unit: string | undefined): ReportImportRow => ({
  ...(cell.column === undefined ? {} : { column: cell.column }),
  date: cell.date,
  metric: cell.metric,
  row: cell.row,
  status: 'new',
  ...(unit === undefined ? {} : { unit }),
  value: cell.value,
})

const entryOf = (cell: ImportCell, metric: string, unit: string): EntryInput => ({
  metric,
  unit,
  value: cell.value,
  ...(cell.reference_low === undefined ? {} : { reference_low: cell.reference_low }),
  ...(cell.reference_high === undefined ? {} : { reference_high: cell.reference_high }),
})

const tableRows = (table: ExtractedTable): ReportImportRow[] => [
  ...table.errors.map(
    (e): ReportImportRow => ({
      ...(e.column === undefined ? {} : { column: e.column }),
      ...(e.date === undefined ? {} : { date: e.date }),
      error: e.error,
      ...(e.metric === undefined ? {} : { metric: e.metric }),
      row: e.row,
      status: 'error',
    }),
  ),
  ...table.skipped.map((s): ReportImportRow => ({ row: s.row, status: 'skipped' })),
]

const groupByDate = (cells: ImportCell[]): Map<string, ImportCell[]> => {
  const groups = new Map<string, ImportCell[]>()
  for (const cell of cells) groups.getOrInsert(cell.date, []).push(cell)
  return groups
}

interface DateOutcome {
  plan?: DatePlan
  rows: ReportImportRow[]
}

const cellError = (
  cell: ImportCell,
  unit: string | undefined,
  repeated: boolean,
  date: string,
): string | undefined => {
  if (unit === undefined) return `No unit for "${cell.metric}": add a unit column`
  if (repeated) return `"${cell.metric}" appears more than once for ${date}`
  return undefined
}

interface ClassifiedCells {
  rows: ReportImportRow[]
  newCells: Array<{ cell: ImportCell; entry: EntryInput }>
}

const classifyCells = (
  date: string,
  cells: ImportCell[],
  existing: ExistingReport[],
  customMetrics: CustomMetricDefinition[],
  catalog: StoredMetricCatalog,
): ClassifiedCells => {
  const existingMetrics = new Set(existing.flatMap((r) => r.entries.map((e) => e.metric)))
  const seen = new Set<string>()
  const out: ClassifiedCells = { newCells: [], rows: [] }
  for (const cell of cells) {
    const resolved = resolveMetricForWrite(cell.metric, customMetrics, catalog)
    const metric = resolved?.metric ?? cell.metric
    const unit = cell.unit ?? resolved?.unit
    const row = cellRow(cell, unit)
    const error = cellError(cell, unit, seen.has(metric) && !resolved?.entry, date)
    if (existingMetrics.has(metric)) out.rows.push({ ...row, status: 'exists' })
    else if (error !== undefined || unit === undefined) out.rows.push({ ...row, error, status: 'error' })
    else {
      seen.add(metric)
      out.rows.push(row)
      out.newCells.push({ cell, entry: entryOf(cell, cell.metric, unit) })
    }
  }
  return out
}

const planDate = (
  date: string,
  cells: ImportCell[],
  existing: ExistingReport[],
  reportType: string,
  customMetrics: CustomMetricDefinition[],
  catalog: StoredMetricCatalog,
): DateOutcome => {
  const { rows, newCells } = classifyCells(date, cells, existing, customMetrics, catalog)
  if (newCells.length === 0) return { rows }

  const update = existing.find((r) => r.report_type === reportType)
  const entries = [...(update?.entries ?? []), ...newCells.map((c) => c.entry)]
  const prepared = prepareReportEntries(entries, customMetrics, catalog)
  if ('errors' in prepared) {
    const error = prepared.errors.join('\n')
    return {
      rows: rows.map((r): ReportImportRow => (r.status === 'new' ? { ...r, error, status: 'error' } : r)),
    }
  }
  return { plan: { cells: newCells.map((c) => c.cell), date, entries, ...(update ? { update } : {}) }, rows }
}

/**
 * Which cells are new, already imported (the user has a report on that date with the same resolved
 * metric) or refused, and per date whether the new cells make a new report or are added to the user's
 * report of the same type on that date.
 */
export const planImport = (
  table: ExtractedTable,
  existing: ExistingReport[],
  reportType: string,
  customMetrics: CustomMetricDefinition[],
  catalog: StoredMetricCatalog,
): ImportPlan => {
  const rows = tableRows(table)
  const dates: DatePlan[] = []
  for (const [date, cells] of groupByDate(table.cells)) {
    const outcome = planDate(
      date,
      cells,
      existing.filter((r) => r.date === date),
      reportType,
      customMetrics,
      catalog,
    )
    rows.push(...outcome.rows)
    if (outcome.plan) dates.push(outcome.plan)
  }
  return { dates, rows }
}

export const summarize = (rows: ReportImportRow[], dates: DatePlan[]): ReportImportSummary => ({
  entries_existing: rows.filter((r) => r.status === 'exists').length,
  entries_new: rows.filter((r) => r.status === 'new').length,
  errors: rows.filter((r) => r.status === 'error').length,
  reports_new: dates.filter((d) => !d.update).length,
  reports_updated: dates.filter((d) => d.update).length,
})

const STATUS_ORDER: Record<ReportImportRow['status'], number> = { error: 0, exists: 2, new: 1, skipped: 3 }

export const orderedRows = (rows: ReportImportRow[]): { rows: ReportImportRow[]; truncated: boolean } => {
  const sorted = rows.toSorted(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.row - b.row || (a.column ?? 0) - (b.column ?? 0),
  )
  return { rows: sorted.slice(0, MAX_RESPONSE_ROWS), truncated: sorted.length > MAX_RESPONSE_ROWS }
}

const loadExisting = async (user: string, dates: string[], tz: string): Promise<ExistingReport[]> => {
  if (dates.length === 0) return []
  const sorted = dates.toSorted()
  const result = await queryReports(user, {
    end: dayEndInTz(sorted.at(-1)!, tz).toISOString(),
    start: dayStartInTz(sorted[0], tz).toISOString(),
  })
  return (result.data ?? []).map((r) => ({
    date: dayKey(new Date(r.date), tz),
    entries: r.entries.map((e) => ({
      metric: e.metric,
      unit: e.unit,
      value: e.value,
      ...(e.method === undefined ? {} : { method: e.method }),
      ...(e.confidence === undefined ? {} : { confidence: e.confidence }),
      ...(e.reference_low === undefined ? {} : { reference_low: e.reference_low }),
      ...(e.reference_high === undefined ? {} : { reference_high: e.reference_high }),
      ...(e.flag === undefined ? {} : { flag: e.flag }),
    })),
    id: r.id,
    report_type: r.report_type,
  }))
}

const writeDate = async (
  user: string,
  plan: DatePlan,
  body: ImportReportsBody,
  tz: string,
  catalog: StoredMetricCatalog,
) =>
  plan.update
    ? updateReport(user, plan.update.id, { entries: plan.entries }, catalog)
    : addReport(
        user,
        {
          date: dayStartInTz(plan.date, tz).toISOString(),
          entries: plan.entries,
          report_type: body.report_type,
          ...(body.location ? { location: body.location } : {}),
          ...(body.notes ? { notes: body.notes } : {}),
        },
        catalog,
      )

const cellKey = (row: number, column: number | undefined) => `${row}:${column ?? ''}`

/** Writes every planned date; a date the service refuses turns its new rows into errors. */
const runPlan = async (
  user: string,
  plan: ImportPlan,
  body: ImportReportsBody,
  tz: string,
  catalog: StoredMetricCatalog,
): Promise<{ dates: DatePlan[]; report_ids: string[]; rows: ReportImportRow[] }> => {
  const failed = new Map<string, string>()
  const written: DatePlan[] = []
  const reportIds: string[] = []
  for (const date of plan.dates) {
    const result = await writeDate(user, date, body, tz, catalog)
    if (result.success && result.data) {
      written.push(date)
      reportIds.push(result.data.id)
    } else {
      for (const cell of date.cells) failed.set(cellKey(cell.row, cell.column), result.error ?? 'Not saved')
    }
  }
  const rows = plan.rows.map((row): ReportImportRow => {
    const error = row.status === 'new' ? failed.get(cellKey(row.row, row.column)) : undefined
    return error === undefined ? row : { ...row, error, status: 'error' }
  })
  return { dates: written, report_ids: reportIds, rows }
}

export type ImportReportsOutcome = { data: ImportReportsResult } | { error: string }

export const importReports = async (
  user: string,
  body: ImportReportsBody,
  catalog: StoredMetricCatalog = loadMetricCatalog(),
): Promise<ImportReportsOutcome> => {
  const records = parseTable(body.text)
  const dataRowCount = records.length - (body.mapping.has_header ? 1 : 0)
  if (dataRowCount <= 0) return { error: 'The table has no rows to import' }
  if (dataRowCount > REPORT_IMPORT_MAX_ROWS) {
    return {
      error: `The table has ${dataRowCount} rows; at most ${REPORT_IMPORT_MAX_ROWS} can be imported at once`,
    }
  }
  const table = extractCells(records, body.mapping)
  if ('error' in table) return { error: table.error }

  const [tz, customMetrics] = await Promise.all([getUserTimezone(user), getCustomMetricDefinitions(user)])
  const existing = await loadExisting(user, [...new Set(table.cells.map((c) => c.date))], tz)
  const plan = planImport(table, existing, body.report_type, customMetrics, catalog)

  if (body.dry_run) {
    const { rows, truncated } = orderedRows(plan.rows)
    return {
      data: {
        dry_run: true,
        ...(plan.dates.length === 0 ? { message: 'Nothing new to import' } : {}),
        rows,
        rows_truncated: truncated,
        summary: summarize(plan.rows, plan.dates),
      },
    }
  }

  const result = await runPlan(user, plan, body, tz, catalog)
  await upsertUserSettings(user, { report_import_mapping: body.mapping })
  const { rows, truncated } = orderedRows(result.rows)
  return {
    data: {
      dry_run: false,
      ...(plan.dates.length === 0 ? { message: 'Nothing new to import; nothing was written' } : {}),
      report_ids: result.report_ids,
      rows,
      rows_truncated: truncated,
      summary: summarize(result.rows, result.dates),
    },
  }
}
