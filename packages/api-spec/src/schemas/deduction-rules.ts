/**
 * Deduction rule schemas — rules that automatically create activities from data conditions.
 */
import { z } from 'zod'

import { activityTypeSchema, baseResponseSchema, createDataArrayResponseSchema } from './common.ts'

/**
 * Condition kinds for deduction rules.
 * Each condition resolves to time ranges; multiple conditions are AND-ed (must overlap).
 */
export const activityConditionSchema = z
  .object({
    activity_type: activityTypeSchema,
    kind: z.literal('activity'),
  })
  .meta({ description: 'Matches time ranges where an activity of the given type exists' })

export const tagConditionSchema = z
  .object({
    kind: z.literal('tag'),
    tag_name: z.string(),
  })
  .meta({ description: 'Matches time ranges where a tag with the given name exists' })

export const screentimeCategoryConditionSchema = z
  .object({
    category: z.array(z.string()).min(1),
    kind: z.literal('screentime_category'),
  })
  .meta({ description: 'Matches time ranges of productivity records in the given category path' })

export const conditionSchema = z.discriminatedUnion('kind', [
  activityConditionSchema,
  tagConditionSchema,
  screentimeCategoryConditionSchema,
])

export type Condition = z.infer<typeof conditionSchema>

/**
 * Deduction rule schema.
 */
export const deductionRuleSchema = z
  .object({
    conditions: z
      .array(conditionSchema)
      .min(1)
      .meta({ description: 'Conditions that must all overlap in time' }),
    created_at: z.string().optional(),
    enabled: z.boolean().meta({ description: 'Whether the rule is active' }),
    id: z.string().uuid(),
    merge_gap_seconds: z
      .number()
      .int()
      .optional()
      .meta({ description: 'Coalesce nearby matches within this gap' }),
    name: z.string().meta({ description: 'Human-readable rule name' }),
    output_activity_type: activityTypeSchema.meta({
      description: 'Activity type to create when conditions match',
    }),
    output_title: z.string().optional().meta({ description: 'Optional title for created activities' }),
    priority: z
      .number()
      .int()
      .min(0)
      .max(2)
      .meta({ description: 'Evaluation order (0=first, max 2 for chaining)' }),
  })
  .meta({ id: 'DeductionRule', description: 'Rule that creates activities when data conditions are met' })

export type DeductionRule = z.infer<typeof deductionRuleSchema>

/**
 * Add deduction rule request body.
 */
export const addDeductionRuleBodySchema = z
  .object({
    conditions: z
      .array(conditionSchema)
      .min(1)
      .meta({ description: 'Conditions that must all overlap in time' }),
    enabled: z.boolean().optional().meta({ description: 'Whether the rule is active (defaults to true)' }),
    merge_gap_seconds: z
      .number()
      .int()
      .positive()
      .optional()
      .meta({ description: 'Coalesce nearby matches within this gap (seconds)' }),
    name: z.string().meta({ description: 'Human-readable rule name' }),
    output_activity_type: activityTypeSchema.meta({ description: 'Activity type to create' }),
    output_title: z.string().optional().meta({ description: 'Optional title for created activities' }),
    priority: z
      .number()
      .int()
      .min(0)
      .max(2)
      .optional()
      .meta({ description: 'Evaluation order (0=first, max 2). Defaults to 0.' }),
  })
  .meta({ id: 'AddDeductionRuleBody' })

export type AddDeductionRuleBody = z.infer<typeof addDeductionRuleBodySchema>

/**
 * Update deduction rule request body.
 */
export const updateDeductionRuleBodySchema = z
  .object({
    conditions: z.array(conditionSchema).min(1).optional().meta({ description: 'New conditions' }),
    enabled: z.boolean().optional().meta({ description: 'Enable/disable the rule' }),
    merge_gap_seconds: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional()
      .meta({ description: 'New merge gap (null to remove)' }),
    name: z.string().optional().meta({ description: 'New name' }),
    output_activity_type: activityTypeSchema.optional().meta({ description: 'New output activity type' }),
    output_title: z.string().nullable().optional().meta({ description: 'New title (null to remove)' }),
    priority: z.number().int().min(0).max(2).optional().meta({ description: 'New priority' }),
  })
  .meta({ id: 'UpdateDeductionRuleBody' })

export type UpdateDeductionRuleBody = z.infer<typeof updateDeductionRuleBodySchema>

/**
 * Deduction rules list response.
 */
export const deductionRulesResponseSchema = createDataArrayResponseSchema(deductionRuleSchema).meta({
  id: 'DeductionRulesResponse',
})

export type DeductionRulesResponse = z.infer<typeof deductionRulesResponseSchema>

/**
 * Single deduction rule response.
 */
export const deductionRuleResponseSchema = baseResponseSchema
  .extend({
    data: deductionRuleSchema.optional(),
  })
  .meta({ id: 'DeductionRuleResponse' })

export type DeductionRuleResponse = z.infer<typeof deductionRuleResponseSchema>

/**
 * Evaluate deduction rules response.
 */
export const evaluateDeductionRulesResponseSchema = baseResponseSchema
  .extend({
    activities_created: z.number().int().optional(),
    rules_evaluated: z.number().int().optional(),
  })
  .meta({ id: 'EvaluateDeductionRulesResponse' })

export type EvaluateDeductionRulesResponse = z.infer<typeof evaluateDeductionRulesResponseSchema>
