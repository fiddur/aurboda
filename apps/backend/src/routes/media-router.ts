import {
  type MediaPlay,
  type MediaPlayQuery,
  mediaPlayQuerySchema,
  type MediaPlayResponse,
  type MediaPlaysQuery,
  mediaPlaysQuerySchema,
  type MediaPlaysResponse,
  type TopMediaQuery,
  topMediaQuerySchema,
  type TopMediaResponse,
} from '@aurboda/api-spec'

import { getMediaPlayById, getMediaPlays } from '../db/index.ts'
import { getTopMedia } from '../services/queries/index.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

export const createMediaRouter = (
  authMiddleware: AnyMiddleware,
  getPlays: (user: string, window: { start: Date; end: Date }) => Promise<MediaPlay[]> = getMediaPlays,
  getPlay: (user: string, id: string) => Promise<MediaPlay | null> = getMediaPlayById,
  getTop: typeof getTopMedia = getTopMedia,
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, TopMediaResponse, unknown, TopMediaQuery>(
    '/plays/top',
    authMiddleware,
    validateQuery(topMediaQuerySchema),
    async (req, res) => {
      const { by, end, limit, source, start } = req.query
      const top = await getTop(req.user!, { end: new Date(end), start: new Date(start) }, by, limit, source)
      res.json({ data: top, success: true })
    },
  )

  router.get<Record<string, never>, MediaPlaysResponse, unknown, MediaPlaysQuery>(
    '/plays',
    authMiddleware,
    validateQuery(mediaPlaysQuerySchema),
    async (req, res) => {
      const plays = await getPlays(req.user!, {
        end: new Date(req.query.end),
        start: new Date(req.query.start),
      })
      res.json({ data: plays, success: true })
    },
  )

  router.get<Record<string, never>, MediaPlayResponse, unknown, MediaPlayQuery>(
    '/play',
    authMiddleware,
    validateQuery(mediaPlayQuerySchema),
    async (req, res) => {
      const play = await getPlay(req.user!, req.query.id)
      if (!play) {
        res.status(404).json({ error: 'Media play not found', success: false })
        return
      }
      res.json({ data: play, success: true })
    },
  )

  return router
}
