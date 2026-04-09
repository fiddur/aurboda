/**
 * Data schema definitions for custom activity type data fields.
 *
 * Activity types can define a schema that describes what fields their `data` JSONB
 * column should contain, enabling validation on write and structured rendering in the UI.
 */
import { z } from 'zod'

export const dataFieldTypeSchema = z
  .enum(['string', 'number', 'boolean'])
  .meta({ id: 'DataFieldType', description: 'Allowed data field types' })

export type DataFieldType = z.infer<typeof dataFieldTypeSchema>

export const dataFieldDefinitionSchema = z
  .object({
    enum_values: z
      .array(z.string())
      .optional()
      .meta({ description: 'For string fields: constrain to specific values' }),
    is_categorical: z
      .boolean()
      .optional()
      .meta({ description: 'Whether this field is suitable for group-by chart breakdowns' }),
    label: z.string().optional().meta({ description: 'Human-readable label (defaults to capitalized name)' }),
    name: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .meta({ description: 'Field key in the data object (snake_case)' }),
    required: z.boolean().optional().meta({ description: 'Whether this field is required (default false)' }),
    show_in_summary: z
      .boolean()
      .optional()
      .meta({ description: 'Show in timeline tooltip and list views (default false)' }),
    type: dataFieldTypeSchema.meta({ description: 'Value type for validation' }),
    unit: z.string().optional().meta({ description: 'Display unit suffix (e.g. "cm", "kg")' }),
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
