/**
 * REST routes for per-user nutrient recommendation overrides.
 *
 * GET    /                  → effective merged list (central NNR2023 + user)
 * PUT    /:nutrient_name    → upsert user override
 * DELETE /:nutrient_name    → revert to central default
 */
import {
  type NutrientRecommendationResponse,
  type NutrientRecommendationsResponse,
  type UpsertNutrientRecommendationBody,
  upsertNutrientRecommendationBodySchema,
} from '@aurboda/api-spec'

import {
  clearUserNutrientRecommendation,
  getEffectiveRecommendations,
  setUserNutrientRecommendation,
} from '../services/nutrient-recommendations.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

export const createNutrientRecommendationsRouter = (authMiddleware: AnyMiddleware): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, NutrientRecommendationsResponse>(
    '/',
    authMiddleware,
    async (req, res) => {
      const recommendations = await getEffectiveRecommendations(req.user!)
      res.json({ recommendations, success: true })
    },
  )

  router.put<{ nutrient_name: string }, NutrientRecommendationResponse, UpsertNutrientRecommendationBody>(
    '/:nutrient_name',
    authMiddleware,
    validateBody(upsertNutrientRecommendationBodySchema),
    async (req, res) => {
      const effective = await setUserNutrientRecommendation(req.user!, req.params.nutrient_name, req.body)
      if (!effective) {
        return res.status(500).json({ error: 'Failed to resolve effective recommendation', success: false })
      }
      res.json({ data: effective, success: true })
    },
  )

  router.delete<{ nutrient_name: string }, NutrientRecommendationResponse>(
    '/:nutrient_name',
    authMiddleware,
    async (req, res) => {
      const { effective } = await clearUserNutrientRecommendation(req.user!, req.params.nutrient_name)
      // 200 + the post-clear effective record (which is the central default,
      // or absent if there is none) — lets the client refresh its cache off
      // the response without an extra round-trip.
      res.json({ data: effective ?? undefined, success: true })
    },
  )

  return router
}
