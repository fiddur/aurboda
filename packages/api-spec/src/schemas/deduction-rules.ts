/**
 * Deduction rule schemas — rules that automatically create activities from data conditions.
 */
import { z } from 'zod'

import { activityTypeSchema, baseResponseSchema, createDataArrayResponseSchema } from './common.ts'

/**
 * Condition kinds for deduction rules.
 * Each condition resolves to time ranges; multiple conditions are AND-ed (must overlap).
 */
export const dataFilterSchema = z.object({
  field: z.string().meta({ description: 'Data field key to match on' }),
  operator: z.enum(['eq', 'neq', 'exists', 'not_exists']).meta({ description: 'Comparison operator' }),
  value: z
    .union([z.string(), z.number(), z.boolean()])
    .optional()
    .meta({ description: 'Value to compare against (required for eq/neq)' }),
})

export type DataFilter = z.infer<typeof dataFilterSchema>

export const activityConditionSchema = z
  .object({
    activity_type: activityTypeSchema,
    data_filters: z
      .array(dataFilterSchema)
      .optional()
      .meta({ description: 'Optional data field filters — all must match (AND logic)' }),
    kind: z.literal('activity'),
  })
  .meta({
    description:
      'Matches time ranges where an activity of the given type exists, optionally filtered by data fields',
  })

export const screentimeCategoryConditionSchema = z
  .object({
    category: z.array(z.string()).min(1),
    kind: z.literal('screentime_category'),
  })
  .meta({ description: 'Matches time ranges of productivity records in the given category path' })

export const activityDataConditionSchema = z
  .object({
    activity_type: activityTypeSchema,
    field: z.string().meta({ description: 'Data field key to match on' }),
    kind: z.literal('activity_data'),
    operator: z.enum(['eq', 'neq', 'exists', 'not_exists']).meta({
      description: 'Comparison operator (eq/neq require value; exists/not_exists do not)',
    }),
    value: z
      .union([z.string(), z.number(), z.boolean()])
      .optional()
      .meta({ description: 'Value to compare against (required for eq/neq)' }),
  })
  .meta({ description: 'Matches time ranges where an activity has a specific data field value' })

export const locationConditionSchema = z
  .object({
    kind: z.literal('location'),
    location_name: z.string().meta({ description: 'Named location name to match' }),
  })
  .meta({ description: 'Matches time ranges where the user is at a named location' })

export const afterDateConditionSchema = z
  .object({
    date: z.string().meta({ description: 'ISO 8601 date (e.g. "2024-06-01") — only match after this date' }),
    kind: z.literal('after_date'),
  })
  .meta({ description: 'Restricts matches to after a given date' })

export const scrobbleConditionSchema = z
  .object({
    artist: z.array(z.string()).optional().meta({ description: 'Artist name(s) to match (any of)' }),
    duration_seconds: z
      .number()
      .int()
      .positive()
      .meta({ description: 'Duration each matching scrobble covers (seconds)' }),
    kind: z.literal('scrobble'),
    match_mode: z
      .enum(['exact', 'contains'])
      .default('exact')
      .meta({ description: 'Case-insensitive match mode' }),
    track: z.string().optional().meta({ description: 'Track name to match' }),
  })
  .meta({ description: 'Matches time ranges from Last.fm scrobbles by artist/track name' })

export const conditionSchema = z.discriminatedUnion('kind', [
  activityConditionSchema,
  screentimeCategoryConditionSchema,
  activityDataConditionSchema,
  locationConditionSchema,
  afterDateConditionSchema,
  scrobbleConditionSchema,
])

export type Condition = z.infer<typeof conditionSchema>

/**
 * Deduction rule schema.
 */
export const deductionRuleModeSchema = z
  .enum(['create', 'enrich'])
  .meta({ id: 'DeductionRuleMode', description: 'Whether to create new activities or enrich existing ones' })

export type DeductionRuleMode = z.infer<typeof deductionRuleModeSchema>

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
    mode: deductionRuleModeSchema.optional().meta({
      description: 'create (default): create new activities. enrich: patch data onto existing activities.',
    }),
    name: z.string().meta({ description: 'Human-readable rule name' }),
    output_activity_type: activityTypeSchema.meta({
      description:
        'In create mode: activity type to create. In enrich mode: activity type to patch data onto.',
    }),
    output_data: z
      .record(z.string(), z.unknown())
      .optional()
      .meta({ description: 'Static data fields to set on created/enriched activities' }),
    output_title: z.string().optional().meta({ description: 'Optional title for created activities' }),
    priority: z
      .number()
      .int()
      .min(0)
      .max(2)
      .meta({ description: 'Evaluation order (0=first, max 2 for chaining)' }),
  })
  .meta({
    id: 'DeductionRule',
    description: 'Rule that creates or enriches activities when data conditions are met',
  })

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
    mode: deductionRuleModeSchema
      .optional()
      .meta({ description: 'create (default) or enrich existing activities' }),
    name: z.string().meta({ description: 'Human-readable rule name' }),
    output_activity_type: activityTypeSchema.meta({
      description: 'In create mode: type to create. In enrich mode: type to patch data onto.',
    }),
    output_data: z
      .record(z.string(), z.unknown())
      .optional()
      .meta({ description: 'Static data fields for created/enriched activities' }),
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
    mode: deductionRuleModeSchema.optional().meta({ description: 'New mode' }),
    name: z.string().optional().meta({ description: 'New name' }),
    output_activity_type: activityTypeSchema.optional().meta({ description: 'New output activity type' }),
    output_data: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional()
      .meta({ description: 'New output data (null to clear)' }),
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

/**
 * Preview deduction rule response — dry-run showing how many activities would be affected.
 */
export const previewDeductionRuleResponseSchema = baseResponseSchema
  .extend({
    would_affect: z
      .number()
      .int()
      .meta({ description: 'Number of activities that would be created or enriched' }),
    sample_days: z.number().int().meta({ description: 'Number of days sampled in preview' }),
  })
  .meta({ id: 'PreviewDeductionRuleResponse' })

export type PreviewDeductionRuleResponse = z.infer<typeof previewDeductionRuleResponseSchema>
