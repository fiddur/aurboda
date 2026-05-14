/**
 * MCP tools for the multi-day nutrient overview feature.
 *
 * - get_nutrient_recommendations / set_nutrient_recommendation /
 *   clear_nutrient_recommendation manage the per-user override layer over
 *   the central NNR2023 defaults.
 * - query_meals_period_summary returns daily-averaged nutrient intake plus
 *   averaged calories_total burn over a date range.
 */
import {
  NUTRIENT_FIELD_NAMES,
  nutrientPeriodSummaryQuerySchema,
  upsertNutrientRecommendationBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

const nutrientNameMcpSchema = z
  .enum(NUTRIENT_FIELD_NAMES as unknown as readonly [string, ...string[]])
  .describe('Nutrient field name (must match NUTRIENT_FIELDS.name, e.g. "protein", "vitamin_c")')

import {
  clearUserNutrientRecommendation,
  getEffectiveRecommendations,
  setUserNutrientRecommendation,
} from '../services/nutrient-recommendations.ts'
import { getMealPeriodSummary } from '../services/queries/meal-period-summary.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerNutrientRecommendationTools = (server: McpServer, user: string) => {
  server.tool(
    'get_nutrient_recommendations',
    'List effective nutrient recommendation ranges for the user — central NNR2023 defaults merged with any per-user override (source field tells you which won).',
    {},
    async () => {
      const recommendations = await getEffectiveRecommendations(user)
      return jsonResponse({ recommendations, success: true })
    },
  )

  server.tool(
    'set_nutrient_recommendation',
    [
      'Upsert a per-user override of a nutrient recommendation range.',
      'Pass `null` for either bound to suppress the central default for that bound; pass both as null to suppress the recommendation entirely (the nutrient will still be measured but no range is shown).',
    ].join(' '),
    {
      nutrient_name: nutrientNameMcpSchema,
      ...upsertNutrientRecommendationBodySchema.shape,
    },
    async ({ nutrient_name, recommended_low, recommended_high }) => {
      try {
        const effective = await setUserNutrientRecommendation(user, nutrient_name, {
          ...(recommended_low !== undefined ? { recommended_low } : {}),
          ...(recommended_high !== undefined ? { recommended_high } : {}),
        })
        return jsonResponse({ data: effective, success: true })
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Failed to upsert nutrient recommendation')
      }
    },
  )

  server.tool(
    'clear_nutrient_recommendation',
    'Remove the per-user override for a nutrient, reverting to the central default (or no recommendation if no central row exists).',
    {
      nutrient_name: nutrientNameMcpSchema,
    },
    async ({ nutrient_name }) => {
      const { cleared, effective } = await clearUserNutrientRecommendation(user, nutrient_name)
      return jsonResponse({ cleared, data: effective, success: true })
    },
  )

  server.tool(
    'query_meals_period_summary',
    [
      'Return daily-averaged nutrient intake across a date range (inclusive), plus averaged daily calories_total burn when available.',
      'For each nutrient: avg = mean across days that have any meal (so sparse logs are not dragged toward zero), days_with_data, and total. calories_burned is null when no calories_total metric exists in the window.',
    ].join(' '),
    { ...nutrientPeriodSummaryQuerySchema.shape },
    async ({ start, end, tz, count_only_completed }) => {
      const data = await getMealPeriodSummary(user, { count_only_completed, end, start, tz })
      return jsonResponse({ data, success: true })
    },
  )
}
