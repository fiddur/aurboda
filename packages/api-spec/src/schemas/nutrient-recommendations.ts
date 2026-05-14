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
import { NUTRIENT_FIELD_NAMES } from './nutrients.ts'

/**
 * Names of nutrients we accept on the recommendation API. Constraining via
 * schema means a malformed PUT or MCP call lands as a 400 instead of an
 * orphan row in the per-user override table.
 */
const nutrientNameSchema = z.enum(NUTRIENT_FIELD_NAMES as unknown as readonly [string, ...string[]]).meta({
  description: 'Nutrient field name (must match NUTRIENT_FIELDS.name)',
  id: 'NutrientName',
})

export type NutrientName = z.infer<typeof nutrientNameSchema>

export { nutrientNameSchema }

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

export const clearNutrientRecommendationResponseSchema = baseResponseSchema
  .extend({
    /**
     * True if a user override row was actually deleted; false if there was
     * nothing to delete (the request was a no-op). Lets a client tell the
     * "I removed an override" case apart from "there was nothing here".
     */
    cleared: z.boolean(),
    /**
     * The post-clear effective recommendation — the central default if any,
     * otherwise undefined. Mirrors the GET shape so the client can refresh
     * its cache off the response.
     */
    data: nutrientRecommendationSchema.optional(),
  })
  .meta({ id: 'ClearNutrientRecommendationResponse' })

export type ClearNutrientRecommendationResponse = z.infer<typeof clearNutrientRecommendationResponseSchema>

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

/** Cap the period-summary window so a buggy or malicious caller can't request a multi-year scan. */
export const NUTRIENT_PERIOD_SUMMARY_MAX_DAYS = 366

const dayCount = (start: string, end: string): number => {
  const a = new Date(`${start}T00:00:00Z`).getTime()
  const b = new Date(`${end}T00:00:00Z`).getTime()
  return Math.floor((b - a) / 86_400_000) + 1
}

/**
 * IANA tz validation. `Intl.supportedValuesOf('timeZone')` is available in
 * modern Node and browsers; if it isn't, fall back to a try/catch on
 * `DateTimeFormat` which is the actual consumer downstream.
 */
const isValidTimezone = (tz: string): boolean => {
  try {
    const supported = Intl.supportedValuesOf?.('timeZone')
    if (supported) return supported.includes(tz)
  } catch {}
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export const nutrientPeriodSummaryQuerySchema = z
  .object({
    start: dateOnlySchema.meta({ description: 'Inclusive start date (YYYY-MM-DD)' }),
    end: dateOnlySchema.meta({ description: 'Inclusive end date (YYYY-MM-DD)' }),
    tz: z
      .string()
      .refine(isValidTimezone, { message: 'tz must be a valid IANA timezone' })
      .optional()
      .meta({ description: 'IANA timezone (e.g. "Europe/Stockholm") for bucketing meals into local days' }),
    count_only_completed: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((v) => v === true || v === 'true')
      .optional()
      .meta({
        description:
          'When true, only days marked as log-completed contribute to averages. Affects days_with_meals and per-nutrient avg denominators. Defaults to false.',
      }),
  })
  .refine((q) => q.start <= q.end, { message: 'start must be on or before end', path: ['start'] })
  .refine((q) => dayCount(q.start, q.end) <= NUTRIENT_PERIOD_SUMMARY_MAX_DAYS, {
    message: `window must be <= ${NUTRIENT_PERIOD_SUMMARY_MAX_DAYS} days`,
    path: ['end'],
  })
  .meta({ description: 'Date-range query for the meal period summary', id: 'NutrientPeriodSummaryQuery' })

export type NutrientPeriodSummaryQuery = z.infer<typeof nutrientPeriodSummaryQuerySchema>

export const nutrientPeriodStatSchema = z
  .object({
    avg: z
      .number()
      .meta({ description: 'Mean daily intake — total / days_with_meals (the top-level denominator)' }),
    total: z.number().meta({ description: 'Sum across all days in the range' }),
    days_with_value: z.number().int().meta({
      description:
        'Diagnostic: how many days had a non-zero entry for this nutrient. Always ≤ days_with_meals; use days_with_meals (top level) as the avg denominator, not this.',
    }),
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
    days_with_meals: z.number().int().meta({
      description:
        'Number of days in the range that had at least one meal logged (and were log-completed, when count_only_completed=true). Used as the denominator for every per-nutrient avg so a sparse log isn’t pulled toward zero by missing days.',
    }),
    days_completed: z.number().int().meta({
      description:
        'Number of days in the range that the user marked as log-completed. Reported regardless of count_only_completed so the UI can show "avg from N completed".',
    }),
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
