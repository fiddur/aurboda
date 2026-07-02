import type { RequestHandler } from 'express'

/**
 * Shared dashboards route group (owner-facing CRUD).
 *
 * Handles: /shared-dashboards/*
 *
 * Each shared dashboard is an independently-editable copy of a DashboardConfig
 * that the owner publishes under their public namespace. Responses include the
 * absolute share URL built from the configured public base URL.
 */
import {
  type CreateSharedDashboardBody,
  createSharedDashboardBodySchema,
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
import { buildShareUrl } from '../services/share-urls.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

const serialize = (record: SharedDashboardRecord, webHost: string, username: string): SharedDashboard => ({
  config: record.config,
  created_at: record.created_at.toISOString(),
  id: record.id,
  is_public: record.is_public,
  name: record.name,
  share_url: buildShareUrl(webHost, username, record.slug),
  slug: record.slug,
  updated_at: record.updated_at.toISOString(),
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
      const record = await createSharedDashboard(user, {
        config: req.body.config,
        is_public: req.body.is_public,
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

  router.put<{ id: string }, SharedDashboardResponse, UpdateSharedDashboardBody>(
    '/:id',
    authMiddleware,
    validateBody(updateSharedDashboardBodySchema),
    async (req, res) => {
      const user = req.user!
      const record = await updateSharedDashboard(user, req.params.id, {
        config: req.body.config,
        is_public: req.body.is_public,
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
