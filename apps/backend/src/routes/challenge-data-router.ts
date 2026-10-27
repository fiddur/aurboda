/**
 * Served by a member's own instance: returns only that member's series for the
 * one challenge the token belongs to (minimal projection — the host pulls this
 * to build standings), with how it was scored so the host can check both sides
 * agree. The username scopes which per-user database to read; the unguessable
 * token is the capability.
 */
import type { ChallengeDataResponse } from '@aurboda/api-spec'

import { isValidUsername } from '../api/auth-routes.ts'
import { getParticipationByToken, isMissingDatabase } from '../db/index.ts'
import { resolveMemberSeries } from '../services/challenge-spec.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'

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
        const { buckets, last_updated, total } = await resolveMemberSeries(
          username,
          participation.spec,
          participation.start_ts,
          participation.end_ts,
          participation.timezone,
        )
        const { aggregation, filter_field, filter_value, measure } = participation.spec
        res.setHeader('Cache-Control', 'public, max-age=60')
        res.json({
          aggregation,
          buckets,
          display_name: username,
          last_updated,
          success: true,
          total,
          unit: participation.spec.unit,
          ...(measure !== null ? { measure } : {}),
          ...(filter_field !== null ? { filter_field } : {}),
          ...(filter_value !== null ? { filter_value } : {}),
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
