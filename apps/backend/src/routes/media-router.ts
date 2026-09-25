import {
  type MediaPlay,
  type MediaPlaysQuery,
  mediaPlaysQuerySchema,
  type MediaPlaysResponse,
} from '@aurboda/api-spec'

import { getMediaPlays } from '../db/index.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

export const createMediaRouter = (
  authMiddleware: AnyMiddleware,
  getPlays: (user: string, window: { start: Date; end: Date }) => Promise<MediaPlay[]> = getMediaPlays,
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

  return router
}
