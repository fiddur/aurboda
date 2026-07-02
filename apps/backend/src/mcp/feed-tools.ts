/**
 * MCP feed tools — publish activities to the user's federated feed and manage
 * the resulting posts. Mirrors the REST `/feed` capability.
 */
import { shareActivityBodySchema, updateFeedPostBodySchema } from '@aurboda/api-spec'
import { z } from 'zod'

import type { FeedPostRecord } from '../db/index.ts'
import type { FeedDeliver } from '../routes/feed-router.ts'

import {
  createFeedPost,
  deleteFeedPost,
  getActivityById,
  getFeedPostById,
  listFeedPosts,
  updateFeedPost,
} from '../db/index.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

const serialize = (record: FeedPostRecord) => ({
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

export const registerFeedTools = (server: McpServer, user: string, deliver?: FeedDeliver) => {
  server.tool(
    'list_feed',
    'List activities you have published to your feed, with their shared metric selection, series opt-in, and visibility.',
    {},
    async () => {
      const records = await listFeedPosts(user)
      return jsonResponse(records.map(serialize))
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
      return jsonResponse(serialize(record))
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
      if (record.activity_id) {
        const activity = await getActivityById(user, record.activity_id)
        if (activity) deliver?.updated(user, record, activity)
      }
      return jsonResponse(serialize(record))
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
}
