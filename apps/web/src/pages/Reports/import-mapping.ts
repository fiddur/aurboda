import type {
  ReportImportDateOrder,
  ReportImportLayout,
  ReportImportMapping,
  ReportImportRow,
  ReportImportSummary,
} from '@aurboda/api-spec'

import { parseImportDate } from '@aurboda/api-spec'

export type ColumnRole =
  | 'ignore'
  | 'date'
  | 'date_column'
  | 'metric'
  | 'value'
  | 'unit'
  | 'reference_range'
  | 'reference_low'
  | 'reference_high'

export const ROLE_LABELS: Record<ColumnRole, string> = {
  date: 'Date',
  date_column: 'Results on this date',
  ignore: 'Ignore',
  metric: 'Test name',
  reference_high: 'Reference high',
  reference_low: 'Reference low',
  reference_range: 'Reference range',
  unit: 'Unit',
  value: 'Value',
}

const SHARED_ROLES: ColumnRole[] = [
  'ignore',
  'metric',
  'unit',
  'reference_range',
  'reference_low',
  'reference_high',
]

export const rolesForLayout = (layout: ReportImportLayout): ColumnRole[] =>
  layout === 'long'
    ? ['ignore', 'date', 'metric', 'value', ...SHARED_ROLES.slice(2)]
    : ['ignore', 'metric', 'date_column', ...SHARED_ROLES.slice(2)]

const HEADER_WORDS: Array<[Exclude<ColumnRole, 'ignore' | 'date_column'>, string[]]> = [
  ['reference_low', ['low', 'min', 'lower', 'nedre']],
  ['reference_high', ['high', 'max', 'upper', 'övre', 'ovre']],
  ['reference_range', ['reference', 'ref', 'referens', 'referensintervall', 'range', 'intervall']],
  ['date', ['date', 'datum', 'provdatum']],
  ['unit', ['unit', 'units', 'enhet']],
  ['value', ['value', 'result', 'resultat', 'värde', 'varde']],
  ['metric', ['test', 'analysis', 'name', 'analys', 'komponent', 'prov', 'marker', 'metric']],
]

/** The role a column header suggests, by its words in English or Swedish. */
export const guessRole = (header: string): ColumnRole | undefined => {
  const words = header
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean)
  return HEADER_WORDS.find(([, names]) => names.some((name) => words.includes(name)))?.[0]
}

const singleRoles = [
  'date',
  'metric',
  'value',
  'unit',
  'reference_range',
  'reference_low',
  'reference_high',
] as const

/** One role per column, from a mapping. */
export const rolesFromMapping = (mapping: ReportImportMapping, columnCount: number): ColumnRole[] => {
  const roles: ColumnRole[] = Array.from({ length: columnCount }, () => 'ignore')
  for (const role of singleRoles) {
    const index = mapping[role]
    if (index !== undefined && index < columnCount && (role !== 'date' || mapping.layout === 'long')) {
      roles[index] = role
    }
  }
  if (mapping.layout === 'wide') {
    for (const index of mapping.date_columns ?? []) if (index < columnCount) roles[index] = 'date_column'
  }
  return roles
}

export interface MappingOptions {
  layout: ReportImportLayout
  has_header: boolean
  date_order: ReportImportDateOrder
}

export const mappingFromRoles = (
  roles: ColumnRole[],
  options: MappingOptions,
): ReportImportMapping | undefined => {
  const indexOf = (role: ColumnRole) => {
    const index = roles.indexOf(role)
    return index === -1 ? undefined : index
  }
  const metric = indexOf('metric')
  if (metric === undefined) return undefined
  const optional = (role: (typeof singleRoles)[number]) => {
    const index = indexOf(role)
    return index === undefined ? {} : { [role]: index }
  }
  const shared = {
    ...options,
    metric,
    ...optional('unit'),
    ...optional('reference_range'),
    ...optional('reference_low'),
    ...optional('reference_high'),
  }
  if (options.layout === 'long') {
    const date = indexOf('date')
    const value = indexOf('value')
    return date === undefined || value === undefined ? undefined : { ...shared, date, value }
  }
  const dateColumns = roles.flatMap((role, index) => (role === 'date_column' ? [index] : []))
  return dateColumns.length === 0 ? undefined : { ...shared, date_columns: dateColumns }
}

/** What the mapping still lacks, in words, or undefined when it is complete. */
export const missingRoles = (roles: ColumnRole[], layout: ReportImportLayout): string | undefined => {
  const needed: ColumnRole[] = layout === 'long' ? ['date', 'metric', 'value'] : ['metric', 'date_column']
  const missing = needed
    .filter((role) => !roles.includes(role))
    .map((role) => ROLE_LABELS[role].toLowerCase())
  return missing.length === 0 ? undefined : `Choose a column for: ${missing.join(', ')}`
}

/** Setting a single role on one column takes it off any other column. */
export const setRole = (roles: ColumnRole[], index: number, role: ColumnRole): ColumnRole[] =>
  roles.map((current, i) => {
    if (i === index) return role
    if (role !== 'ignore' && role !== 'date_column' && current === role) return 'ignore'
    return current
  })

const isDateHeader = (header: string, order: ReportImportDateOrder) =>
  parseImportDate(header, order) !== undefined

/** A first mapping for a table never mapped before, from its header names and date headers. */
export const guessMapping = (
  header: string[],
  order: ReportImportDateOrder = 'dmy',
): { layout: ReportImportLayout; roles: ColumnRole[] } => {
  const roles: ColumnRole[] = header.map(() => 'ignore')
  const layout: ReportImportLayout = header.some((h) => isDateHeader(h, order)) ? 'wide' : 'long'
  header.forEach((name, index) => {
    if (layout === 'wide' && isDateHeader(name, order)) {
      roles[index] = 'date_column'
      return
    }
    const role = guessRole(name)
    if (!role || roles.includes(role) || (layout === 'wide' && (role === 'date' || role === 'value'))) return
    roles[index] = role
  })
  return { layout, roles }
}

/** The roles carried over to the other layout: roles it has no use for are dropped. */
export const switchLayout = (
  roles: ColumnRole[],
  header: string[],
  layout: ReportImportLayout,
  order: ReportImportDateOrder,
): ColumnRole[] => {
  const allowed = new Set(rolesForLayout(layout))
  return roles.map((role, index) => {
    const becomesDateColumn =
      layout === 'wide' && role === 'ignore' && isDateHeader(header[index] ?? '', order)
    if (becomesDateColumn) return 'date_column'
    return allowed.has(role) ? role : 'ignore'
  })
}

/** Whether a remembered mapping can be applied to a table with this many columns. */
export const mappingFits = (mapping: ReportImportMapping, columnCount: number): boolean => {
  const indexes = [
    mapping.date,
    mapping.metric,
    mapping.value,
    mapping.unit,
    mapping.reference_low,
    mapping.reference_high,
    mapping.reference_range,
    ...(mapping.date_columns ?? []),
  ].filter((index): index is number => index !== undefined)
  return indexes.every((index) => index < columnCount)
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

export const summaryText = (summary: ReportImportSummary): string => {
  const reports = summary.reports_new + summary.reports_updated
  const parts = [
    summary.entries_new === 0
      ? 'Nothing new to import'
      : `${plural(summary.entries_new, 'new result', 'new results')} in ${plural(reports, 'report', 'reports')}`,
  ]
  if (summary.entries_existing > 0) parts.push(`${summary.entries_existing} already imported`)
  if (summary.errors > 0) parts.push(plural(summary.errors, 'row with errors', 'rows with errors'))
  return parts.join(', ')
}

export const STATUS_LABELS: Record<ReportImportRow['status'], string> = {
  error: 'Error',
  exists: 'Already imported',
  new: 'New',
  skipped: 'Skipped',
}

const STATUS_ORDER: Record<ReportImportRow['status'], number> = { error: 0, exists: 2, new: 1, skipped: 3 }

export const sortRows = (rows: ReportImportRow[]): ReportImportRow[] =>
  rows.toSorted((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.row - b.row)

export const ACCEPTED_FILE_TYPES = '.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain'

export interface MappingState extends MappingOptions {
  roles: ColumnRole[]
}

/**
 * The mapping used last when it fits the table (enough columns, the same layout as the header suggests),
 * else a guess from the header. A remembered wide mapping takes every date header as a date column, so
 * a column of results added since the last import is picked up.
 */
export const startingMapping = (
  records: string[][],
  remembered: ReportImportMapping | null | undefined,
): MappingState => {
  const columnCount = Math.max(0, ...records.map((r) => r.length))
  const first = records[0] ?? []
  const header = Array.from({ length: columnCount }, (_, i) => first[i] ?? '')
  const guessed = guessMapping(header, remembered?.date_order ?? 'dmy')
  if (remembered && mappingFits(remembered, columnCount) && remembered.layout === guessed.layout) {
    const roles = rolesFromMapping(remembered, columnCount)
    return {
      date_order: remembered.date_order,
      has_header: remembered.has_header,
      layout: remembered.layout,
      roles:
        remembered.layout === 'wide' ? switchLayout(roles, header, 'wide', remembered.date_order) : roles,
    }
  }
  return { date_order: remembered?.date_order ?? 'dmy', has_header: true, ...guessed }
}
