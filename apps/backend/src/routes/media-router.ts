import {
  type MediaPlay,
  type MediaPlayResponse,
  type MediaPlaysQuery,
  mediaPlaysQuerySchema,
  type MediaPlaysResponse,
} from '@aurboda/api-spec'

import { getMediaPlayById, getMediaPlays } from '../db/index.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

export const createMediaRouter = (
  authMiddleware: AnyMiddleware,
  getPlays: (user: string, window: { start: Date; end: Date }) => Promise<MediaPlay[]> = getMediaPlays,
  getPlay: (user: string, id: string) => Promise<MediaPlay | null> = getMediaPlayById,
): TypedRouter => {
  const router = typedRouter()

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

  router.get<{ id: string }, MediaPlayResponse>('/plays/:id', authMiddleware, async (req, res) => {
    const play = await getPlay(req.user!, req.params.id)
    if (!play) {
      res.status(404).json({ error: 'Media play not found', success: false })
      return
    }
    res.json({ data: play, success: true })
  })

  return router
}
