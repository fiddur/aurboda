/**
 * REST routes for per-user nutrient recommendation overrides.
 *
 * GET    /                  → effective merged list (central NNR2023 + user)
 * PUT    /:nutrient_name    → upsert user override
 * DELETE /:nutrient_name    → revert to central default
 */
import type { Response } from 'express'

import {
  type ClearNutrientRecommendationResponse,
  NUTRIENT_FIELD_NAMES,
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

const KNOWN_NUTRIENT_NAMES = new Set<string>(NUTRIENT_FIELD_NAMES)

/**
 * Reject `nutrient_name` path params that aren't in NUTRIENT_FIELDS. Without
 * this a caller could PUT to /nutrient-recommendations/<arbitrary string>
 * and accumulate orphan rows in the per-user override table that never
 * surface in the merged effective list.
 */
const requireKnownNutrient = (name: string, res: Response): boolean => {
  if (KNOWN_NUTRIENT_NAMES.has(name)) return true
  res.status(400).json({ error: `Unknown nutrient_name: ${name}`, success: false })
  return false
}

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
      if (!requireKnownNutrient(req.params.nutrient_name, res)) return
      const effective = await setUserNutrientRecommendation(req.user!, req.params.nutrient_name, req.body)
      // `effective` is null when the upsert produced a NULL/NULL row
      // (legitimate suppression) and there's no central default left to
      // surface — that's a successful 200, not an error.
      res.json({ data: effective ?? undefined, success: true })
    },
  )

  router.delete<{ nutrient_name: string }, ClearNutrientRecommendationResponse>(
    '/:nutrient_name',
    authMiddleware,
    async (req, res) => {
      if (!requireKnownNutrient(req.params.nutrient_name, res)) return
      const { cleared, effective } = await clearUserNutrientRecommendation(
        req.user!,
        req.params.nutrient_name,
      )
      // 200 + the post-clear effective record (the central default, or
      // absent if none). `cleared` distinguishes "deleted an existing
      // override" from "there was nothing to delete".
      res.json({ cleared, data: effective ?? undefined, success: true })
    },
  )

  return router
}
