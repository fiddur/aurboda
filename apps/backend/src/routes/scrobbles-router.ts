/**
 * Scrobbles route group — Last.fm scrobble queries.
 */
import type { ScrobblesResponse } from '@aurboda/api-spec'

import type { RequestHandler, Router } from 'express'

import { getScrobbles } from '../db/index.ts'
import { typedRouter } from '../typed-router.ts'

export const createScrobblesRouter = (authMiddleware: RequestHandler): Router => {
  const router = typedRouter()

  router.get<Record<string, never>, ScrobblesResponse, unknown, { start?: string; end?: string }>(
    '/scrobbles',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const { start, end } = req.query

      if (!start || !end) {
        return res.status(400).json({ error: 'start and end query parameters are required', success: false })
      }

      try {
        const scrobbles = await getScrobbles(user, new Date(start), new Date(end))
        const serialized = scrobbles.map((s) => ({
          album: s.album,
          artist: s.artist,
          recorded_at: s.recorded_at.toISOString(),
          track: s.track,
        }))
        res.json({ data: serialized, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message, success: false })
      }
    },
  )

  return router as unknown as Router
}
