import type { ReportImportMapping } from '@aurboda/api-spec'

import { parseImportDate } from '@aurboda/api-spec'

/**
 * Decimal comma or point, with spaces as thousands separators. When both `.` and `,` occur the last one
 * is the decimal separator; one kind occurring more than once is a thousands separator.
 */
export const parseImportNumber = (raw: string): number | undefined => {
  const text = raw.replaceAll(/[\s\u00a0\u2009\u202f]/g, '').replaceAll('−', '-')
  if (!/^[+-]?[\d.,]*\d[\d.,]*$/.test(text)) return undefined
  const lastDot = text.lastIndexOf('.')
  const lastComma = text.lastIndexOf(',')
  const decimalAt = (separator: string, last: number) => (text.split(separator).length === 2 ? last : -1)
  const decimal =
    lastDot >= 0 && lastComma >= 0
      ? Math.max(lastDot, lastComma)
      : lastDot >= 0
        ? decimalAt('.', lastDot)
        : lastComma >= 0
          ? decimalAt(',', lastComma)
          : -1
  const normalized =
    decimal >= 0
      ? `${text.slice(0, decimal).replaceAll(/[.,]/g, '')}.${text.slice(decimal + 1)}`
      : text.replaceAll(/[.,]/g, '')
  if (!/^[+-]?\d*\.?\d+$/.test(normalized)) return undefined
  return Number(normalized)
}

export interface ReferenceRange {
  reference_low?: number
  reference_high?: number
}

export const parseReferenceRange = (raw: string): ReferenceRange => {
  const text = raw.trim()
  const bound = /^([<>≤≥]=?)\s*(.+)$/.exec(text)
  if (bound) {
    const value = parseImportNumber(bound[2])
    if (value === undefined) return {}
    return bound[1].startsWith('<') || bound[1] === '≤' ? { reference_high: value } : { reference_low: value }
  }
  const range = /^(.+?)\s*[-–—]\s*(.+)$/.exec(text)
  if (!range) return {}
  const low = parseImportNumber(range[1])
  const high = parseImportNumber(range[2])
  return low === undefined || high === undefined ? {} : { reference_high: high, reference_low: low }
}

export interface ImportCell {
  row: number
  column?: number
  date: string
  metric: string
  value: number
  unit?: string
  reference_low?: number
  reference_high?: number
}

export interface ImportCellError {
  row: number
  column?: number
  date?: string
  metric?: string
  error: string
}

export interface ExtractedTable {
  cells: ImportCell[]
  errors: ImportCellError[]
  skipped: Array<{ row: number }>
}

const cellAt = (record: string[], index: number | undefined): string =>
  index === undefined ? '' : (record[index] ?? '').trim()

const sameRow = (a: string[], b: string[]): boolean =>
  a.length > 0 &&
  a.some((cell) => cell.trim() !== '') &&
  a.every((cell, i) => cell.trim().toLowerCase() === (b[i] ?? '').trim().toLowerCase())

const isBlank = (record: string[]): boolean => record.every((cell) => cell.trim() === '')

const referencesOf = (record: string[], mapping: ReportImportMapping): ReferenceRange => {
  const range =
    mapping.reference_range === undefined ? {} : parseReferenceRange(cellAt(record, mapping.reference_range))
  const low = parseImportNumber(cellAt(record, mapping.reference_low))
  const high = parseImportNumber(cellAt(record, mapping.reference_high))
  return {
    ...range,
    ...(low === undefined ? {} : { reference_low: low }),
    ...(high === undefined ? {} : { reference_high: high }),
  }
}

interface DataRow {
  record: string[]
  row: number
}

const dataRows = (records: string[][], hasHeader: boolean): DataRow[] =>
  records.map((record, i) => ({ record, row: i + 1 })).slice(hasHeader ? 1 : 0)

/** Rows that are blank, or have no test name, or repeat the header, before any value is read. */
const classifyRow = (
  { record, row }: DataRow,
  header: string[] | undefined,
  mapping: ReportImportMapping,
  out: ExtractedTable,
): string | undefined => {
  if (isBlank(record)) return undefined
  if (header && sameRow(record, header)) {
    out.errors.push({ error: 'Repeated header row', row })
    return undefined
  }
  const metric = cellAt(record, mapping.metric)
  if (metric === '') {
    out.skipped.push({ row })
    return undefined
  }
  return metric
}

const extractLong = (records: string[][], mapping: ReportImportMapping): ExtractedTable => {
  const out: ExtractedTable = { cells: [], errors: [], skipped: [] }
  const header = mapping.has_header ? records[0] : undefined
  for (const dataRow of dataRows(records, mapping.has_header)) {
    const metric = classifyRow(dataRow, header, mapping, out)
    if (metric === undefined) continue
    const { record, row } = dataRow
    const rawValue = cellAt(record, mapping.value)
    if (rawValue === '') continue
    const rawDate = cellAt(record, mapping.date)
    const date = parseImportDate(rawDate, mapping.date_order)
    if (!date) {
      out.errors.push({ error: rawDate === '' ? 'No date' : `Not a date: ${rawDate}`, metric, row })
      continue
    }
    const value = parseImportNumber(rawValue)
    if (value === undefined) {
      out.errors.push({ date, error: `Not a number: ${rawValue}`, metric, row })
      continue
    }
    const unit = cellAt(record, mapping.unit)
    out.cells.push({ date, metric, row, value, ...(unit ? { unit } : {}), ...referencesOf(record, mapping) })
  }
  return out
}

const describedColumns = (mapping: ReportImportMapping): Set<number> =>
  new Set(
    [
      mapping.metric,
      mapping.unit,
      mapping.reference_low,
      mapping.reference_high,
      mapping.reference_range,
    ].filter((index): index is number => index !== undefined),
  )

/** The date of each date column, or a message saying why the sheet cannot be read. */
export const wideDateColumns = (
  header: string[],
  mapping: ReportImportMapping,
): { columns: Array<{ column: number; date: string }> } | { error: string } => {
  if (mapping.date_columns) {
    const columns: Array<{ column: number; date: string }> = []
    for (const column of mapping.date_columns) {
      const label = (header[column] ?? '').trim()
      const date = parseImportDate(label, mapping.date_order)
      if (!date) return { error: `The header of column ${column + 1} is not a date: "${label}"` }
      columns.push({ column, date })
    }
    return columns.length > 0 ? { columns } : { error: 'No date columns chosen' }
  }
  const described = describedColumns(mapping)
  const columns = header.flatMap((label, column) => {
    if (described.has(column)) return []
    const date = parseImportDate(label, mapping.date_order)
    return date ? [{ column, date }] : []
  })
  return columns.length > 0 ? { columns } : { error: 'No column header reads as a date' }
}

const extractWide = (
  records: string[][],
  mapping: ReportImportMapping,
): ExtractedTable | { error: string } => {
  if (!mapping.has_header) return { error: 'A wide sheet needs a header row with the dates' }
  const header = records[0] ?? []
  const dates = wideDateColumns(header, mapping)
  if ('error' in dates) return dates
  const out: ExtractedTable = { cells: [], errors: [], skipped: [] }
  for (const dataRow of dataRows(records, true)) {
    const metric = classifyRow(dataRow, header, mapping, out)
    if (metric === undefined) continue
    const { record, row } = dataRow
    const unit = cellAt(record, mapping.unit)
    const references = referencesOf(record, mapping)
    for (const { column, date } of dates.columns) {
      const rawValue = cellAt(record, column)
      if (rawValue === '') continue
      const value = parseImportNumber(rawValue)
      if (value === undefined) {
        out.errors.push({ column, date, error: `Not a number: ${rawValue}`, metric, row })
        continue
      }
      out.cells.push({ column, date, metric, row, value, ...(unit ? { unit } : {}), ...references })
    }
  }
  return out
}

export const extractCells = (
  records: string[][],
  mapping: ReportImportMapping,
): ExtractedTable | { error: string } =>
  mapping.layout === 'long' ? extractLong(records, mapping) : extractWide(records, mapping)
