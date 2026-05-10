/**
 * Per-nutrient recommended min/max ranges, with a central default layer
 * (curated NNR2023 seed) and per-user overrides.
 *
 * Effective merge semantics:
 *   - If the user has a row for a nutrient, those values win (even nulls —
 *     "explicitly suppress this nutrient's range").
 *   - Otherwise, the central default applies if any.
 *   - Otherwise, no recommendation.
 *
 * The companion meal period summary endpoint returns daily-averaged nutrient
 * intake over a date range so the frontend can render each nutrient against
 * its recommended range using the existing ReferenceRangeBar component.
 */

import { z } from 'zod'

import { baseResponseSchema, dateOnlySchema } from './common.ts'

// ============================================================================
// Effective recommendation (returned by GET)
// ============================================================================

export const nutrientRecommendationSourceSchema = z.enum(['central', 'user']).meta({
  description: 'Whether this recommendation came from the central default or a user override',
  id: 'NutrientRecommendationSource',
})

export type NutrientRecommendationSource = z.infer<typeof nutrientRecommendationSourceSchema>

export const nutrientRecommendationSchema = z
  .object({
    nutrient_name: z.string().meta({ description: 'Nutrient field name (matches NUTRIENT_FIELDS.name)' }),
    recommended_low: z
      .number()
      .nullable()
      .optional()
      .meta({ description: 'Lower bound of recommended daily intake' }),
    recommended_high: z
      .number()
      .nullable()
      .optional()
      .meta({ description: 'Upper bound of recommended daily intake' }),
    unit: z.string().meta({ description: 'Unit of measurement (e.g., "g", "mg", "µg", "kcal")' }),
    source: nutrientRecommendationSourceSchema,
    source_label: z
      .string()
      .nullable()
      .optional()
      .meta({ description: 'Source attribution for the central default (e.g., "NNR2023")' }),
  })
  .meta({
    description: 'Effective per-nutrient recommendation (central default merged with user override)',
    id: 'NutrientRecommendation',
  })

export type NutrientRecommendation = z.infer<typeof nutrientRecommendationSchema>

export const nutrientRecommendationsResponseSchema = baseResponseSchema
  .extend({
    recommendations: z.array(nutrientRecommendationSchema).optional(),
  })
  .meta({ id: 'NutrientRecommendationsResponse' })

export type NutrientRecommendationsResponse = z.infer<typeof nutrientRecommendationsResponseSchema>

export const nutrientRecommendationResponseSchema = baseResponseSchema
  .extend({
    data: nutrientRecommendationSchema.optional(),
  })
  .meta({ id: 'NutrientRecommendationResponse' })

export type NutrientRecommendationResponse = z.infer<typeof nutrientRecommendationResponseSchema>

// ============================================================================
// Upsert / clear user override
// ============================================================================

export const upsertNutrientRecommendationBodySchema = z
  .object({
    recommended_low: z
      .number()
      .nullable()
      .optional()
      .meta({ description: 'Lower bound; pass null to suppress the central default' }),
    recommended_high: z
      .number()
      .nullable()
      .optional()
      .meta({ description: 'Upper bound; pass null to suppress the central default' }),
  })
  .refine((v) => 'recommended_low' in v || 'recommended_high' in v, {
    message: 'At least one of recommended_low or recommended_high must be provided',
  })
  .meta({
    description: 'Set or update a user-specific nutrient recommendation. Pass null to suppress a default.',
    id: 'UpsertNutrientRecommendationBody',
  })

export type UpsertNutrientRecommendationBody = z.infer<typeof upsertNutrientRecommendationBodySchema>

// ============================================================================
// Period summary (averaged daily nutrient intake)
// ============================================================================

export const nutrientPeriodSummaryQuerySchema = z
  .object({
    start: dateOnlySchema.meta({ description: 'Inclusive start date (YYYY-MM-DD)' }),
    end: dateOnlySchema.meta({ description: 'Inclusive end date (YYYY-MM-DD)' }),
    tz: z
      .string()
      .optional()
      .meta({ description: 'IANA timezone (e.g. "Europe/Stockholm") for bucketing meals into local days' }),
  })
  .meta({ description: 'Date-range query for the meal period summary', id: 'NutrientPeriodSummaryQuery' })

export type NutrientPeriodSummaryQuery = z.infer<typeof nutrientPeriodSummaryQuerySchema>

export const nutrientPeriodStatSchema = z
  .object({
    avg: z.number().meta({ description: 'Mean daily intake across days that have any meal data' }),
    total: z.number().meta({ description: 'Sum across all days in the range' }),
    days_with_data: z
      .number()
      .int()
      .meta({ description: 'Number of days in the range that had at least one meal' }),
  })
  .meta({ description: 'Per-nutrient aggregate over a date range', id: 'NutrientPeriodStat' })

export type NutrientPeriodStat = z.infer<typeof nutrientPeriodStatSchema>

export const caloriesBurnedPeriodStatSchema = z
  .object({
    avg: z.number().meta({ description: 'Average daily calories_total over days with data' }),
    days_with_data: z
      .number()
      .int()
      .meta({ description: 'Number of days in the range that had a calories_total metric' }),
  })
  .meta({ id: 'CaloriesBurnedPeriodStat' })

export type CaloriesBurnedPeriodStat = z.infer<typeof caloriesBurnedPeriodStatSchema>

export const nutrientPeriodSummarySchema = z
  .object({
    start: dateOnlySchema,
    end: dateOnlySchema,
    days_in_range: z.number().int().meta({ description: 'Total days from start to end inclusive' }),
    nutrients: z.record(z.string(), nutrientPeriodStatSchema).meta({
      description: 'Per-nutrient stats keyed by nutrient field name',
    }),
    calories_burned: caloriesBurnedPeriodStatSchema.nullable().optional().meta({
      description:
        'Average calories_total burned per day over the window, or null when no calories_total metric is recorded',
    }),
  })
  .meta({ description: 'Aggregated nutrient intake over a date range', id: 'NutrientPeriodSummary' })

export type NutrientPeriodSummary = z.infer<typeof nutrientPeriodSummarySchema>

export const nutrientPeriodSummaryResponseSchema = baseResponseSchema
  .extend({
    data: nutrientPeriodSummarySchema.optional(),
  })
  .meta({ id: 'NutrientPeriodSummaryResponse' })

export type NutrientPeriodSummaryResponse = z.infer<typeof nutrientPeriodSummaryResponseSchema>
