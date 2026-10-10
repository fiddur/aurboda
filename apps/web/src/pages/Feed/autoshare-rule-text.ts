import type { AutoshareDataFilter, AutoshareRule } from '@aurboda/api-spec'

export type DataFilterOperator = AutoshareDataFilter['operator']

export interface DataFilterRow {
  field: string
  operator: DataFilterOperator
  value: string
}

export const DATA_FILTER_OPERATORS: DataFilterOperator[] = ['exists', 'eq', 'neq', 'not_exists']

export const DATA_FILTER_OPERATOR_LABELS: Record<DataFilterOperator, string> = {
  exists: 'has a value',
  eq: 'is',
  neq: 'is not',
  not_exists: 'has no value',
}

const DATA_FIELD_NAME = /^[a-z][a-z0-9_]*$/

export const operatorTakesValue = (operator: DataFilterOperator): boolean =>
  operator === 'eq' || operator === 'neq'

export const newDataFilterRow = (field = ''): DataFilterRow => ({ field, operator: 'exists', value: '' })

export const dataFilterRowComplete = (row: DataFilterRow): boolean =>
  DATA_FIELD_NAME.test(row.field.trim()) && (!operatorTakesValue(row.operator) || row.value.trim() !== '')

export const rowToDataFilter = (row: DataFilterRow): AutoshareDataFilter => {
  const field = row.field.trim()
  return operatorTakesValue(row.operator)
    ? { field, operator: row.operator, value: row.value.trim() }
    : { field, operator: row.operator }
}

export const dataFilterSummary = (filter: AutoshareDataFilter, fieldLabel?: string): string => {
  const name = fieldLabel ?? filter.field.replaceAll('_', ' ')
  switch (filter.operator) {
    case 'eq':
      return `${name} is ${String(filter.value)}`
    case 'exists':
      return `${name} set`
    case 'neq':
      return `${name} is not ${String(filter.value)}`
    case 'not_exists':
      return `no ${name}`
  }
}

/** One human line summarising what a rule matches and publishes. */
export const ruleSummary = (
  rule: AutoshareRule,
  labelFor: (field: string) => string | undefined = () => undefined,
): string => {
  const predicate: string[] = []
  predicate.push(rule.activity_types.length > 0 ? rule.activity_types.join('/') : 'any activity')
  if (rule.min_duration_seconds) predicate.push(`≥ ${Math.round(rule.min_duration_seconds / 60)} min`)
  if (rule.max_duration_seconds) predicate.push(`≤ ${Math.round(rule.max_duration_seconds / 60)} min`)
  if (rule.min_distance_meters) predicate.push(`≥ ${rule.min_distance_meters / 1000} km`)
  if (rule.source) predicate.push(`from ${rule.source}`)
  for (const filter of rule.data_filters) predicate.push(dataFilterSummary(filter, labelFor(filter.field)))
  return `${predicate.join(', ')} → ${rule.visibility}`
}
