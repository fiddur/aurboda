import type { RequestHandler } from 'express'

/**
 * Feed *followers* route group (owner-facing) — manage the remote actors that
 * follow this user: list them (all, or just pending requests / accepted), and —
 * when the user requires manual approval — approve or reject a request.
 *
 * Handles: /feed/followers/*
 *
 * Listing is pure DB; approve/reject go through the injected `FollowerActions`
 * (which flip the row and send the signed `Accept` / `Reject`), keeping this
 * router decoupled from the ActivityPub layer. A `DELETE` on an already-accepted
 * follower removes them (also sends a `Reject`).
 */
import {
  type FollowerResponse,
  type FollowersQuery,
  type FollowersResponse,
  followersQuerySchema,
} from '@aurboda/api-spec'

import { listFeedFollowers } from '../db/index.ts'
import { type FollowerActions, serializeFollower } from '../services/followers.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

/** Map the `status` filter to the DB list options. */
const statusFilter = (status: FollowersQuery['status']): { accepted?: boolean } => {
  if (status === 'pending') return { accepted: false }
  if (status === 'accepted') return { accepted: true }
  return {}
}

export const createFeedFollowersRouter = (
  authMiddleware: RequestHandler,
  actions: FollowerActions,
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, FollowersResponse, unknown, FollowersQuery>(
    '/',
    authMiddleware,
    validateQuery(followersQuerySchema),
    async (req, res) => {
      const user = req.user!
      const records = await listFeedFollowers(user, statusFilter(req.query.status))
      res.json({ followers: records.map(serializeFollower), success: true })
    },
  )

  router.post<{ id: string }, FollowerResponse>('/:id/approve', authMiddleware, async (req, res) => {
    const user = req.user!
    const follower = await actions.approve(user, req.params.id)
    if (!follower) {
      return res.status(404).json({ error: 'No such follower', success: false })
    }
    res.json({ follower, success: true })
  })

  router.delete<{ id: string }, FollowerResponse>('/:id', authMiddleware, async (req, res) => {
    const user = req.user!
    const removed = await actions.reject(user, req.params.id)
    if (!removed) {
      return res.status(404).json({ error: 'No such follower', success: false })
    }
    res.json({ success: true })
  })

  return router
}
