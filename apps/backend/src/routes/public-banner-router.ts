/**
 * `GET /u/:username/:slug/banner.webp` serves a challenge's host-set banner, for
 * public and unlisted challenges alike (anyone with the link sees the page that
 * shows it). Mounted before the share-html router so `banner.webp` is not taken
 * for a page under the challenge.
 */
import { Router } from 'express'

import type { ChallengeBanner } from '../db/index.ts'

import { isValidUsername } from '../api/auth-routes.ts'
import { getChallengeBanner, getChallengeBySlug, isMissingDatabase } from '../db/index.ts'

export interface PublicBannerDeps {
  getChallengeIdBySlug: (username: string, slug: string) => Promise<string | null>
  getBanner: (username: string, challengeId: string) => Promise<ChallengeBanner | undefined>
}

const defaultDeps: PublicBannerDeps = {
  getBanner: getChallengeBanner,
  getChallengeIdBySlug: async (username, slug) => (await getChallengeBySlug(username, slug))?.id ?? null,
}

export const createPublicBannerRouter = (deps: PublicBannerDeps = defaultDeps): Router => {
  const router = Router()

  router.get('/u/:username/:slug/banner.webp', async (req, res) => {
    const { slug, username } = req.params
    const notFound = () => res.status(404).json({ error: 'Not found', success: false })
    if (!isValidUsername(username)) return notFound()

    let banner: ChallengeBanner | undefined
    try {
      const challengeId = await deps.getChallengeIdBySlug(username, slug)
      banner = challengeId ? await deps.getBanner(username, challengeId) : undefined
    } catch (error) {
      if (isMissingDatabase(error)) return notFound()
      throw error
    }
    if (!banner) return notFound()

    res.set('Content-Type', banner.content_type)
    res.set(
      'Cache-Control',
      req.query.v === undefined ? 'public, max-age=300' : 'public, max-age=31536000, immutable',
    )
    res.send(banner.data)
  })

  return router
}
