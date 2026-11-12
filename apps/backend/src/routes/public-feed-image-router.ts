/**
 * `GET /public/:username/images/:id.webp` serves a picture added to something the
 * writer wrote. Mounted before the public-shares router, whose
 * `/public/:username/:slug` resolver would otherwise take `images`.
 */
import { Router } from 'express'

import { isValidUsername } from '../api/auth-routes.ts'
import { getFeedImage, isFeedImageId, isMissingDatabase } from '../db/index.ts'

export interface PublicFeedImageDeps {
  getImage: (username: string, id: string) => Promise<{ content_type: string; data: Buffer } | undefined>
}

const defaultDeps: PublicFeedImageDeps = { getImage: getFeedImage }

export const createPublicFeedImageRouter = (deps: PublicFeedImageDeps = defaultDeps): Router => {
  const router = Router()

  router.get('/public/:username/images/:id.webp', async (req, res) => {
    const { id, username } = req.params
    const notFound = () => res.status(404).json({ error: 'Not found', success: false })
    if (!isValidUsername(username) || !isFeedImageId(id)) return notFound()

    let image: { content_type: string; data: Buffer } | undefined
    try {
      image = await deps.getImage(username, id)
    } catch (error) {
      if (isMissingDatabase(error)) return notFound()
      throw error
    }
    if (!image) return notFound()

    res.set('Content-Type', image.content_type)
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('Cache-Control', 'public, max-age=31536000, immutable')
    res.send(image.data)
  })

  return router
}
