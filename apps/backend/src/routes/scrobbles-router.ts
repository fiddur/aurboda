/**
 * Scrobbles route group — Last.fm scrobble queries.
 *
 * Reads from the activities table (activity_type='music_scrobble'), which is
 * populated during Last.fm sync alongside raw_records. The response shape
 * matches the legacy raw_records-based endpoint so the frontend music staff
 * renderer needs no changes.
 */
import type { ScrobblesResponse } from '@aurboda/api-spec'
import type { RequestHandler, Router } from 'express'

import { isMusicScrobbleActivity } from '@aurboda/api-spec'

import { getActivities } from '../db/index.ts'
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
        const activities = await getActivities(user, ['music_scrobble'], new Date(start), new Date(end))
        const serialized = activities.flatMap((a) => {
          if (!isMusicScrobbleActivity(a)) return []
          return [
            {
              album: a.data.album ?? '',
              artist: a.data.artist,
              recorded_at: a.start_time.toISOString(),
              track: a.data.track,
            },
          ]
        })
        res.json({ data: serialized, success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        res.status(500).json({ error: message, success: false })
      }
    },
  )

  return router as unknown as Router
}
