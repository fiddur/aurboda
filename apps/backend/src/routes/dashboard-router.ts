import type { RequestHandler } from 'express'

/**
 * Dashboard route group.
 *
 * Handles: /dashboard/*
 */
import {
  type DashboardResponse,
  defaultDashboardConfig,
  type UpdateDashboardInput,
  updateDashboardInputSchema,
} from '@aurboda/api-spec'

import { upsertUserSettings } from '../db/index.ts'
import { getSettings } from '../services/settings.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

export const createDashboardRouter = (authMiddleware: RequestHandler): TypedRouter => {
  const router = typedRouter()
  router.get<Record<string, never>, DashboardResponse>('/', authMiddleware, async (req, res) => {
    const settings = await getSettings(req.user!)
    const dashboard = settings.dashboard ?? defaultDashboardConfig
    res.json({ dashboard, success: true })
  })

  router.put<Record<string, never>, DashboardResponse, UpdateDashboardInput>(
    '/',
    authMiddleware,
    validateBody(updateDashboardInputSchema),
    async (req, res) => {
      const user = req.user!
      await upsertUserSettings(user, { dashboard: req.body })
      res.json({ dashboard: req.body, success: true })
    },
  )

  router.post<Record<string, never>, DashboardResponse>('/reset', authMiddleware, async (req, res) => {
    const user = req.user!
    await upsertUserSettings(user, { dashboard: undefined })
    res.json({ dashboard: defaultDashboardConfig, success: true })
  })

  return router
}
