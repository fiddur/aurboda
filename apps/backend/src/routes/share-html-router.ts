/**
 * Server-rendered HTML for public share pages (UNAUTHENTICATED).
 *
 * nginx proxies `/u/*` to this router so JS-less crawlers receive an
 * index.html whose <head> carries Open Graph / Twitter / description meta for
 * the resolved resource. The body is still the SPA shell — browsers hydrate it
 * as usual; only the head is enriched.
 *
 * Rich meta is emitted only for `is_public` resources. Unlisted dashboards
 * (reachable by slug but not listed) and unknown resources fall back to generic
 * site meta so a private resource's title/description is never handed to a
 * crawler.
 */
import { type Response, Router } from 'express'

import { isValidUsername } from '../api/auth-routes.ts'
import { getChallengeBySlug, getSharedDashboardBySlug, listPublicSharedDashboards } from '../db/index.ts'
import {
  buildChallengeShareMeta,
  buildDashboardShareMeta,
  buildDefaultShareMeta,
  buildProfileShareMeta,
  injectShareMeta,
  renderShareMetaTags,
  type ShareMeta,
} from '../services/share-meta.ts'
import { buildProfileUrl, buildShareUrl } from '../services/share-urls.ts'

/** A public resource resolved just far enough to build meta from. */
interface ResolvedResource {
  name: string
  is_public: boolean
}

export interface ShareHtmlDeps {
  /** Public base URL of the web app, used to build canonical/share URLs. */
  webHost: string
  /** Loads the SPA index.html template, or null if unavailable. */
  loadTemplate: () => Promise<string | null>
  /** Resolve a shared dashboard by owner + slug (null if none). */
  resolveDashboard: (username: string, slug: string) => Promise<ResolvedResource | null>
  /** Resolve a challenge by owner + slug (null if none). */
  resolveChallenge: (username: string, slug: string) => Promise<ResolvedResource | null>
  /** True if the user's public profile exists (db reachable). */
  profileExists: (username: string) => Promise<boolean>
}

/** Connecting to a non-existent user database fails with invalid_catalog_name. */
const isMissingDatabase = (error: unknown): boolean =>
  error instanceof Error && (error as Error & { code?: string }).code === '3D000'

/**
 * Concrete, missing-database-safe resolvers backed by the user databases.
 * Split out so the router can be unit-tested with fakes.
 */
export const createShareResolvers = (): Pick<
  ShareHtmlDeps,
  'resolveDashboard' | 'resolveChallenge' | 'profileExists'
> => ({
  profileExists: async (username) => {
    try {
      await listPublicSharedDashboards(username)
      return true
    } catch (error) {
      if (isMissingDatabase(error)) return false
      throw error
    }
  },
  resolveChallenge: async (username, slug) => {
    try {
      const challenge = await getChallengeBySlug(username, slug)
      return challenge ? { is_public: challenge.is_public, name: challenge.name } : null
    } catch (error) {
      if (isMissingDatabase(error)) return null
      throw error
    }
  },
  resolveDashboard: async (username, slug) => {
    try {
      const dashboard = await getSharedDashboardBySlug(username, slug)
      return dashboard ? { is_public: dashboard.is_public, name: dashboard.name } : null
    } catch (error) {
      if (isMissingDatabase(error)) return null
      throw error
    }
  },
})

/** Minimal crawler-friendly document when the SPA template is unavailable. */
const fallbackHtml = (meta: ShareMeta): string =>
  `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${meta.title.replaceAll('<', '&lt;')}</title>
    ${renderShareMetaTags(meta)}
  </head>
  <body>
    <p><a href="${meta.url.replaceAll('"', '&quot;')}">${meta.title.replaceAll('<', '&lt;')}</a></p>
  </body>
</html>`

const sendHtml = async (
  loadTemplate: ShareHtmlDeps['loadTemplate'],
  meta: ShareMeta,
  isRich: boolean,
  res: Response,
): Promise<void> => {
  const template = await loadTemplate()
  const html = template ? injectShareMeta(template, meta) : fallbackHtml(meta)
  // Rich (public) meta is safe to cache aggressively; generic fallbacks briefly.
  res.setHeader('Cache-Control', isRich ? 'public, max-age=300' : 'public, max-age=60')
  res.type('html').send(html)
}

export const createShareHtmlRouter = (deps: ShareHtmlDeps): Router => {
  const { loadTemplate, profileExists, resolveChallenge, resolveDashboard, webHost } = deps
  const router = Router()

  router.get('/u/:username/:slug', async (req, res) => {
    const { slug, username } = req.params
    const url = buildShareUrl(webHost, username, slug)
    if (!isValidUsername(username)) {
      return sendHtml(loadTemplate, buildDefaultShareMeta(webHost, url), false, res)
    }

    const dashboard = await resolveDashboard(username, slug)
    if (dashboard?.is_public) {
      return sendHtml(
        loadTemplate,
        buildDashboardShareMeta({ name: dashboard.name, url, username, webHost }),
        true,
        res,
      )
    }

    const challenge = dashboard ? null : await resolveChallenge(username, slug)
    if (challenge?.is_public) {
      return sendHtml(
        loadTemplate,
        buildChallengeShareMeta({ name: challenge.name, url, username, webHost }),
        true,
        res,
      )
    }

    // Unlisted (found but not public) or unknown: generic meta, no leak.
    return sendHtml(loadTemplate, buildDefaultShareMeta(webHost, url), false, res)
  })

  router.get('/u/:username', async (req, res) => {
    const { username } = req.params
    const url = buildProfileUrl(webHost, username)
    if (isValidUsername(username) && (await profileExists(username))) {
      return sendHtml(loadTemplate, buildProfileShareMeta({ url, username, webHost }), true, res)
    }
    return sendHtml(loadTemplate, buildDefaultShareMeta(webHost, url), false, res)
  })

  // nginx proxies the whole /u/* subtree here, so any other shape (trailing
  // slash, a future deeper route) must still return the SPA shell — with
  // generic meta — instead of a 404, mirroring nginx's index.html fallback.
  router.get(/^\/u\//, (req, res) => {
    const url = `${webHost.replace(/\/+$/, '')}${req.path}`
    return sendHtml(loadTemplate, buildDefaultShareMeta(webHost, url), false, res)
  })

  return router
}
