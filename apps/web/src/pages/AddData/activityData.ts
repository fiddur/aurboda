import type { DataFieldDefinition, DataItemFieldDefinition } from '@aurboda/api-spec'

type ListRow = Record<string, unknown>

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

const scalarValue = (type: DataItemFieldDefinition['type'], raw: unknown): unknown => {
  if (isBlank(raw)) return undefined
  switch (type) {
    case 'string':
      return typeof raw === 'string' ? raw.trim() : raw
    case 'number': {
      const num = typeof raw === 'number' ? raw : parseFloat(String(raw))
      return Number.isFinite(num) ? num : undefined
    }
    case 'boolean':
      return raw === true || raw === 'true' ? true : undefined
  }
}

const itemValue = (item: DataItemFieldDefinition | undefined, raw: unknown): unknown => {
  if (isBlank(raw)) return undefined
  return item ? scalarValue(item.type, raw) : raw
}

const cleanRow = (row: ListRow, itemFields: DataItemFieldDefinition[]): ListRow | undefined => {
  if (itemFields.every((item) => isBlank(row[item.name]))) return undefined
  const byName = new Map(itemFields.map((item) => [item.name, item]))
  const entries = Object.entries(row).flatMap(([key, raw]) => {
    const value = itemValue(byName.get(key), raw)
    return value === undefined ? [] : [[key, value] as const]
  })
  return Object.fromEntries(entries)
}

const fieldValue = (
  field: DataFieldDefinition,
  scalars: Record<string, string>,
  lists: Record<string, ListRow[]>,
): unknown => {
  if (field.type !== 'list') return scalarValue(field.type, scalars[field.name])
  const rows = (lists[field.name] ?? []).flatMap((row) => {
    const cleaned = cleanRow(row, field.item_fields ?? [])
    return cleaned ? [cleaned] : []
  })
  return rows.length > 0 ? rows : undefined
}

export const buildActivityData = (
  fields: DataFieldDefinition[],
  scalars: Record<string, string>,
  lists: Record<string, ListRow[]>,
): Record<string, unknown> | undefined => {
  const entries = fields.flatMap((field) => {
    const value = fieldValue(field, scalars, lists)
    return value === undefined ? [] : [[field.name, value] as const]
  })
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}
