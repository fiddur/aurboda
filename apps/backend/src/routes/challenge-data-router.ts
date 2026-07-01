/**
 * Member challenge data endpoint (UNAUTHENTICATED, capability-token gated).
 *
 * Handles: GET /challenge-data/:username/:token
 *
 * Served by a member's own instance: returns only that member's series for the
 * one challenge the token belongs to (minimal projection — the host pulls this
 * to build standings). The username scopes which per-user database to read; the
 * unguessable token is the capability.
 */
import type { ChallengeDataResponse } from '@aurboda/api-spec'

import { isValidUsername } from '../api/auth-routes.ts'
import { getParticipationByToken } from '../db/index.ts'
import { resolveMemberSeries } from '../services/challenge-spec.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'

const isMissingDatabase = (error: unknown): boolean =>
  error instanceof Error && (error as Error & { code?: string }).code === '3D000'

export const createChallengeDataRouter = (): TypedRouter => {
  const router = typedRouter()

  router.get<{ username: string; token: string }, ChallengeDataResponse>(
    '/challenge-data/:username/:token',
    async (req, res) => {
      const { token, username } = req.params
      if (!isValidUsername(username)) {
        return res.status(404).json({ error: 'Not found', success: false })
      }
      try {
        const participation = await getParticipationByToken(username, token)
        if (!participation || participation.status === 'withdrawn') {
          return res.status(404).json({ error: 'Not found', success: false })
        }
        const { buckets, total } = await resolveMemberSeries(
          username,
          participation.spec,
          participation.start_ts,
          participation.end_ts,
        )
        res.setHeader('Cache-Control', 'public, max-age=60')
        res.json({
          buckets,
          display_name: username,
          last_updated: new Date().toISOString(),
          success: true,
          total,
          unit: participation.spec.unit,
        })
      } catch (error) {
        if (isMissingDatabase(error)) {
          return res.status(404).json({ error: 'Not found', success: false })
        }
        throw error
      }
    },
  )

  return router
}
