/**
 * Activity type definition schemas — defines custom and built-in activity types.
 */
import { z } from 'zod'

import { baseResponseSchema, createDataArrayResponseSchema, displayCategorySchema } from './common.ts'

/**
 * Activity type definition schema.
 */
export const activityTypeDefinitionSchema = z
  .object({
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .meta({ description: 'Hex color for timeline rendering' }),
    display_category: displayCategorySchema,
    display_name: z.string().meta({ description: 'Human-readable display name' }),
    icon: z.string().optional().meta({ description: 'Emoji or icon identifier' }),
    is_builtin: z.boolean().meta({ description: 'Whether this is a built-in type' }),
    name: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .meta({ description: 'Snake_case identifier used as activity_type value' }),
  })
  .meta({ id: 'ActivityTypeDefinition', description: 'Activity type definition with display metadata' })

export type ActivityTypeDefinition = z.infer<typeof activityTypeDefinitionSchema>

/**
 * Add activity type definition request body.
 */
export const addActivityTypeDefinitionBodySchema = z
  .object({
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional()
      .meta({ description: 'Hex color (defaults to #6b7280)' }),
    display_category: displayCategorySchema.meta({ description: 'Display category for timeline grouping' }),
    display_name: z.string().meta({ description: 'Human-readable display name' }),
    icon: z.string().optional().meta({ description: 'Emoji or icon identifier' }),
    name: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .meta({ description: 'Snake_case identifier (e.g. "sauna", "driving")' }),
  })
  .meta({ id: 'AddActivityTypeDefinitionBody' })

export type AddActivityTypeDefinitionBody = z.infer<typeof addActivityTypeDefinitionBodySchema>

/**
 * Update activity type definition request body.
 */
export const updateActivityTypeDefinitionBodySchema = z
  .object({
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional()
      .meta({ description: 'New hex color' }),
    display_category: displayCategorySchema.optional().meta({ description: 'New display category' }),
    display_name: z.string().optional().meta({ description: 'New display name' }),
    icon: z.string().optional().meta({ description: 'New icon' }),
  })
  .meta({ id: 'UpdateActivityTypeDefinitionBody' })

export type UpdateActivityTypeDefinitionBody = z.infer<typeof updateActivityTypeDefinitionBodySchema>

/**
 * Activity type definitions list response.
 */
export const activityTypeDefinitionsResponseSchema = createDataArrayResponseSchema(
  activityTypeDefinitionSchema,
).meta({ id: 'ActivityTypeDefinitionsResponse' })

export type ActivityTypeDefinitionsResponse = z.infer<typeof activityTypeDefinitionsResponseSchema>

/**
 * Single activity type definition response (for add/update).
 */
export const activityTypeDefinitionResponseSchema = baseResponseSchema
  .extend({
    data: activityTypeDefinitionSchema.optional(),
  })
  .meta({ id: 'ActivityTypeDefinitionResponse' })

export type ActivityTypeDefinitionResponse = z.infer<typeof activityTypeDefinitionResponseSchema>
