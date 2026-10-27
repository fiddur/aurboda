import {
  type BaseResponse,
  goalHistoryQuerySchema,
  type GoalHistoryQuery,
  type GoalHistoryResponse,
  type GoalsProgressResponse,
  type UpdateSettingsInput,
  updateSettingsInputSchema,
  type UserSettingsResponse,
  type WidgetGoalProgress,
} from '@aurboda/api-spec'

import { getGoalHistory } from '../services/goal-history.ts'
import { getGoalsProgress, getWidgetGoalsProgress } from '../services/goals.ts'
import {
  getSettingsResponse,
  type HrSettingsChanged,
  validateAndUpdateSettings,
} from '../services/settings.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

export const createSettingsRouter = (
  authMiddleware: AnyMiddleware,
  onHrSettingsChanged?: HrSettingsChanged,
): TypedRouter => {
  const router = typedRouter()
  router.get<Record<string, never>, UserSettingsResponse>(
    '/user/settings',
    authMiddleware,
    async (req, res) => {
      const result = await getSettingsResponse(req.user!)
      res.json(result)
    },
  )

  router.patch<Record<string, never>, UserSettingsResponse, UpdateSettingsInput>(
    '/user/settings',
    authMiddleware,
    validateBody(updateSettingsInputSchema),
    async (req, res) => {
      const result = await validateAndUpdateSettings(req.user!, req.body, onHrSettingsChanged)
      if (!result.success) {
        return res.status(400).json(result)
      }
      res.json(result)
    },
  )

  router.get<Record<string, never>, GoalsProgressResponse>(
    '/goals/progress',
    authMiddleware,
    async (req, res) => {
      const goals = await getGoalsProgress(req.user!)
      res.json({ goals, success: true })
    },
  )

  router.get<Record<string, never>, { goals: WidgetGoalProgress[]; success: true }>(
    '/goals/progress/widget',
    authMiddleware,
    async (req, res) => {
      const goals = await getWidgetGoalsProgress(req.user!)
      res.json({ goals, success: true })
    },
  )

  router.get<{ id: string }, GoalHistoryResponse | BaseResponse, unknown, GoalHistoryQuery>(
    '/goals/:id/history',
    authMiddleware,
    validateQuery(goalHistoryQuerySchema),
    async (req, res) => {
      const result = await getGoalHistory(req.user!, req.params.id, req.query)
      if (!result) return res.status(404).json({ error: 'Goal not found', success: false })
      res.json(result)
    },
  )

  return router
}
