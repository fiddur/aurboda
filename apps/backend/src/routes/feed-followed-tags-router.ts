import type { RequestHandler } from 'express'

import {
  type BaseResponse,
  type FollowedTagsResponse,
  type FollowTagBody,
  followTagBodySchema,
  type FollowTagResponse,
} from '@aurboda/api-spec'

import { listFeedFollowedTags } from '../db/index.ts'
import { type FollowActions, serializeFollowedTag } from '../services/following.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

/**
 * Followed hashtags: each is the follow of its tag actor on the tag actor host,
 * addressed here by the tag itself (unique per user). Mounted before `/feed`.
 */
export const createFeedFollowedTagsRouter = (
  authMiddleware: RequestHandler,
  actions: FollowActions,
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, FollowedTagsResponse>('/', authMiddleware, async (req, res) => {
    const records = await listFeedFollowedTags(req.user!)
    res.json({
      followed_tags: records.flatMap((record) => serializeFollowedTag(record) ?? []),
      success: true,
    })
  })

  router.post<Record<string, never>, FollowTagResponse, FollowTagBody>(
    '/',
    authMiddleware,
    validateBody(followTagBodySchema),
    async (req, res) => {
      const result = await actions.followTag(req.user!, req.body.tag)
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, success: false })
      }
      res.json({ followed_tag: serializeFollowedTag(result.record) ?? undefined, success: true })
    },
  )

  router.delete<{ tag: string }, BaseResponse>('/:tag', authMiddleware, async (req, res) => {
    const removed = await actions.unfollowTag(req.user!, req.params.tag)
    if (!removed) {
      return res.status(404).json({ error: 'Not following that tag', success: false })
    }
    res.json({ success: true })
  })

  return router
}
