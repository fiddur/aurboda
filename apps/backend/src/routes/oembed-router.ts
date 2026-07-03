/**
 * oEmbed endpoint (UNAUTHENTICATED): `GET /oembed?url=<share url>&format=json`.
 *
 * Resolves a public share URL to an oEmbed `link` document (title + author +
 * OG-image thumbnail). Only public resources resolve; anything else 404s, so
 * nothing private is exposed. Discoverable via the `<link rel="alternate">`
 * that the share-html router injects.
 */
import { Router } from 'express'

import { isValidUsername } from '../api/auth-routes.ts'
import { buildOEmbedLink, parseShareUrl } from '../services/oembed.ts'
import { resourceOgImage } from '../services/share-meta.ts'
import { buildProfileUrl, buildShareUrl } from '../services/share-urls.ts'

interface ResolvedResource {
  name: string
  is_public: boolean
}

export interface OEmbedDeps {
  webHost: string
  resolveDashboard: (username: string, slug: string) => Promise<ResolvedResource | null>
  resolveChallenge: (username: string, slug: string) => Promise<ResolvedResource | null>
  profileExists: (username: string) => Promise<boolean>
}

export const createOEmbedRouter = (deps: OEmbedDeps): Router => {
  const { profileExists, resolveChallenge, resolveDashboard, webHost } = deps
  const router = Router()

  router.get('/oembed', async (req, res) => {
    const url = typeof req.query.url === 'string' ? req.query.url : undefined
    const format = typeof req.query.format === 'string' ? req.query.format : 'json'
    if (!url) {
      res.status(400).json({ error: 'Missing url parameter' })
      return
    }
    // Per the oEmbed spec, an unsupported format is a 501.
    if (format !== 'json') {
      res.status(501).json({ error: 'Only json format is supported' })
      return
    }

    const parsed = parseShareUrl(url)
    if (!parsed || !isValidUsername(parsed.username)) {
      res.status(404).json({ error: 'Not an oEmbed-able resource' })
      return
    }
    const { slug, username } = parsed
    const authorUrl = buildProfileUrl(webHost, username)

    const respond = (title: string, resourceUrl: string): void => {
      res.setHeader('Cache-Control', 'public, max-age=300')
      res.json(
        buildOEmbedLink({
          authorName: username,
          authorUrl,
          providerUrl: webHost,
          thumbnailUrl: resourceOgImage(resourceUrl),
          title,
        }),
      )
    }

    if (slug === undefined) {
      if (await profileExists(username)) return respond(`${username} — Aurboda`, authorUrl)
      res.status(404).json({ error: 'Not found' })
      return
    }

    const shareUrl = buildShareUrl(webHost, username, slug)
    const dashboard = await resolveDashboard(username, slug)
    if (dashboard?.is_public) return respond(dashboard.name, shareUrl)
    const challenge = dashboard ? null : await resolveChallenge(username, slug)
    if (challenge?.is_public) return respond(challenge.name, shareUrl)

    res.status(404).json({ error: 'Not found' })
  })

  return router
}
