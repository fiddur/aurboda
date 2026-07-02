import type { RequestHandler } from 'express'

/**
 * Feed route group (owner-facing).
 *
 * Handles: /feed/*
 *
 * Publish an activity to the user's federated feed with an explicit metric
 * selection, and manage the resulting posts. Consistent with the other
 * owner-facing routers, the acting user comes from `req.user` (not the path);
 * the public read surface lives in `feed-public-router.ts`.
 */
import {
  type FeedPost,
  type FeedPostResponse,
  type FeedPostsResponse,
  type ShareActivityBody,
  shareActivityBodySchema,
  type UpdateFeedPostBody,
  updateFeedPostBodySchema,
} from '@aurboda/api-spec'

import type { FeedPostRecord } from '../db/index.ts'

import {
  createFeedPost,
  deleteFeedPost,
  getActivityById,
  listFeedPosts,
  updateFeedPost,
} from '../db/index.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

const serialize = (record: FeedPostRecord): FeedPost => ({
  activity_id: record.activity_id,
  created_at: record.created_at.toISOString(),
  id: record.id,
  include_chart: record.include_chart,
  include_map: record.include_map,
  included_metrics: record.included_metrics,
  series_metrics: record.series_metrics,
  updated_at: record.updated_at.toISOString(),
  visibility: record.visibility,
})

export const createFeedRouter = (authMiddleware: RequestHandler): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, FeedPostsResponse>('/', authMiddleware, async (req, res) => {
    const user = req.user!
    const records = await listFeedPosts(user)
    res.json({ posts: records.map(serialize), success: true })
  })

  router.post<{ id: string }, FeedPostResponse, ShareActivityBody>(
    '/activities/:id/share',
    authMiddleware,
    validateBody(shareActivityBodySchema),
    async (req, res) => {
      const user = req.user!
      const activity = await getActivityById(user, req.params.id)
      if (!activity) {
        return res.status(404).json({ error: 'Activity not found', success: false })
      }
      const record = await createFeedPost(user, {
        activity_id: activity.id ?? req.params.id,
        include_chart: req.body.include_chart,
        include_map: req.body.include_map,
        included_metrics: req.body.included_metrics,
        series_metrics: req.body.series_metrics,
        visibility: req.body.visibility,
      })
      res.json({ post: serialize(record), success: true })
    },
  )

  router.patch<{ postId: string }, FeedPostResponse, UpdateFeedPostBody>(
    '/:postId',
    authMiddleware,
    validateBody(updateFeedPostBodySchema),
    async (req, res) => {
      const user = req.user!
      const record = await updateFeedPost(user, req.params.postId, {
        include_chart: req.body.include_chart,
        include_map: req.body.include_map,
        included_metrics: req.body.included_metrics,
        series_metrics: req.body.series_metrics,
        visibility: req.body.visibility,
      })
      if (!record) {
        return res.status(404).json({ error: 'Feed post not found', success: false })
      }
      res.json({ post: serialize(record), success: true })
    },
  )

  router.delete<{ postId: string }, FeedPostResponse>('/:postId', authMiddleware, async (req, res) => {
    const user = req.user!
    const deleted = await deleteFeedPost(user, req.params.postId)
    if (!deleted) {
      return res.status(404).json({ error: 'Feed post not found', success: false })
    }
    res.json({ success: true })
  })

  return router
}
