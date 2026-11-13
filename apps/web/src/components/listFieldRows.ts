import type { DataItemFieldDefinition, DataSchemaDefinition } from '@aurboda/api-spec'

export type ListRow = Record<string, unknown>

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

export const MAIN_ITEM_FIELDS = 4

export const mainItemFields = (itemFields: DataItemFieldDefinition[]): DataItemFieldDefinition[] =>
  itemFields.filter((f, i) => i < MAIN_ITEM_FIELDS || f.required === true)

export const visibleItemFields = (
  itemFields: DataItemFieldDefinition[],
  rows: ListRow[],
  expanded: boolean,
): DataItemFieldDefinition[] => {
  if (expanded) return itemFields
  const main = new Set(mainItemFields(itemFields))
  return itemFields.filter((f) => main.has(f) || rows.some((row) => !isBlank(row[f.name])))
}

export const newRow = (previous: ListRow | undefined, itemFields: DataItemFieldDefinition[]): ListRow =>
  Object.fromEntries(
    mainItemFields(itemFields).flatMap((f) =>
      previous && !isBlank(previous[f.name]) ? [[f.name, previous[f.name]]] : [],
    ),
  )

export const moveRow = (rows: ListRow[], index: number, delta: -1 | 1): ListRow[] => {
  const target = index + delta
  const row = rows[index]
  const neighbour = rows[target]
  if (row === undefined || neighbour === undefined) return rows
  return rows.map((r, i) => (i === index ? neighbour : i === target ? row : r))
}

export const removeRow = (rows: ListRow[], index: number): ListRow[] => rows.filter((_, i) => i !== index)

export const setCell = (rows: ListRow[], index: number, name: string, value: unknown): ListRow[] =>
  rows.map((row, i) => (i === index ? { ...row, [name]: value } : row))

export const addRowLabel = (label: string): string => {
  const singular = (label.endsWith('s') ? label.slice(0, -1) : label).trim().toLowerCase()
  return singular === '' ? '+ Add row' : `+ Add ${singular}`
}

export const dropBlankListRows = (
  schema: DataSchemaDefinition | undefined,
  data: Record<string, unknown>,
): Record<string, unknown> =>
  (schema?.fields ?? []).reduce((acc, field) => {
    const rows = acc[field.name]
    if (field.type !== 'list' || !Array.isArray(rows)) return acc
    const items = field.item_fields ?? []
    const kept = rows.filter(
      (row) => typeof row !== 'object' || row === null || items.some((item) => !isBlank(row[item.name])),
    )
    return kept.length === rows.length ? acc : { ...acc, [field.name]: kept }
  }, data)
