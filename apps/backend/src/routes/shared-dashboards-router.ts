import type { RequestHandler } from 'express'

/**
 * Each shared dashboard is an independently-editable copy of a DashboardConfig
 * that the owner publishes under their public namespace. Responses include the
 * absolute share URL built from the configured public base URL.
 */
import {
  type CreateSharedDashboardBody,
  createSharedDashboardBodySchema,
  type DashboardDataQuery,
  dashboardDataQuerySchema,
  type DashboardDataResponse,
  type SharedDashboard,
  type SharedDashboardResponse,
  type SharedDashboardsResponse,
  type UpdateSharedDashboardBody,
  updateSharedDashboardBodySchema,
} from '@aurboda/api-spec'

import type { SharedDashboardRecord } from '../db/index.ts'

import {
  createSharedDashboard,
  deleteSharedDashboard,
  getSharedDashboardById,
  listSharedDashboards,
  updateSharedDashboard,
} from '../db/index.ts'
import { resolvePresetConfig } from '../services/dashboard-presets.ts'
import {
  defaultPeriodLock,
  requestedPeriodLock,
  resolveLockUpdate,
  validatePeriodLock,
} from '../services/period-lock.ts'
import { PeriodError } from '../services/periods.ts'
import { getUserTimezone } from '../services/settings.ts'
import { buildShareUrl } from '../services/share-urls.ts'
import { resolveDashboardView } from '../services/shared-dashboard-data.ts'
import { dashboardVisibilityOf, dashboardVisibilityToFlags } from '../services/visibility.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

const serialize = (record: SharedDashboardRecord, webHost: string, username: string): SharedDashboard => ({
  config: record.config,
  created_at: record.created_at.toISOString(),
  id: record.id,
  name: record.name,
  period_fixed: record.period_fixed,
  period_from: record.period_from,
  period_lock: record.period_lock,
  share_url: buildShareUrl(webHost, username, record.slug),
  slug: record.slug,
  updated_at: record.updated_at.toISOString(),
  visibility: dashboardVisibilityOf(record),
})

export const createSharedDashboardsRouter = (
  authMiddleware: RequestHandler,
  webHost: string,
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, SharedDashboardsResponse>('/', authMiddleware, async (req, res) => {
    const user = req.user!
    const records = await listSharedDashboards(user)
    res.json({ dashboards: records.map((r) => serialize(r, webHost, user)), success: true })
  })

  router.post<Record<string, never>, SharedDashboardResponse, CreateSharedDashboardBody>(
    '/',
    authMiddleware,
    validateBody(createSharedDashboardBodySchema),
    async (req, res) => {
      const user = req.user!
      const config = await resolvePresetConfig(user, req.body)
      if (!config) {
        return res.status(400).json({ error: 'Give exactly one of config or preset', success: false })
      }
      const lock = requestedPeriodLock(req.body) ?? defaultPeriodLock
      const lockError = validatePeriodLock(config, lock, new Date(), await getUserTimezone(user))
      if (lockError !== null) return res.status(400).json({ error: lockError, success: false })
      const record = await createSharedDashboard(user, {
        config,
        ...dashboardVisibilityToFlags(req.body.visibility),
        ...lock,
        name: req.body.name,
      })
      res.json({ dashboard: serialize(record, webHost, user), success: true })
    },
  )

  router.get<{ id: string }, SharedDashboardResponse>('/:id', authMiddleware, async (req, res) => {
    const user = req.user!
    const record = await getSharedDashboardById(user, req.params.id)
    if (!record) {
      return res.status(404).json({ error: 'Shared dashboard not found', success: false })
    }
    res.json({ dashboard: serialize(record, webHost, user), success: true })
  })

  router.get<{ id: string }, DashboardDataResponse, unknown, DashboardDataQuery>(
    '/:id/data',
    authMiddleware,
    validateQuery(dashboardDataQuerySchema),
    async (req, res) => {
      const user = req.user!
      const record = await getSharedDashboardById(user, req.params.id)
      if (!record) {
        return res.status(404).json({ error: 'Shared dashboard not found', success: false })
      }
      try {
        res.json({ ...(await resolveDashboardView(user, record.config, req.query.period)), success: true })
      } catch (error) {
        if (error instanceof PeriodError) {
          return res.status(400).json({ error: error.message, success: false })
        }
        throw error
      }
    },
  )

  router.put<{ id: string }, SharedDashboardResponse, UpdateSharedDashboardBody>(
    '/:id',
    authMiddleware,
    validateBody(updateSharedDashboardBodySchema),
    async (req, res) => {
      const user = req.user!
      const stored = await getSharedDashboardById(user, req.params.id)
      if (!stored) {
        return res.status(404).json({ error: 'Shared dashboard not found', success: false })
      }
      const lockUpdate = resolveLockUpdate(stored, req.body, new Date(), await getUserTimezone(user))
      if ('error' in lockUpdate) return res.status(400).json({ error: lockUpdate.error, success: false })
      const record = await updateSharedDashboard(user, req.params.id, {
        config: req.body.config,
        ...(req.body.visibility === undefined ? {} : dashboardVisibilityToFlags(req.body.visibility)),
        ...lockUpdate.lock,
        name: req.body.name,
      })
      if (!record) {
        return res.status(404).json({ error: 'Shared dashboard not found', success: false })
      }
      res.json({ dashboard: serialize(record, webHost, user), success: true })
    },
  )

  router.delete<{ id: string }, SharedDashboardResponse>('/:id', authMiddleware, async (req, res) => {
    const user = req.user!
    const deleted = await deleteSharedDashboard(user, req.params.id)
    if (!deleted) {
      return res.status(404).json({ error: 'Shared dashboard not found', success: false })
    }
    res.json({ success: true })
  })

  return router
}
