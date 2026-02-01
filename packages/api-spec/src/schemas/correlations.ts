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
    meanHr: z.number().nullable().meta({ description: 'Mean heart rate during period' }),
    meanHrv: z.number().nullable().meta({ description: 'Mean HRV (RMSSD) during period' }),
    sampleCount: z.number().int().meta({ description: 'Number of data samples' }),
    sampleMinutes: z.number().meta({ description: 'Total minutes of data' }),
    stddevHr: z.number().nullable().meta({ description: 'Standard deviation of HR' }),
    stddevHrv: z.number().nullable().meta({ description: 'Standard deviation of HRV' }),
  })
  .meta({ id: 'HrvStats' })

export type HrvStats = z.infer<typeof hrvStatsSchema>

/** HRV stats with baseline delta */
export const hrvStatsWithDeltaSchema = hrvStatsSchema
  .extend({
    hrDeltaFromBaseline: z.number().nullable().meta({ description: 'HR change from baseline' }),
    hrvDeltaFromBaseline: z.number().nullable().meta({ description: 'HRV change from baseline' }),
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
      trendPercent: z.number().nullable().meta({ description: 'Change from previous 30-day period' }),
    }),
    period: z.object({
      end: z.string(),
      start: z.string(),
    }),
    restingHr: z.object({
      avg7day: z.number().nullable(),
      avg30day: z.number().nullable(),
      trendPercent: z.number().nullable(),
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
    correlationCoefficient: z.number().nullable().meta({ description: 'Pearson correlation (-1 to 1)' }),
  })
  .meta({ id: 'ProductivityCorrelation' })

export type ProductivityCorrelation = z.infer<typeof productivityCorrelationSchema>

/** Location correlation */
export const locationCorrelationSchema = hrvStatsWithDeltaSchema
  .extend({
    locationName: z.string().meta({ description: 'Location name' }),
    visitCount: z.number().int().meta({ description: 'Number of visits' }),
  })
  .meta({ id: 'LocationCorrelation' })

export type LocationCorrelation = z.infer<typeof locationCorrelationSchema>

/** Activity correlation */
export const activityCorrelationSchema = hrvStatsWithDeltaSchema
  .extend({
    activityType: z.string().meta({ description: 'Activity type (exercise, meditation, etc.)' }),
    avgDurationMin: z.number().meta({ description: 'Average duration in minutes' }),
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
    sampleCount: z.number().int(),
    stddev: z.number().nullable(),
  })
  .meta({ id: 'TimeWindowStats' })

export type TimeWindowStats = z.infer<typeof timeWindowStatsSchema>

/** Activity Impact result data */
export const activityImpactDataSchema = z
  .object({
    activity: z.string().meta({ description: 'Activity name/pattern searched' }),
    activityType: activityImpactTypeSchema,
    avgDurationMin: z.number().meta({ description: 'Average duration in minutes' }),
    hrTimeline: z.object({
      after15min: timeWindowStatsSchema,
      after30min: timeWindowStatsSchema,
      before15min: timeWindowStatsSchema,
      before30min: timeWindowStatsSchema,
      during: timeWindowStatsSchema,
    }),
    hrvTimeline: z.object({
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
    relativeRisk: z.number().meta({ description: 'Risk ratio compared to baseline' }),
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
    postTrigger: z.record(z.string(), lagWindowResultSchema).meta({
      description: 'Probability for each lag window',
    }),
    sampleSize: z.object({
      daysAnalyzed: z.number().int(),
      outcomeEvents: z.number().int(),
      triggerEvents: z.number().int(),
    }),
    statisticalSignificance: z.object({
      chiSquared: z.number().nullable(),
      pValue: z.number().nullable(),
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
