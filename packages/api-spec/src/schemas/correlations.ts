/**
 * Correlation analysis schemas.
 */

import { z } from 'zod'
import { createDataResponseSchema } from './common.js'

// ============================================================================
// Common schemas
// ============================================================================

/** HRV statistics schema */
export const hrvStatsSchema = z
  .object({
    mean_hr: z.number().nullable().meta({ description: 'Mean heart rate during period' }),
    mean_hrv: z.number().nullable().meta({ description: 'Mean HRV (RMSSD) during period' }),
    sample_count: z.number().int().meta({ description: 'Number of data samples' }),
    sample_minutes: z.number().meta({ description: 'Total minutes of data' }),
    stddev_hr: z.number().nullable().meta({ description: 'Standard deviation of HR' }),
    stddev_hrv: z.number().nullable().meta({ description: 'Standard deviation of HRV' }),
  })
  .meta({ id: 'HrvStats' })

export type HrvStats = z.infer<typeof hrvStatsSchema>

/** HRV stats with baseline delta */
export const hrvStatsWithDeltaSchema = hrvStatsSchema
  .extend({
    hr_delta_from_baseline: z.number().nullable().meta({ description: 'HR change from baseline' }),
    hrv_delta_from_baseline: z.number().nullable().meta({ description: 'HRV change from baseline' }),
  })
  .meta({ id: 'HrvStatsWithDelta' })

export type HrvStatsWithDelta = z.infer<typeof hrvStatsWithDeltaSchema>

// ============================================================================
// Baseline endpoint
// ============================================================================

/** Baseline query parameters */
export const baselineQuerySchema = z
  .object({
    reference_date: z.string().optional().meta({
      description: 'Reference date for baseline calculation (defaults to today)',
      example: '2024-01-15',
    }),
  })
  .meta({ id: 'BaselineQuery' })

export type BaselineQuery = z.infer<typeof baselineQuerySchema>

/** Baseline result data */
export const baselineDataSchema = z
  .object({
    hrv: z.object({
      avg7day: z.number().nullable(),
      avg30day: z.number().nullable(),
      trend_percent: z.number().nullable().meta({ description: 'Change from previous 30-day period' }),
    }),
    period: z.object({
      end: z.string(),
      start: z.string(),
    }),
    resting_hr: z.object({
      avg7day: z.number().nullable(),
      avg30day: z.number().nullable(),
      trend_percent: z.number().nullable(),
    }),
  })
  .meta({ id: 'BaselineData' })

export type BaselineData = z.infer<typeof baselineDataSchema>

/** Baseline response */
export const baselineResponseSchema = createDataResponseSchema(baselineDataSchema).meta({
  id: 'BaselineResponse',
})

export type BaselineResponse = z.infer<typeof baselineResponseSchema>

// ============================================================================
// HRV-Activities endpoint
// ============================================================================

/** HRV-Activities query parameters */
export const hrvActivitiesQuerySchema = z
  .object({
    period_days: z
      .string()
      .optional()
      .meta({ description: 'Number of days to analyze (default 30)', example: '30' }),
  })
  .meta({ id: 'HrvActivitiesQuery' })

export type HrvActivitiesQuery = z.infer<typeof hrvActivitiesQuerySchema>

/** Productivity correlation */
export const productivityCorrelationSchema = hrvStatsWithDeltaSchema
  .extend({
    category: z.string().meta({ description: 'RescueTime category name' }),
    correlation_coefficient: z.number().nullable().meta({ description: 'Pearson correlation (-1 to 1)' }),
  })
  .meta({ id: 'ProductivityCorrelation' })

export type ProductivityCorrelation = z.infer<typeof productivityCorrelationSchema>

/** Location correlation */
export const locationCorrelationSchema = hrvStatsWithDeltaSchema
  .extend({
    location_name: z.string().meta({ description: 'Location name' }),
    visit_count: z.number().int().meta({ description: 'Number of visits' }),
  })
  .meta({ id: 'LocationCorrelation' })

export type LocationCorrelation = z.infer<typeof locationCorrelationSchema>

/** Activity correlation */
export const activityCorrelationSchema = hrvStatsWithDeltaSchema
  .extend({
    activity_type: z.string().meta({ description: 'Activity type (exercise, meditation, etc.)' }),
    avg_duration_min: z.number().meta({ description: 'Average duration in minutes' }),
    occurrences: z.number().int().meta({ description: 'Number of occurrences' }),
  })
  .meta({ id: 'ActivityCorrelation' })

export type ActivityCorrelation = z.infer<typeof activityCorrelationSchema>

/** Tag correlation */
export const tagCorrelationSchema = hrvStatsWithDeltaSchema
  .extend({
    occurrences: z.number().int().meta({ description: 'Number of occurrences' }),
    tag: z.string().meta({ description: 'Tag name' }),
  })
  .meta({ id: 'TagCorrelation' })

export type TagCorrelation = z.infer<typeof tagCorrelationSchema>

/** HRV-Activities result data */
export const hrvActivitiesDataSchema = z
  .object({
    baseline: hrvStatsSchema,
    correlations: z.object({
      activities: z.array(activityCorrelationSchema),
      locations: z.array(locationCorrelationSchema),
      productivity: z.array(productivityCorrelationSchema),
      tags: z.array(tagCorrelationSchema),
    }),
    period: z.object({
      days: z.number().int(),
      end: z.string(),
      start: z.string(),
    }),
  })
  .meta({ id: 'HrvActivitiesData' })

export type HrvActivitiesData = z.infer<typeof hrvActivitiesDataSchema>

/** HRV-Activities response */
export const hrvActivitiesResponseSchema = createDataResponseSchema(hrvActivitiesDataSchema).meta({
  id: 'HrvActivitiesResponse',
})

export type HrvActivitiesResponse = z.infer<typeof hrvActivitiesResponseSchema>

// ============================================================================
// Activity Impact endpoint
// ============================================================================

/** Activity type enum for impact analysis */
export const activityImpactTypeSchema = z
  .enum(['productivity_category', 'productivity_app', 'location', 'tag', 'activity_type'])
  .meta({
    description: 'Type of activity to analyze',
    example: 'productivity_category',
    id: 'ActivityImpactType',
  })

export type ActivityImpactType = z.infer<typeof activityImpactTypeSchema>

/** Activity Impact query parameters */
export const activityImpactQuerySchema = z
  .object({
    activity_type: activityImpactTypeSchema,
    period_days: z.string().optional().meta({ description: 'Days to analyze (default 90)', example: '90' }),
    window_minutes: z
      .string()
      .optional()
      .meta({ description: 'Minutes before/after (default 30)', example: '30' }),
  })
  .meta({ id: 'ActivityImpactQuery' })

export type ActivityImpactQuery = z.infer<typeof activityImpactQuerySchema>

/** Time window stats */
export const timeWindowStatsSchema = z
  .object({
    mean: z.number().nullable(),
    sample_count: z.number().int(),
    stddev: z.number().nullable(),
  })
  .meta({ id: 'TimeWindowStats' })

export type TimeWindowStats = z.infer<typeof timeWindowStatsSchema>

/** Activity Impact result data */
export const activityImpactDataSchema = z
  .object({
    activity: z.string().meta({ description: 'Activity name/pattern searched' }),
    activity_type: activityImpactTypeSchema,
    avg_duration_min: z.number().meta({ description: 'Average duration in minutes' }),
    hr_timeline: z.object({
      after15min: timeWindowStatsSchema,
      after30min: timeWindowStatsSchema,
      before15min: timeWindowStatsSchema,
      before30min: timeWindowStatsSchema,
      during: timeWindowStatsSchema,
    }),
    hrv_timeline: z.object({
      after15min: timeWindowStatsSchema,
      after30min: timeWindowStatsSchema,
      before15min: timeWindowStatsSchema,
      before30min: timeWindowStatsSchema,
      during: timeWindowStatsSchema,
    }),
    occurrences: z.number().int().meta({ description: 'Number of activity occurrences found' }),
  })
  .meta({ id: 'ActivityImpactData' })

export type ActivityImpactData = z.infer<typeof activityImpactDataSchema>

/** Activity Impact response */
export const activityImpactResponseSchema = createDataResponseSchema(activityImpactDataSchema).meta({
  id: 'ActivityImpactResponse',
})

export type ActivityImpactResponse = z.infer<typeof activityImpactResponseSchema>

// ============================================================================
// Event Probability endpoint
// ============================================================================

/** Event trigger type */
export const eventTriggerTypeSchema = z.enum(['activity', 'tag']).meta({
  description: 'Type of trigger event',
  example: 'activity',
  id: 'EventTriggerType',
})

export type EventTriggerType = z.infer<typeof eventTriggerTypeSchema>

/** Event Probability request body */
export const eventProbabilityBodySchema = z
  .object({
    lag_windows: z
      .array(z.string())
      .optional()
      .meta({ description: 'Time windows to analyze', example: ['12h', '24h', '36h', '48h'] }),
    outcome_pattern: z
      .string()
      .meta({ description: 'Regex pattern for outcome tag', example: 'painkiller|headache' }),
    period_days: z
      .number()
      .int()
      .optional()
      .meta({ description: 'Days to analyze (default 365)', example: 365 }),
    trigger_type: eventTriggerTypeSchema,
    trigger_value: z
      .string()
      .meta({ description: 'Trigger activity type or tag pattern', example: 'exercise' }),
  })
  .meta({ id: 'EventProbabilityBody' })

export type EventProbabilityBody = z.infer<typeof eventProbabilityBodySchema>

/** Lag window result */
export const lagWindowResultSchema = z
  .object({
    occurrences: z.number().int(),
    probability: z.number().meta({ description: 'P(outcome | trigger)' }),
    relative_risk: z.number().meta({ description: 'Risk ratio compared to baseline' }),
  })
  .meta({ id: 'LagWindowResult' })

export type LagWindowResult = z.infer<typeof lagWindowResultSchema>

/** Event Probability result data */
export const eventProbabilityDataSchema = z
  .object({
    baseline: z.object({
      description: z.string(),
      probability: z.number(),
    }),
    outcome: z.object({
      pattern: z.string(),
      type: z.literal('tag'),
    }),
    period: z.object({
      end: z.string(),
      start: z.string(),
    }),
    post_trigger: z.record(z.string(), lagWindowResultSchema).meta({
      description: 'Probability for each lag window',
    }),
    sample_size: z.object({
      days_analyzed: z.number().int(),
      outcome_events: z.number().int(),
      trigger_events: z.number().int(),
    }),
    statistical_significance: z.object({
      chi_squared: z.number().nullable(),
      p_value: z.number().nullable(),
    }),
    trigger: z.object({
      type: eventTriggerTypeSchema,
      value: z.string(),
    }),
  })
  .meta({ id: 'EventProbabilityData' })

export type EventProbabilityData = z.infer<typeof eventProbabilityDataSchema>

/** Event Probability response */
export const eventProbabilityResponseSchema = createDataResponseSchema(eventProbabilityDataSchema).meta({
  id: 'EventProbabilityResponse',
})

export type EventProbabilityResponse = z.infer<typeof eventProbabilityResponseSchema>

// ============================================================================
// Generic Correlation endpoint
// ============================================================================

/** Trigger condition type */
export const triggerConditionTypeSchema = z
  .enum(['activity', 'tag', 'productivity_category', 'productivity_app'])
  .meta({
    description: 'Type of trigger event',
    example: 'tag',
    id: 'TriggerConditionType',
  })

export type TriggerConditionType = z.infer<typeof triggerConditionTypeSchema>

/** Trigger condition schema */
export const triggerConditionSchema = z
  .object({
    min_count: z.number().int().optional().meta({
      description: 'Minimum occurrences within the window (default: 1)',
      example: 3,
    }),
    pattern: z.string().meta({
      description: 'Pattern to match (regex for tags, exact match for activity types)',
      example: 'meditation',
    }),
    type: triggerConditionTypeSchema,
    window_days: z.number().int().optional().meta({
      description: 'Rolling window in days for counting occurrences (default: 1)',
      example: 7,
    }),
  })
  .meta({ id: 'TriggerCondition' })

export type TriggerCondition = z.infer<typeof triggerConditionSchema>

/** Tag outcome schema */
export const tagOutcomeSchema = z
  .object({
    pattern: z.string().meta({ description: 'Regex pattern for outcome tag', example: 'headache|migraine' }),
    type: z.literal('tag'),
  })
  .meta({ id: 'TagOutcome' })

export type TagOutcome = z.infer<typeof tagOutcomeSchema>

/** Metric outcome schema */
export const metricOutcomeSchema = z
  .object({
    aggregation: z
      .enum(['mean', 'min', 'max', 'last'])
      .optional()
      .meta({ description: 'Aggregation method (default: mean)' }),
    metric: z
      .string()
      .meta({ description: 'Metric name (e.g., weight, body_fat, hrv_rmssd)', example: 'weight' }),
    type: z.literal('metric'),
  })
  .meta({ id: 'MetricOutcome' })

export type MetricOutcome = z.infer<typeof metricOutcomeSchema>

/** Productivity outcome schema */
export const productivityOutcomeSchema = z
  .object({
    app: z.string().optional().meta({ description: 'Specific app to measure time in', example: 'vscode' }),
    category: z.string().optional().meta({
      description: 'Category to measure time in',
      example: 'Software Development',
    }),
    type: z.literal('productivity'),
  })
  .meta({ id: 'ProductivityOutcome' })

export type ProductivityOutcome = z.infer<typeof productivityOutcomeSchema>

/** Outcome configuration (discriminated union) */
export const outcomeConfigSchema = z.discriminatedUnion('type', [
  tagOutcomeSchema,
  metricOutcomeSchema,
  productivityOutcomeSchema,
])

export type OutcomeConfig = z.infer<typeof outcomeConfigSchema>

/** Generic correlation request body */
export const genericCorrelationBodySchema = z
  .object({
    lag_windows: z
      .array(z.string())
      .optional()
      .meta({
        description: 'Time windows to analyze (e.g., ["12h", "24h", "7d"])',
        example: ['24h', '48h', '7d'],
      }),
    outcome: outcomeConfigSchema.meta({ description: 'Outcome to measure' }),
    period_days: z.number().int().optional().meta({
      description: 'Days to analyze (default: 90)',
      example: 90,
    }),
    triggers: z.array(triggerConditionSchema).min(1).meta({
      description: 'Trigger conditions (all must be satisfied for a match)',
    }),
  })
  .meta({ id: 'GenericCorrelationBody' })

export type GenericCorrelationBody = z.infer<typeof genericCorrelationBodySchema>

/** Tag lag result */
export const tagLagResultSchema = z
  .object({
    occurrences: z.number().int(),
    probability: z.number().meta({ description: 'P(outcome | trigger)' }),
    relative_risk: z.number().meta({ description: 'Risk ratio compared to baseline' }),
  })
  .meta({ id: 'GenericTagLagResult' })

/** Metric lag result */
export const metricLagResultSchema = z
  .object({
    delta_from_baseline: z.number().nullable().meta({ description: 'Difference from baseline mean' }),
    mean: z.number().nullable().meta({ description: 'Mean value in the lag window' }),
    sample_count: z.number().int(),
    stddev: z.number().nullable().meta({ description: 'Standard deviation' }),
  })
  .meta({ id: 'MetricLagResult' })

/** Productivity lag result */
export const productivityLagResultSchema = z
  .object({
    avg_minutes_per_day: z.number().meta({ description: 'Average minutes per day' }),
    delta_from_baseline: z.number().nullable().meta({ description: 'Difference from baseline' }),
    total_minutes: z.number().meta({ description: 'Total minutes in the lag window' }),
  })
  .meta({ id: 'ProductivityLagResult' })

/** Generic lag result (union) */
export const genericLagResultSchema = z.union([
  tagLagResultSchema,
  metricLagResultSchema,
  productivityLagResultSchema,
])

export type GenericLagResult = z.infer<typeof genericLagResultSchema>

/** Tag baseline stats */
export const tagBaselineSchema = z
  .object({
    description: z.string(),
    probability: z.number(),
  })
  .meta({ id: 'TagBaseline' })

/** Metric baseline stats */
export const metricBaselineSchema = z
  .object({
    mean: z.number().nullable(),
    sample_count: z.number().int(),
    stddev: z.number().nullable(),
  })
  .meta({ id: 'MetricBaseline' })

/** Productivity baseline stats */
export const productivityBaselineSchema = z
  .object({
    avg_minutes_per_day: z.number(),
    total_minutes: z.number(),
  })
  .meta({ id: 'ProductivityBaseline' })

/** Generic baseline stats (union) */
export const genericBaselineSchema = z.union([
  tagBaselineSchema,
  metricBaselineSchema,
  productivityBaselineSchema,
])

export type GenericBaseline = z.infer<typeof genericBaselineSchema>

/** Generic correlation result data */
export const genericCorrelationDataSchema = z
  .object({
    baseline: genericBaselineSchema.meta({ description: 'Baseline statistics (periods without triggers)' }),
    outcome: outcomeConfigSchema.meta({ description: 'Outcome configuration' }),
    period: z.object({
      days: z.number().int(),
      end: z.string(),
      start: z.string(),
    }),
    post_trigger: z.record(z.string(), genericLagResultSchema).meta({
      description: 'Results for each lag window',
    }),
    statistical_significance: z.object({
      chi_squared: z.number().nullable(),
      p_value: z.number().nullable(),
    }),
    triggers: z.array(triggerConditionSchema).meta({ description: 'Trigger conditions used' }),
    windows_matched: z
      .number()
      .int()
      .meta({ description: 'Number of windows where all conditions were met' }),
  })
  .meta({ id: 'GenericCorrelationData' })

export type GenericCorrelationData = z.infer<typeof genericCorrelationDataSchema>

/** Generic correlation response */
export const genericCorrelationResponseSchema = createDataResponseSchema(genericCorrelationDataSchema).meta({
  id: 'GenericCorrelationResponse',
})

export type GenericCorrelationResponse = z.infer<typeof genericCorrelationResponseSchema>

// ============================================================================
// MCP input schemas (typed params, complementing Express string-based queries)
// ============================================================================

/** Activity impact MCP input schema (typed numbers instead of query strings) */
export const activityImpactInputSchema = z
  .object({
    activity: z
      .string()
      .meta({ description: 'The activity or tag name to analyze (e.g., "gym", "coffee", "meditation")' }),
    activity_type: activityImpactTypeSchema.meta({ description: 'Type of activity to search for' }),
    period_days: z
      .number()
      .int()
      .optional()
      .meta({ description: 'Number of days to analyze. Defaults to 90.' }),
    window_minutes: z
      .number()
      .int()
      .optional()
      .meta({ description: 'Minutes to analyze before/after the activity. Defaults to 30.' }),
  })
  .meta({ id: 'ActivityImpactInput' })

export type ActivityImpactInput = z.infer<typeof activityImpactInputSchema>

/** Event probability MCP input schema (typed numbers instead of query strings) */
export const eventProbabilityInputSchema = z
  .object({
    lag_windows: z.array(z.string()).optional().meta({
      description:
        'Time windows to analyze (e.g., ["12h", "24h", "36h", "48h"]). Uses hours (h) or days (d).',
    }),
    outcome_pattern: z
      .string()
      .meta({ description: 'Regex pattern for outcome tags (e.g., "headache|migraine", "good_sleep")' }),
    period_days: z
      .number()
      .int()
      .optional()
      .meta({ description: 'Number of days to analyze. Defaults to 365.' }),
    trigger_type: eventTriggerTypeSchema.meta({ description: 'Type of trigger event' }),
    trigger_value: z
      .string()
      .meta({ description: 'Trigger activity type or tag pattern (e.g., "exercise", "gym", "coffee")' }),
  })
  .meta({ id: 'EventProbabilityInput' })

export type EventProbabilityInput = z.infer<typeof eventProbabilityInputSchema>

/** HRV correlation MCP input schema */
export const hrvCorrelationInputSchema = z
  .object({
    period_days: z
      .number()
      .int()
      .optional()
      .meta({ description: 'Number of days to analyze. Defaults to 30.' }),
  })
  .meta({ id: 'HrvCorrelationInput' })

export type HrvCorrelationInput = z.infer<typeof hrvCorrelationInputSchema>
