/**
 * Auto-share rules (#903): "share runs longer than 15 minutes automatically."
 *
 * A rule combines a **predicate** over a settled activity (type set, min/max
 * duration, min distance, source) with a **share template** — exactly the
 * fields of a manual share. Rules are **off by default**: auto-publishing
 * physiological/location data is sensitive, so enabling one is a deliberate
 * act, and enabling only affects activities that arrive AFTER the enable
 * (`enabled_at` gates evaluation; nothing is shared retroactively).
 */
import { z } from 'zod'

import { baseResponseSchema, iso8601DateTimeSchema, metricTypeSchema } from './common.ts'
import { feedPostMessageMaxLength, feedVisibilitySchema } from './feed.ts'

/** A scalar-summary metric key (e.g. `duration`, `distance`, `heart_rate_avg`). */
const scalarMetricKeySchema = z.string().min(1).max(64)

/** The predicate + share-template fields shared by the rule, its add body, and its preview body. */
const autoshareRuleFields = {
  activity_types: z.array(z.string().min(1).max(64)).max(32).default([]).meta({
    description: 'Activity types the rule matches (e.g. `running`); empty matches any type',
  }),
  include_chart: z
    .boolean()
    .default(false)
    .meta({ description: 'Attach the rendered heart-rate chart image to auto-created posts' }),
  include_map: z
    .boolean()
    .default(false)
    .meta({ description: 'Attach the rendered route-map image to auto-created posts' }),
  included_metrics: z
    .array(scalarMetricKeySchema)
    .max(64)
    .default([])
    .meta({ description: 'Scalar-summary metric keys the auto-created post shares' }),
  max_duration_seconds: z
    .number()
    .int()
    .positive()
    .optional()
    .meta({ description: 'Match only activities at most this long (merged span)' }),
  message: z.string().max(feedPostMessageMaxLength).optional().meta({
    description: 'Fixed personal message for auto-created posts (plain text); absent shares no text',
  }),
  min_distance_meters: z
    .number()
    .positive()
    .optional()
    .meta({ description: 'Match only activities covering at least this distance' }),
  min_duration_seconds: z
    .number()
    .int()
    .positive()
    .optional()
    .meta({ description: 'Match only activities at least this long (merged span)' }),
  name: z.string().min(1).max(255).meta({ description: 'Rule name' }),
  series_metrics: z.array(metricTypeSchema).max(64).default([]).meta({
    description: 'High-resolution series the auto-created post explicitly shares (off unless listed)',
  }),
  source: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .meta({ description: 'Match only activities from this source (e.g. `garmin`)' }),
  visibility: feedVisibilitySchema.default('followers'),
}

/** An auto-share rule as stored. */
export const autoshareRuleSchema = z
  .object({
    ...autoshareRuleFields,
    created_at: iso8601DateTimeSchema.meta({ description: 'Creation timestamp (ISO 8601)' }),
    // On read, stored keys are plain strings (like FeedPost.series_metrics) —
    // the WRITE bodies validate them against the metric-type enum.
    series_metrics: z
      .array(z.string())
      .meta({ description: 'High-resolution series the auto-created post explicitly shares' }),
    enabled: z.boolean().meta({ description: 'Whether the rule is active (rules start disabled)' }),
    enabled_at: iso8601DateTimeSchema.nullable().meta({
      description:
        'When the rule was last enabled — only activities ingested after this are ever auto-shared',
    }),
    id: z.string().uuid().meta({ description: 'Rule ID' }),
    updated_at: iso8601DateTimeSchema.meta({ description: 'Last update timestamp (ISO 8601)' }),
  })
  .meta({ id: 'AutoshareRule' })

export type AutoshareRule = z.infer<typeof autoshareRuleSchema>

/**
 * Body for creating an auto-share rule. Always created DISABLED — enabling is a
 * separate, deliberate update so the UI can state what will leave the instance.
 */
export const addAutoshareRuleBodySchema = z.object(autoshareRuleFields).meta({ id: 'AddAutoshareRuleBody' })

export type AddAutoshareRuleBody = z.infer<typeof addAutoshareRuleBodySchema>

/** Body for updating an auto-share rule (all fields optional; `enabled: true` stamps `enabled_at`). */
export const updateAutoshareRuleBodySchema = z
  .object({
    activity_types: autoshareRuleFields.activity_types.removeDefault().optional(),
    enabled: z.boolean().optional().meta({ description: 'Enable/disable the rule' }),
    include_chart: z.boolean().optional(),
    include_map: z.boolean().optional(),
    included_metrics: z.array(scalarMetricKeySchema).max(64).optional(),
    max_duration_seconds: z.number().int().positive().nullable().optional(),
    message: z.string().max(feedPostMessageMaxLength).nullable().optional(),
    min_distance_meters: z.number().positive().nullable().optional(),
    min_duration_seconds: z.number().int().positive().nullable().optional(),
    name: z.string().min(1).max(255).optional(),
    series_metrics: z.array(metricTypeSchema).max(64).optional(),
    source: z.string().min(1).max(64).nullable().optional(),
    visibility: feedVisibilitySchema.optional(),
  })
  .meta({ id: 'UpdateAutoshareRuleBody' })

export type UpdateAutoshareRuleBody = z.infer<typeof updateAutoshareRuleBodySchema>

/** Response wrapping the user's auto-share rules. */
export const autoshareRulesResponseSchema = baseResponseSchema
  .extend({
    post_counts: z.record(z.string(), z.number().int()).optional().meta({
      description: 'How many posts each rule has auto-created, keyed by rule id (the audit trail counts)',
    }),
    rules: z.array(autoshareRuleSchema),
  })
  .meta({ id: 'AutoshareRulesResponse' })

export type AutoshareRulesResponse = z.infer<typeof autoshareRulesResponseSchema>

/** Response wrapping a single auto-share rule. */
export const autoshareRuleResponseSchema = baseResponseSchema
  .extend({ rule: autoshareRuleSchema.optional() })
  .meta({ id: 'AutoshareRuleResponse' })

export type AutoshareRuleResponse = z.infer<typeof autoshareRuleResponseSchema>

/**
 * Response for the rule preview: how many settled activities in the sample
 * window WOULD have matched the predicate (regardless of shared status) —
 * shown before enabling, so the user knows what a rule reaches.
 */
export const previewAutoshareRuleResponseSchema = baseResponseSchema
  .extend({
    sample_days: z.number().int().optional().meta({ description: 'Days sampled backwards from now' }),
    would_match: z
      .number()
      .int()
      .optional()
      .meta({ description: 'Activities (merge groups) the predicate would have matched' }),
  })
  .meta({ id: 'PreviewAutoshareRuleResponse' })

export type PreviewAutoshareRuleResponse = z.infer<typeof previewAutoshareRuleResponseSchema>
