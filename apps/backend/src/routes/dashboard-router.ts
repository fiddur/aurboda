import type { RequestHandler } from 'express'

import {
  type DashboardDataQuery,
  dashboardDataQuerySchema,
  type DashboardDataResponse,
  type DashboardResponse,
  defaultDashboardConfig,
  type UpdateDashboardInput,
  updateDashboardInputSchema,
} from '@aurboda/api-spec'

import { upsertUserSettings } from '../db/index.ts'
import { PeriodError } from '../services/periods.ts'
import { getSettings } from '../services/settings.ts'
import { resolveDashboardView } from '../services/shared-dashboard-data.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

export const createDashboardRouter = (authMiddleware: RequestHandler): TypedRouter => {
  const router = typedRouter()
  router.get<Record<string, never>, DashboardResponse>('/', authMiddleware, async (req, res) => {
    const settings = await getSettings(req.user!)
    const dashboard = settings.dashboard ?? defaultDashboardConfig
    res.json({ dashboard, success: true })
  })

  router.get<Record<string, never>, DashboardDataResponse, unknown, DashboardDataQuery>(
    '/data',
    authMiddleware,
    validateQuery(dashboardDataQuerySchema),
    async (req, res) => {
      const user = req.user!
      const settings = await getSettings(user)
      try {
        const view = await resolveDashboardView(
          user,
          settings.dashboard ?? defaultDashboardConfig,
          req.query.period,
        )
        res.json({ ...view, success: true })
      } catch (error) {
        if (error instanceof PeriodError) {
          return res.status(400).json({ error: error.message, success: false })
        }
        throw error
      }
    },
  )

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
