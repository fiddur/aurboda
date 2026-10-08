import type { TrackBackfillResponse } from '@aurboda/api-spec'
import type { RequestHandler } from 'express'

import {
  backfillUserTracks,
  defaultTrackBackfillDeps,
  type TrackBackfillDeps,
} from '../services/track-backfill.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'

export const createTracksRouter = (
  authMiddleware: RequestHandler,
  deps: TrackBackfillDeps = defaultTrackBackfillDeps,
): TypedRouter => {
  const router = typedRouter()

  router.post<Record<string, never>, TrackBackfillResponse>('/backfill', authMiddleware, async (req, res) => {
    const result = await backfillUserTracks(req.user!, deps)
    res.json({ data: result, success: true })
  })

  return router
}
