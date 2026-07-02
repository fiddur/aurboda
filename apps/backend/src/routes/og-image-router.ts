/**
 * Dynamic Open Graph image endpoints (UNAUTHENTICATED).
 *
 * Serves `/u/:username[/:slug]/opengraph-image.png` — a 1200×630 branded card
 * rendered per resource. Mounted BEFORE the share-html router so these specific
 * routes win over the generic `/u/:username/:slug` HTML route.
 *
 * Only public resources get a rendered card; anything else (unlisted, unknown,
 * invalid) redirects to the branded static default, so a private resource never
 * yields a bespoke image. Rendered PNGs are memoised in a small bounded cache
 * (render is CPU-heavy and inputs rarely change).
 */
import { type Response, Router } from 'express'

import type { OgCard } from '../services/og-image.ts'

import { isValidUsername } from '../api/auth-routes.ts'
import { defaultOgImage } from '../services/share-meta.ts'

interface ResolvedResource {
  name: string
  is_public: boolean
}

export interface OgImageDeps {
  webHost: string
  resolveDashboard: (username: string, slug: string) => Promise<ResolvedResource | null>
  resolveChallenge: (username: string, slug: string) => Promise<ResolvedResource | null>
  profileExists: (username: string) => Promise<boolean>
  renderImage: (card: OgCard) => Promise<Buffer>
}

/** How many rendered cards to keep in memory before evicting the oldest. */
const MAX_CACHE_ENTRIES = 200

export const createOgImageRouter = (deps: OgImageDeps): Router => {
  const { profileExists, renderImage, resolveChallenge, resolveDashboard, webHost } = deps
  const router = Router()
  const cache = new Map<string, Buffer>()

  const sendImage = async (res: Response, key: string, card: OgCard): Promise<void> => {
    let png = cache.get(key)
    if (!png) {
      png = await renderImage(card)
      if (cache.size >= MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
      cache.set(key, png)
    }
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.type('png').send(png)
  }

  const redirectToDefault = (res: Response): void => {
    res.redirect(302, defaultOgImage(webHost))
  }

  router.get('/u/:username/:slug/opengraph-image.png', async (req, res) => {
    const { slug, username } = req.params
    if (!isValidUsername(username)) return redirectToDefault(res)

    const dashboard = await resolveDashboard(username, slug)
    if (dashboard?.is_public) {
      return sendImage(res, `d:${username}/${slug}:${dashboard.name}`, {
        kind: 'dashboard',
        title: dashboard.name,
      })
    }

    const challenge = dashboard ? null : await resolveChallenge(username, slug)
    if (challenge?.is_public) {
      return sendImage(res, `c:${username}/${slug}:${challenge.name}`, {
        kind: 'challenge',
        title: challenge.name,
      })
    }

    return redirectToDefault(res)
  })

  router.get('/u/:username/opengraph-image.png', async (req, res) => {
    const { username } = req.params
    if (isValidUsername(username) && (await profileExists(username))) {
      return sendImage(res, `p:${username}`, { kind: 'profile', title: username })
    }
    return redirectToDefault(res)
  })

  return router
}
