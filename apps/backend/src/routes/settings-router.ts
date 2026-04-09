import type { RequestHandler, Router } from 'express'

/**
 * Settings and goals route group.
 *
 * Handles: /user/settings, /goals/progress
 */
import {
  type GoalsProgressResponse,
  type UpdateSettingsInput,
  updateSettingsInputSchema,
  type UserSettingsResponse,
} from '@aurboda/api-spec'

import { getGoalsProgress } from '../services/goals.ts'
import { getSettingsResponse, validateAndUpdateSettings } from '../services/settings.ts'
import { typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

export const createSettingsRouter = (authMiddleware: RequestHandler): Router => {
  const router = typedRouter()
  router.get<Record<string, never>, UserSettingsResponse>(
    '/user/settings',
    authMiddleware,
    async (req, res) => {
      const result = await getSettingsResponse(req.user!)
      res.json(result)
    },
  )

  // PATCH /user/settings - Update user settings
  router.patch<Record<string, never>, UserSettingsResponse, UpdateSettingsInput>(
    '/user/settings',
    authMiddleware,
    validateBody(updateSettingsInputSchema),
    async (req, res) => {
      const result = await validateAndUpdateSettings(req.user!, req.body)
      if (!result.success) {
        return res.status(400).json(result)
      }
      res.json(result)
    },
  )

  // GET /goals/progress - Get progress toward all user goals
  router.get<Record<string, never>, GoalsProgressResponse>(
    '/goals/progress',
    authMiddleware,
    async (req, res) => {
      const goals = await getGoalsProgress(req.user!)
      res.json({ goals, success: true })
    },
  )

  return router as unknown as Router
}
