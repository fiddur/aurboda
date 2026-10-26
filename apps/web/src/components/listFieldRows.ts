import type { DataItemFieldDefinition, DataSchemaDefinition } from '@aurboda/api-spec'

export type ListRow = Record<string, unknown>

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

/** A repeat of the previous row's declared values, so the next identical set is one click. */
export const newRow = (previous: ListRow | undefined, itemFields: DataItemFieldDefinition[]): ListRow =>
  Object.fromEntries(
    itemFields.flatMap((f) => (previous && !isBlank(previous[f.name]) ? [[f.name, previous[f.name]]] : [])),
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

/** Rows the user added and left empty are dropped before saving, so they never fail validation. */
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
