/**
 * Only validates declared fields: checks required presence, type correctness,
 * and enum membership. Extra fields not in the schema, and extra keys on list
 * items, are silently accepted.
 */
import type { DataFieldDefinition, DataItemFieldDefinition, DataSchemaDefinition } from '@aurboda/api-spec'

export interface DataValidationResult {
  valid: boolean
  errors?: string[]
}

const describeType = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const isPresent = (value: unknown): boolean => value !== undefined && value !== null

const validateScalar = (
  path: string,
  value: unknown,
  field: Pick<DataFieldDefinition, 'enum_values' | 'type'>,
): string[] => {
  if (typeof value !== field.type) {
    return [`Field "${path}" expected type "${field.type}", got "${typeof value}"`]
  }
  if (field.type === 'string' && field.enum_values && !field.enum_values.includes(value as string)) {
    return [`Field "${path}" value "${value}" is not one of: ${field.enum_values.join(', ')}`]
  }
  return []
}

const validateFields = (
  record: Record<string, unknown> | undefined,
  fields: readonly (DataFieldDefinition | DataItemFieldDefinition)[],
  prefix: string,
): string[] =>
  fields.flatMap((field) => {
    const path = `${prefix}${field.name}`
    const value = record?.[field.name]
    if (!isPresent(value)) return field.required ? [`Required field "${path}" is missing`] : []
    if (field.type !== 'list') return validateScalar(path, value, field)
    if (!Array.isArray(value)) return [`Field "${path}" expected an array, got "${describeType(value)}"`]
    const itemFields = 'item_fields' in field ? (field.item_fields ?? []) : []
    return value.flatMap((item: unknown, i) => {
      const itemPath = `${path}[${i}]`
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return [`Field "${itemPath}" expected an object, got "${describeType(item)}"`]
      }
      return validateFields(item as Record<string, unknown>, itemFields, `${itemPath}.`)
    })
  })

export const validateActivityData = (
  data: Record<string, unknown> | undefined,
  schema: DataSchemaDefinition,
): DataValidationResult => {
  const errors = validateFields(data, schema.fields, '')
  if (errors.length > 0) return { errors, valid: false }
  return { valid: true }
}
