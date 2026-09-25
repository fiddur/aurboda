/** Rules that automatically create activities from data conditions. */
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

const matchModeSchema = z.enum(['exact', 'contains'])

export const activityConditionSchema = z
  .object({
    activity_type: activityTypeSchema,
    data_filters: z
      .array(dataFilterSchema)
      .optional()
      .meta({ description: 'Optional data field filters — all must match (AND logic)' }),
    kind: z.literal('activity'),
    match_mode: matchModeSchema
      .optional()
      .meta({ description: 'Case-insensitive match mode for title (default contains)' }),
    title: z.string().optional().meta({ description: 'Activity title to match (per match_mode)' }),
  })
  .meta({
    description:
      'Matches time ranges where an activity of the given type exists, optionally filtered by data fields and title',
  })

export type ActivityCondition = z.infer<typeof activityConditionSchema>

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
    match_mode: matchModeSchema.default('exact').meta({ description: 'Case-insensitive match mode' }),
    track: z.string().optional().meta({ description: 'Track name to match' }),
  })
  .meta({ description: 'Matches time ranges from Last.fm scrobbles by artist/track name' })

export const mediaConditionSchema = z
  .object({
    artist: z
      .array(z.string())
      .optional()
      .meta({ description: 'Artist name(s) to match (any of, per match_mode)' }),
    kind: z.literal('media'),
    match_mode: matchModeSchema
      .default('contains')
      .meta({ description: 'Case-insensitive match mode for title and artist' }),
    min_played_ratio: z.number().gt(0).max(1).optional().meta({
      description:
        'Minimum played_secs / track_secs. Skipped when the play has no known track length (Last.fm, some mpv plays).',
    }),
    min_played_secs: z.number().positive().optional().meta({
      description: 'Minimum seconds actually played. Plays without played_secs (Last.fm) never pass.',
    }),
    player: z
      .array(z.string())
      .optional()
      .meta({ description: 'Player name(s) to match exactly, case-insensitive (e.g. "firefox", "mpv")' }),
    title: z.string().optional().meta({ description: 'Title to match (per match_mode)' }),
    url_host: z.array(z.string()).optional().meta({
      description:
        'URL host(s) to match (any of). Matches the host itself or any subdomain, case-insensitive (www.example.com matches example.com).',
    }),
  })
  .meta({
    description:
      'Matches time ranges of media plays (MPRIS pushes and non-duplicate Last.fm scrobbles) by host, title, artist, player and how much was played',
  })

export type MediaCondition = z.infer<typeof mediaConditionSchema>

export const conditionSchema = z.discriminatedUnion('kind', [
  activityConditionSchema,
  screentimeCategoryConditionSchema,
  activityDataConditionSchema,
  locationConditionSchema,
  afterDateConditionSchema,
  scrobbleConditionSchema,
  mediaConditionSchema,
])

export type Condition = z.infer<typeof conditionSchema>

export const outputMediaFieldSchema = z
  .object({
    field: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .meta({
        description: 'Activity data field to write the play title into (snake_case), e.g. "session_name"',
      }),
    strip_pattern: z.string().max(200).optional().meta({
      description:
        'JavaScript regular expression (flags "giu", at most 200 characters); every match is removed from the title before writing, then whitespace is collapsed and trimmed',
    }),
  })
  .meta({
    id: 'OutputMediaField',
    description:
      'Enrich mode only, with at least one media condition: copy the title of the longest matching play overlapping each enriched activity into a data field',
  })

export type OutputMediaField = z.infer<typeof outputMediaFieldSchema>

export const deductionRuleModeSchema = z.enum(['create', 'enrich', 'retype']).meta({
  id: 'DeductionRuleMode',
  description:
    'Whether to create new activities, enrich existing ones, or change the type of the activities the rule\'s single "activity" condition matches',
})

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
      description:
        'create (default): create new activities. enrich: patch data onto existing activities. retype: change the matched activities to output_activity_type.',
    }),
    name: z.string().meta({ description: 'Human-readable rule name' }),
    output_activity_type: activityTypeSchema.meta({
      description:
        'In create mode: activity type to create. In enrich mode: activity type to patch data onto. In retype mode: the new type.',
    }),
    output_data: z.record(z.string(), z.unknown()).optional().meta({
      description:
        'Static data fields to set on created activities; enrich and retype only fill missing fields',
    }),
    output_media_field: outputMediaFieldSchema.optional(),
    output_title: z.string().optional().meta({
      description:
        'Optional title for created activities; in retype mode, replaces the retyped activity title',
    }),
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
      .meta({ description: 'create (default), enrich existing activities, or retype them' }),
    name: z.string().meta({ description: 'Human-readable rule name' }),
    output_activity_type: activityTypeSchema.meta({
      description:
        'In create mode: type to create. In enrich mode: type to patch data onto. In retype mode: the new type.',
    }),
    output_data: z.record(z.string(), z.unknown()).optional().meta({
      description: 'Static data fields for created activities; enrich and retype only fill missing fields',
    }),
    output_media_field: outputMediaFieldSchema.optional(),
    output_title: z.string().optional().meta({
      description:
        'Optional title for created activities; in retype mode, replaces the retyped activity title',
    }),
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
    output_media_field: outputMediaFieldSchema
      .nullable()
      .optional()
      .meta({ description: 'New play-title enrichment (null to clear)' }),
    output_title: z.string().nullable().optional().meta({ description: 'New title (null to remove)' }),
    priority: z.number().int().min(0).max(2).optional().meta({ description: 'New priority' }),
  })
  .meta({ id: 'UpdateDeductionRuleBody' })

export type UpdateDeductionRuleBody = z.infer<typeof updateDeductionRuleBodySchema>

export const deductionRulesResponseSchema = createDataArrayResponseSchema(deductionRuleSchema).meta({
  id: 'DeductionRulesResponse',
})

export type DeductionRulesResponse = z.infer<typeof deductionRulesResponseSchema>

export const deductionRuleResponseSchema = baseResponseSchema
  .extend({
    data: deductionRuleSchema.optional(),
  })
  .meta({ id: 'DeductionRuleResponse' })

export type DeductionRuleResponse = z.infer<typeof deductionRuleResponseSchema>

export const evaluateDeductionRulesResponseSchema = baseResponseSchema
  .extend({
    activities_created: z.number().int().optional(),
    rules_evaluated: z.number().int().optional(),
  })
  .meta({ id: 'EvaluateDeductionRulesResponse' })

export type EvaluateDeductionRulesResponse = z.infer<typeof evaluateDeductionRulesResponseSchema>

/** Dry-run showing how many activities would be affected. */
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
