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
    aliases: z
      .array(z.string())
      .optional()
      .meta({ description: 'Lowercase match strings for resolving tags/imports to this type' }),
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
    health_connect_exercise_type: z
      .number()
      .int()
      .optional()
      .meta({ description: 'Health Connect exercise type integer value' }),
    health_connect_record_type: z
      .string()
      .optional()
      .meta({ description: 'Health Connect record type (e.g. ExerciseSessionRecord)' }),
    show_on_timeline: z.boolean().meta({ description: 'Whether to show on the timeline' }),
  })
  .meta({ id: 'ActivityTypeDefinition', description: 'Activity type definition with display metadata' })

export type ActivityTypeDefinition = z.infer<typeof activityTypeDefinitionSchema>

/**
 * Add activity type definition request body.
 */
export const addActivityTypeDefinitionBodySchema = z
  .object({
    aliases: z
      .array(z.string())
      .optional()
      .meta({ description: 'Lowercase match strings (name is always auto-included)' }),
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
    show_on_timeline: z
      .boolean()
      .optional()
      .meta({ description: 'Whether to show on the timeline (defaults to true)' }),
  })
  .meta({ id: 'AddActivityTypeDefinitionBody' })

export type AddActivityTypeDefinitionBody = z.infer<typeof addActivityTypeDefinitionBodySchema>

/**
 * Update activity type definition request body.
 */
export const updateActivityTypeDefinitionBodySchema = z
  .object({
    aliases: z
      .array(z.string())
      .optional()
      .meta({ description: 'Replace aliases (name is always auto-included)' }),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional()
      .meta({ description: 'New hex color' }),
    display_category: displayCategorySchema.optional().meta({ description: 'New display category' }),
    display_name: z.string().optional().meta({ description: 'New display name' }),
    icon: z.string().nullable().optional().meta({ description: 'New icon (null to clear)' }),
    show_on_timeline: z.boolean().optional().meta({ description: 'Whether to show on the timeline' }),
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

// =============================================================================
// Merge Activity Type
// =============================================================================

const activityTypeNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .meta({ description: 'Activity type name (snake_case)' })

/**
 * Merge a custom activity type into another activity type (built-in or custom).
 * All activities are reassigned; aliases are merged; the source definition is deleted.
 */
export const mergeActivityTypeBodySchema = z
  .object({
    source: activityTypeNameSchema.meta({ description: 'Custom activity type to merge away' }),
    target: activityTypeNameSchema.meta({ description: 'Target activity type to merge into' }),
  })
  .meta({ id: 'MergeActivityTypeBody' })

export type MergeActivityTypeBody = z.infer<typeof mergeActivityTypeBodySchema>

/**
 * Merge activity type response.
 */
export const mergeActivityTypeResponseSchema = baseResponseSchema
  .extend({
    activities_reassigned: z
      .number()
      .int()
      .optional()
      .meta({ description: 'Number of activities moved to the target type' }),
    deduction_rules_updated: z
      .number()
      .int()
      .optional()
      .meta({ description: 'Number of deduction rules updated to reference the target type' }),
    target: activityTypeDefinitionSchema.optional().meta({ description: 'Updated target definition' }),
  })
  .meta({ id: 'MergeActivityTypeResponse' })

export type MergeActivityTypeResponse = z.infer<typeof mergeActivityTypeResponseSchema>
