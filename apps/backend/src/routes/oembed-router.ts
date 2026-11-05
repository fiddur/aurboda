/**
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
  resolveExercise: (username: string, slug: string) => Promise<ResolvedResource | null>
  profileExists: (username: string) => Promise<boolean>
}

export const createOEmbedRouter = (deps: OEmbedDeps): Router => {
  const { profileExists, resolveChallenge, resolveDashboard, resolveExercise, webHost } = deps
  const router = Router()

  /** The name of the public resource at a slug: the first resource found holds it, public or not. */
  const publicNameAt = async (username: string, slug: string): Promise<string | null> => {
    const dashboard = await resolveDashboard(username, slug)
    if (dashboard) return dashboard.is_public ? dashboard.name : null
    const challenge = await resolveChallenge(username, slug)
    if (challenge) return challenge.is_public ? challenge.name : null
    const exercise = await resolveExercise(username, slug)
    return exercise?.is_public ? exercise.name : null
  }

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

    const name = await publicNameAt(username, slug)
    if (name !== null) return respond(name, buildShareUrl(webHost, username, slug))

    res.status(404).json({ error: 'Not found' })
  })

  return router
}
