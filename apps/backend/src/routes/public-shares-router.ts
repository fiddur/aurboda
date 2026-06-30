/**
 * Public sharing routes (UNAUTHENTICATED).
 *
 * Handles: /public/:username/dashboards and /public/:username/:slug
 *
 * These routes serve another user's published dashboards to anonymous viewers.
 * They never use `req.user`; they target the owner's database directly by
 * username (validated against the same rules as signup). The data returned is
 * produced entirely server-side from the stored dashboard config via
 * `resolveDashboardData` — no viewer-supplied parameter reaches the owner's
 * data. `is_public` only governs profile listing; an individual share is served
 * by its unguessable slug whether public or unlisted.
 */
import type { DashboardConfig, PublicProfileResponse, PublicSharedDashboardResponse } from '@aurboda/api-spec'

import { isValidUsername } from '../api/auth-routes.ts'
import { getSharedDashboardBySlug, listPublicSharedDashboards } from '../db/index.ts'
import { buildProfileUrl, buildShareUrl } from '../services/share-urls.ts'
import { resolveDashboardData } from '../services/shared-dashboard-data.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'

/** Connecting to a non-existent user database fails with invalid_catalog_name. */
const isMissingDatabase = (error: unknown): boolean =>
  error instanceof Error && (error as Error & { code?: string }).code === '3D000'

/**
 * Strip viewer-useless / internal fields from a config before exposing it.
 * Quick links point into the owner's private app, so neutralize their hrefs.
 */
export const sanitizeConfig = (config: DashboardConfig): DashboardConfig => ({
  sections: config.sections.map((section) => ({
    ...section,
    widgets: section.widgets.map((widget) =>
      widget.type === 'quick_link' ? { ...widget, config: { ...widget.config, href: '#' } } : widget,
    ),
  })),
  version: config.version,
})

export const createPublicSharesRouter = (webHost: string): TypedRouter => {
  const router = typedRouter()

  router.get<{ username: string }, PublicProfileResponse>(
    '/public/:username/dashboards',
    async (req, res) => {
      const { username } = req.params
      if (!isValidUsername(username)) {
        return res.status(404).json({ error: 'Profile not found', success: false })
      }
      try {
        const records = await listPublicSharedDashboards(username)
        res.setHeader('Cache-Control', 'public, max-age=60')
        res.json({
          dashboards: records.map((r) => ({
            name: r.name,
            share_url: buildShareUrl(webHost, username, r.slug),
            slug: r.slug,
          })),
          profile_url: buildProfileUrl(webHost, username),
          success: true,
          username,
        })
      } catch (error) {
        if (isMissingDatabase(error)) {
          return res.status(404).json({ error: 'Profile not found', success: false })
        }
        throw error
      }
    },
  )

  router.get<{ username: string; slug: string }, PublicSharedDashboardResponse>(
    '/public/:username/:slug',
    async (req, res) => {
      const { slug, username } = req.params
      if (!isValidUsername(username)) {
        return res.status(404).json({ error: 'Dashboard not found', success: false })
      }
      try {
        const record = await getSharedDashboardBySlug(username, slug)
        if (!record) {
          return res.status(404).json({ error: 'Dashboard not found', success: false })
        }
        const widgetData = await resolveDashboardData(username, record.config)
        // Public/anonymous content — allow shared (CDN) caches to absorb load.
        res.setHeader('Cache-Control', 'public, max-age=60')
        res.json({
          config: sanitizeConfig(record.config),
          name: record.name,
          profile_url: buildProfileUrl(webHost, username),
          share_url: buildShareUrl(webHost, username, record.slug),
          success: true,
          widget_data: widgetData,
        })
      } catch (error) {
        if (isMissingDatabase(error)) {
          return res.status(404).json({ error: 'Dashboard not found', success: false })
        }
        throw error
      }
    },
  )

  return router
}
