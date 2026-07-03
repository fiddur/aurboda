import type { RequestHandler } from 'express'

/**
 * Feed *following* route group (owner-facing) — the inbound direction of the
 * feed: manage the actors this user follows.
 *
 * Handles: /feed/following/*
 *
 * Mounted before `/feed` so its two-segment paths win cleanly. Listing is pure
 * DB; following/unfollowing go through the injected `FollowActions` (which
 * resolve the actor + send the signed `Follow` / `Undo{Follow}`), keeping this
 * router decoupled from the ActivityPub layer.
 */
import {
  type FollowActorBody,
  followActorBodySchema,
  type FollowActorResponse,
  type FollowingResponse,
} from '@aurboda/api-spec'

import { listFeedFollowing } from '../db/index.ts'
import { type FollowActions, serializeFollowing } from '../services/following.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

export const createFeedFollowingRouter = (
  authMiddleware: RequestHandler,
  actions: FollowActions,
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, FollowingResponse>('/', authMiddleware, async (req, res) => {
    const user = req.user!
    const records = await listFeedFollowing(user)
    res.json({ following: records.map(serializeFollowing), success: true })
  })

  router.post<Record<string, never>, FollowActorResponse, FollowActorBody>(
    '/',
    authMiddleware,
    validateBody(followActorBodySchema),
    async (req, res) => {
      const user = req.user!
      const result = await actions.follow(user, req.body.handle)
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, success: false })
      }
      res.json({ actor: serializeFollowing(result.record), success: true })
    },
  )

  router.delete<{ id: string }, FollowActorResponse>('/:id', authMiddleware, async (req, res) => {
    const user = req.user!
    const removed = await actions.unfollow(user, req.params.id)
    if (!removed) {
      return res.status(404).json({ error: 'Not following that actor', success: false })
    }
    res.json({ success: true })
  })

  return router
}
