import type { ReportImportDateOrder } from './schemas/reports.ts'

/** Reading a spreadsheet table pasted or exported as text, shared by the import and its preview. */

export type Delimiter = '\t' | ';' | ','

export const stripBom = (text: string): string => text.replace(/^\uFEFF/, '')

const countOutsideQuotes = (line: string, char: string): number => {
  let count = 0
  let quoted = false
  for (const c of line) {
    if (c === '"') quoted = !quoted
    else if (!quoted && c === char) count++
  }
  return count
}

/**
 * Tab wins when there is one (a paste from a spreadsheet), then semicolon, since a semicolon-separated
 * export uses the comma as its decimal separator.
 */
export const detectDelimiter = (text: string): Delimiter => {
  const lines = text
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim() !== '')
    .slice(0, 20)
  const count = (char: string) => lines.reduce((sum, line) => sum + countOutsideQuotes(line, char), 0)
  if (count('\t') > 0) return '\t'
  if (count(';') > 0) return ';'
  return ','
}

interface Cursor {
  records: string[][]
  record: string[]
  field: string
  quoted: boolean
}

const endField = (c: Cursor) => {
  c.record.push(c.field)
  c.field = ''
}

const endRecord = (c: Cursor) => {
  endField(c)
  c.records.push(c.record)
  c.record = []
}

/** Reads one character inside quotes; returns how many characters it took. */
const readQuoted = (c: Cursor, char: string, next: string | undefined): number => {
  if (char !== '"') {
    c.field += char
    return 1
  }
  if (next === '"') {
    c.field += '"'
    return 2
  }
  c.quoted = false
  return 1
}

const readPlain = (c: Cursor, char: string, next: string | undefined, delimiter: Delimiter): number => {
  if (char === '"' && c.field.trim() === '') {
    c.field = ''
    c.quoted = true
  } else if (char === delimiter) endField(c)
  else if (char === '\r' || char === '\n') {
    endRecord(c)
    if (char === '\r' && next === '\n') return 2
  } else c.field += char
  return 1
}

const isBlankRecord = (record: string[]) => record.every((cell) => cell.trim() === '')

/** RFC 4180-style: quoted fields may hold the delimiter, doubled quotes and line breaks. */
export const parseDelimited = (text: string, delimiter: Delimiter): string[][] => {
  const c: Cursor = { field: '', quoted: false, record: [], records: [] }
  let i = 0
  while (i < text.length) {
    i += c.quoted ? readQuoted(c, text[i], text[i + 1]) : readPlain(c, text[i], text[i + 1], delimiter)
  }
  if (c.field !== '' || c.record.length > 0) endRecord(c)
  const records = c.records
  while (records.length > 0 && isBlankRecord(records.at(-1)!)) records.pop()
  return records
}

export const parseTable = (text: string): string[][] => {
  const clean = stripBom(text)
  return parseDelimited(clean, detectDelimiter(clean))
}

const toIsoDate = (year: number, month: number, day: number): string | undefined => {
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10)
    : undefined
}

const fullYear = (year: string): number => (year.length === 2 ? 2000 + Number(year) : Number(year))

/** `YYYY-MM-DD`, or undefined when the text is not a date in one of the supported numeric forms. */
export const parseImportDate = (raw: string, order: ReportImportDateOrder): string | undefined => {
  const text = raw.trim()
  const ymd = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text)
  if (ymd) return toIsoDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]))
  const short = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-]|\s+)(\d{4}|\d{2})$/.exec(text)
  if (!short) return undefined
  const a = Number(short[1])
  const b = Number(short[2])
  const dayFirst = a > 12 ? true : b > 12 ? false : order === 'dmy'
  return dayFirst ? toIsoDate(fullYear(short[3]), b, a) : toIsoDate(fullYear(short[3]), a, b)
}
