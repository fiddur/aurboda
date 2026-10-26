/**
 * Activity types can define a schema that describes what fields their `data` JSONB
 * column should contain, enabling validation on write and structured rendering in the UI.
 *
 * A `list` field holds an array of objects, each shaped by the field's `item_fields` — a
 * strength session's sets, a rehab session's exercises. Item fields are scalar only, so
 * nesting stops at one level.
 */
import { z } from 'zod'

export const dataItemFieldTypeSchema = z
  .enum(['string', 'number', 'boolean'])
  .meta({
    id: 'DataItemFieldType',
    description: 'Scalar value types, the only ones allowed inside a list item',
  })

export type DataItemFieldType = z.infer<typeof dataItemFieldTypeSchema>

export const dataFieldTypeSchema = z.enum(['string', 'number', 'boolean', 'list']).meta({
  id: 'DataFieldType',
  description:
    "Allowed data field types; `list` is an array of objects, each shaped by the field's `item_fields`",
})

export type DataFieldType = z.infer<typeof dataFieldTypeSchema>

const fieldDefinitionShape = {
  enum_values: z
    .array(z.string())
    .optional()
    .meta({ description: 'For string fields: constrain to specific values' }),
  label: z.string().optional().meta({ description: 'Human-readable label (defaults to capitalized name)' }),
  name: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .meta({ description: 'Field key in the data object (snake_case)' }),
  required: z.boolean().optional().meta({ description: 'Whether this field is required (default false)' }),
  unit: z.string().optional().meta({ description: 'Display unit suffix (e.g. "cm", "kg")' }),
}

export const dataItemFieldDefinitionSchema = z
  .object({
    ...fieldDefinitionShape,
    type: dataItemFieldTypeSchema.meta({ description: 'Value type for validation' }),
  })
  .meta({
    id: 'DataItemFieldDefinition',
    description: 'Definition of one scalar field of a list item (e.g. the exercise, weight or reps of a set)',
  })

export type DataItemFieldDefinition = z.infer<typeof dataItemFieldDefinitionSchema>

export const dataFieldDefinitionSchema = z
  .object({
    ...fieldDefinitionShape,
    is_categorical: z
      .boolean()
      .optional()
      .meta({
        description: 'Whether this field is suitable for group-by chart breakdowns (scalar fields only)',
      }),
    item_fields: z
      .array(dataItemFieldDefinitionSchema)
      .min(1)
      .optional()
      .meta({ description: 'For list fields: the fields of each item in the array' }),
    show_in_summary: z
      .boolean()
      .optional()
      .meta({ description: 'Show in timeline tooltip and list views (default false)' }),
    type: dataFieldTypeSchema.meta({ description: 'Value type for validation' }),
  })
  .refine((field) => (field.type === 'list') === (field.item_fields !== undefined), {
    message: 'item_fields is required for a list field and not allowed on a scalar field',
    path: ['item_fields'],
  })
  .refine((field) => field.type !== 'list' || !field.is_categorical, {
    message: 'a list field cannot be categorical',
    path: ['is_categorical'],
  })
  .meta({ id: 'DataFieldDefinition', description: 'Definition of a single data field on an activity type' })

export type DataFieldDefinition = z.infer<typeof dataFieldDefinitionSchema>

export const dataSchemaDefinitionSchema = z
  .object({
    fields: z
      .array(dataFieldDefinitionSchema)
      .min(1)
      .meta({ description: 'Field definitions for the activity data object' }),
  })
  .meta({
    id: 'DataSchemaDefinition',
    description: 'Schema defining the expected data fields for an activity type',
  })

export type DataSchemaDefinition = z.infer<typeof dataSchemaDefinitionSchema>
