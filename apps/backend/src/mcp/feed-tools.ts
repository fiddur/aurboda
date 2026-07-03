/**
 * MCP feed tools — publish activities to the user's federated feed, manage the
 * resulting posts, and follow/unfollow other actors. Mirrors the REST `/feed`
 * and `/feed/following` capabilities.
 */
import { followActorBodySchema, shareActivityBodySchema, updateFeedPostBodySchema } from '@aurboda/api-spec'
import { z } from 'zod'

import type { FeedDeliver } from '../routes/feed-router.ts'
import type { FollowActions } from '../services/following.ts'

import {
  createFeedPost,
  deleteFeedPost,
  getActivityById,
  getFeedPostById,
  listFeedFollowing,
  listFeedPosts,
  updateFeedPost,
} from '../db/index.ts'
import { serializeFeedPost } from '../services/feed.ts'
import { serializeFollowing } from '../services/following.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerFeedTools = (
  server: McpServer,
  user: string,
  deliver?: FeedDeliver,
  followActions?: FollowActions,
) => {
  server.tool(
    'list_feed',
    'List activities you have published to your feed, with their shared metric selection, series opt-in, and visibility.',
    {},
    async () => {
      const records = await listFeedPosts(user)
      return jsonResponse(await Promise.all(records.map((record) => serializeFeedPost(user, record))))
    },
  )

  server.tool(
    'share_activity',
    'Publish an activity to your feed. `included_metrics` are the scalar summaries shared; `series_metrics` is a SEPARATE, explicit opt-in that also exposes those metrics on the public read-only series endpoint. Both default to empty (privacy-conservative) — a high-resolution series is far more revealing than an average, so only opt in deliberately.',
    { activity_id: z.string().uuid().describe('The activity to share'), ...shareActivityBodySchema.shape },
    async ({ activity_id, ...body }) => {
      const activity = await getActivityById(user, activity_id)
      if (!activity) return errorResponse('Activity not found')
      const record = await createFeedPost(user, {
        activity_id: activity.id ?? activity_id,
        include_chart: body.include_chart,
        include_map: body.include_map,
        included_metrics: body.included_metrics,
        series_metrics: body.series_metrics,
        visibility: body.visibility,
      })
      // Fan out to followers (best-effort), same as the REST share route.
      deliver?.created(user, record, activity)
      return jsonResponse(await serializeFeedPost(user, record))
    },
  )

  server.tool(
    'update_feed_post',
    'Update a feed post (scalar metric selection, series opt-in, visibility, attachments). Only provided fields change.',
    { id: z.string().uuid().describe('Feed post ID'), ...updateFeedPostBodySchema.shape },
    async ({ id, ...body }) => {
      const record = await updateFeedPost(user, id, {
        include_chart: body.include_chart,
        include_map: body.include_map,
        included_metrics: body.included_metrics,
        series_metrics: body.series_metrics,
        visibility: body.visibility,
      })
      if (!record) return errorResponse('Feed post not found')
      // Federate the edit as an Update, same as the REST update route.
      deliver?.updated(user, record)
      return jsonResponse(await serializeFeedPost(user, record))
    },
  )

  server.tool(
    'delete_feed_post',
    'Delete a feed post by ID. Unpublishes it and stops its public series from resolving.',
    { id: z.string().uuid().describe('Feed post ID') },
    async ({ id }) => {
      const existing = await getFeedPostById(user, id)
      if (!existing) return errorResponse('Feed post not found')
      await deleteFeedPost(user, id)
      // Retract from followers with a Delete{Tombstone}, same as the REST route.
      deliver?.deleted(user, existing)
      return jsonResponse({ deleted: true, id })
    },
  )

  server.tool(
    'list_following',
    'List the actors you follow (accepted and pending), with their handle, display name, and acceptance state.',
    {},
    async () => {
      const records = await listFeedFollowing(user)
      return jsonResponse(records.map(serializeFollowing))
    },
  )

  server.tool(
    'follow_actor',
    'Follow a fediverse actor so their posts arrive in your feed. `handle` is `@user@host`, `user@host`, or an actor URL. Sends a Follow; the follow is `pending` until the remote server accepts it.',
    { ...followActorBodySchema.shape },
    async ({ handle }) => {
      if (!followActions) return errorResponse('Following is not available')
      const result = await followActions.follow(user, handle)
      if (!result.ok) return errorResponse(result.error)
      return jsonResponse(serializeFollowing(result.record))
    },
  )

  server.tool(
    'unfollow_actor',
    'Unfollow an actor by the local follow id (from `list_following`). Sends an Undo{Follow} and removes them from your following list.',
    { id: z.string().uuid().describe('Local follow id (the `id` from list_following)') },
    async ({ id }) => {
      if (!followActions) return errorResponse('Following is not available')
      const removed = await followActions.unfollow(user, id)
      if (!removed) return errorResponse('Not following that actor')
      return jsonResponse({ id, unfollowed: true })
    },
  )
}
