import type { DataFieldDefinition, DataItemFieldDefinition } from '@aurboda/api-spec'

const FIELD_NAME = /^[a-z][a-z0-9_]*$/

const emptyItemField = (): DataItemFieldDefinition => ({ name: '', type: 'string' })

export const setFieldType = (
  field: DataFieldDefinition,
  type: DataFieldDefinition['type'],
): DataFieldDefinition => {
  if (type === 'list') {
    if (field.type === 'list') return field
    const { enum_values: _enum, is_categorical: _categorical, ...rest } = field
    return { ...rest, item_fields: [emptyItemField()], type }
  }
  const { item_fields: _items, ...rest } = field
  return { ...rest, type }
}

const withItemFields = (
  field: DataFieldDefinition,
  update: (items: DataItemFieldDefinition[]) => DataItemFieldDefinition[],
): DataFieldDefinition => ({ ...field, item_fields: update(field.item_fields ?? []) })

export const addItemField = (field: DataFieldDefinition): DataFieldDefinition =>
  withItemFields(field, (items) => [...items, emptyItemField()])

export const updateItemField = (
  field: DataFieldDefinition,
  index: number,
  patch: Partial<DataItemFieldDefinition>,
): DataFieldDefinition =>
  withItemFields(field, (items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)))

export const removeItemField = (field: DataFieldDefinition, index: number): DataFieldDefinition =>
  withItemFields(field, (items) => items.filter((_, i) => i !== index))

/** What is saved: fields with valid names, and a list field only while it has a valid item field. */
export const validSchemaFields = (fields: DataFieldDefinition[]): DataFieldDefinition[] =>
  fields.flatMap((field) => {
    if (!FIELD_NAME.test(field.name)) return []
    if (field.type !== 'list') return [field]
    const items = (field.item_fields ?? []).filter((item) => FIELD_NAME.test(item.name))
    return items.length > 0 ? [{ ...field, item_fields: items }] : []
  })
