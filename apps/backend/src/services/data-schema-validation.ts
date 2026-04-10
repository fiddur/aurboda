/**
 * Validates activity data against a data schema definition.
 *
 * Only validates declared fields: checks required presence, type correctness,
 * and enum membership. Extra fields not in the schema are silently accepted.
 */
import type { DataSchemaDefinition } from '@aurboda/api-spec'

export interface DataValidationResult {
  valid: boolean
  errors?: string[]
}

export const validateActivityData = (
  data: Record<string, unknown> | undefined,
  schema: DataSchemaDefinition,
): DataValidationResult => {
  const errors: string[] = []

  for (const field of schema.fields) {
    const value = data?.[field.name]

    // Check required fields
    if (field.required && (value === undefined || value === null)) {
      errors.push(`Required field "${field.name}" is missing`)
      continue
    }

    // Skip absent optional fields
    if (value === undefined || value === null) continue

    // Check type
    if (typeof value !== field.type) {
      errors.push(`Field "${field.name}" expected type "${field.type}", got "${typeof value}"`)
      continue
    }

    // Check enum constraint for string fields
    if (field.type === 'string' && field.enum_values && !field.enum_values.includes(value as string)) {
      errors.push(`Field "${field.name}" value "${value}" is not one of: ${field.enum_values.join(', ')}`)
    }
  }

  if (errors.length > 0) return { errors, valid: false }
  return { valid: true }
}
