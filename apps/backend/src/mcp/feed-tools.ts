/**
 * MCP feed tools — publish activities to the user's federated feed, manage the
 * resulting posts, and follow/unfollow other actors. Mirrors the REST `/feed`
 * and `/feed/following` capabilities.
 */
import {
  createArticleBodySchema,
  followActorBodySchema,
  followersQuerySchema,
  shareActivityBodySchema,
  timelineQuerySchema,
  updateArticleBodySchema,
  updateFeedPostBodySchema,
  updateFollowingBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import type { FeedDeliver } from '../routes/feed-router.ts'
import type { FollowerActions } from '../services/followers.ts'
import type { FollowActions } from '../services/following.ts'
import type { RetroEnrichTrigger } from '../services/timeline-retro-enrich.ts'

import {
  createArticlePost,
  createFeedPost,
  deleteFeedPost,
  getActivityById,
  getFeedPostById,
  listFeedFollowers,
  listFeedFollowing,
  listFeedPosts,
  updateFeedFollowingNotify,
  updateFeedPost,
} from '../db/index.ts'
import { isPubliclyVisible } from '../services/activitypub/object.ts'
import { buildArticleMarkdown, renderableArticleBlocks } from '../services/article-export.ts'
import { buildArticleContent, mergeArticleContent } from '../services/article.ts'
import { normalizeFeedMessage, serializeFeedPost } from '../services/feed.ts'
import { serializeFollower } from '../services/followers.ts'
import { serializeFollowing } from '../services/following.ts'
import { getSettings } from '../services/settings.ts'
import { getTimelinePage } from '../services/timeline.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

/** Map the `status` filter to the follower-list DB options. */
const followerStatusFilter = (status: 'accepted' | 'all' | 'pending'): { accepted?: boolean } => {
  if (status === 'pending') return { accepted: false }
  if (status === 'accepted') return { accepted: true }
  return {}
}

/** The injectable collaborators behind the feed tools (all optional). */
export interface FeedToolsOptions {
  deliver?: FeedDeliver
  followActions?: FollowActions
  followerActions?: FollowerActions
  apiBaseUrl?: string
  retroEnrichTimeline?: RetroEnrichTrigger
}

export const registerFeedTools = (server: McpServer, user: string, options: FeedToolsOptions = {}) => {
  const { apiBaseUrl, deliver, followActions, followerActions, retroEnrichTimeline } = options
  server.tool(
    'list_feed',
    'List activities you have published to your feed, with their shared metric selection, series opt-in, and visibility.',
    {},
    async () => {
      const records = await listFeedPosts(user)
      const settings = await getSettings(user).catch(() => null)
      return jsonResponse(
        await Promise.all(records.map((record) => serializeFeedPost(user, record, { settings }))),
      )
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
        message: normalizeFeedMessage(body.message) ?? null,
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
        message: normalizeFeedMessage(body.message),
        series_metrics: body.series_metrics,
        visibility: body.visibility,
      })
      if (!record) return errorResponse('Feed post not found')
      // Federate the edit as an Update, same as the REST update route. An article
      // has no linked activity, so route it through the article path.
      if (record.kind === 'article') deliver?.updatedArticle(user, record)
      else deliver?.updated(user, record)
      return jsonResponse(await serializeFeedPost(user, record))
    },
  )

  server.tool(
    'create_article',
    'Publish a long-form ARTICLE to your feed: a title, markdown prose, and inline chart blocks over locked time windows. `blocks` is an ordered list of `{type:"prose", markdown}` or `{type:"chart", metric, start?, end?, bucket?, caption?}`. A chart block over `[start, end]` re-resolves live against that window; omit its start/end to inherit `default_start`/`default_end`. Use this (not `share_activity`) for a written analysis spanning multiple charts.',
    { ...createArticleBodySchema.shape },
    async (body) => {
      const built = buildArticleContent({
        blocks: body.blocks,
        default_end: body.default_end,
        default_start: body.default_start,
        title: body.title,
      })
      if (!built.ok) return errorResponse(built.error)
      const record = await createArticlePost(user, { article: built.article, visibility: body.visibility })
      deliver?.createdArticle(user, record)
      return jsonResponse(await serializeFeedPost(user, record))
    },
  )

  server.tool(
    'update_article',
    'Update an ARTICLE post (title, blocks, default window, visibility). Provided fields replace the stored ones; omitted fields are unchanged. The `blocks` array, when given, replaces the whole ordered block list.',
    { id: z.string().uuid().describe('Feed post ID'), ...updateArticleBodySchema.shape },
    async ({ id, ...body }) => {
      const existing = await getFeedPostById(user, id)
      if (!existing || existing.kind !== 'article' || existing.article == null) {
        return errorResponse('Article not found')
      }
      const built = buildArticleContent(mergeArticleContent(existing.article, body))
      if (!built.ok) return errorResponse(built.error)
      const record = await updateFeedPost(user, id, { article: built.article, visibility: body.visibility })
      if (!record) return errorResponse('Article not found')
      deliver?.updatedArticle(user, record)
      return jsonResponse(await serializeFeedPost(user, record))
    },
  )

  server.tool(
    'export_article_markdown',
    'Export a published ARTICLE as paste-ready markdown for a text-only destination (e.g. r/QuantifiedSelf): the title, the prose blocks verbatim, and one image link per chart/correlation block pointing at its rendered PNG. Paste the result and add your own write-up around the linked charts.',
    { id: z.string().uuid().describe('Feed post ID (must be an article)') },
    async ({ id }) => {
      const post = await getFeedPostById(user, id)
      if (!post || post.kind !== 'article' || post.article == null) return errorResponse('Article not found')
      // Export targets a public paste; a followers-only article's images need its
      // private token, so refuse rather than leak it (parity with the REST route).
      if (!isPubliclyVisible(post.visibility)) {
        return errorResponse(
          'A followers-only article can’t be exported — its charts need a private link. Make it public or unlisted first.',
        )
      }
      if (!apiBaseUrl) return errorResponse('Export is not available')
      const markdown = buildArticleMarkdown(
        apiBaseUrl,
        user,
        post.id,
        post.visibility,
        post.image_token,
        post.updated_at,
        post.article,
        // Blocks whose image would 404 (no data) get a note, not a dead link (#974).
        await renderableArticleBlocks(user, post.article),
      )
      return jsonResponse({ markdown })
    },
  )

  server.tool(
    'delete_feed_post',
    'Delete a feed post (activity share or article) by ID. Unpublishes it and stops its public series from resolving.',
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
    'list_timeline',
    'List your home timeline: posts received from the actors you follow, newest first. Pass `cursor` (from a previous call) to page.',
    { ...timelineQuerySchema.shape },
    async ({ cursor, limit }) => {
      const page = await getTimelinePage(user, limit, cursor)
      retroEnrichTimeline?.(user)
      return jsonResponse(page)
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

  server.tool(
    'set_following_notify',
    'Enable or disable notifications for new posts from a followed actor (by the local follow id from `list_following`).',
    {
      id: z.string().uuid().describe('Local follow id (the `id` from list_following)'),
      ...updateFollowingBodySchema.shape,
    },
    async ({ id, notify_on_post }) => {
      const record = await updateFeedFollowingNotify(user, id, notify_on_post)
      if (!record) return errorResponse('Not following that actor')
      return jsonResponse(serializeFollowing(record))
    },
  )

  server.tool(
    'list_followers',
    'List the actors that follow you, with their handle, display name, and acceptance state. Pass `status` to see only `pending` follow requests or only `accepted` followers (default `all`). Requests are pending only when you have enabled manual follower approval.',
    { ...followersQuerySchema.shape },
    async ({ status }) => {
      const records = await listFeedFollowers(user, followerStatusFilter(status))
      return jsonResponse(records.map(serializeFollower))
    },
  )

  server.tool(
    'approve_follower',
    'Approve a pending follow request by the local follower id (from `list_followers`). Marks them an accepted follower and sends the Accept.',
    { id: z.string().uuid().describe('Local follower id (the `id` from list_followers)') },
    async ({ id }) => {
      if (!followerActions) return errorResponse('Follower management is not available')
      const follower = await followerActions.approve(user, id)
      if (!follower) return errorResponse('No such follower')
      return jsonResponse(follower)
    },
  )

  server.tool(
    'reject_follower',
    'Reject a pending follow request, or remove an existing follower, by the local follower id (from `list_followers`). Sends a Reject and drops them.',
    { id: z.string().uuid().describe('Local follower id (the `id` from list_followers)') },
    async ({ id }) => {
      if (!followerActions) return errorResponse('Follower management is not available')
      const removed = await followerActions.reject(user, id)
      if (!removed) return errorResponse('No such follower')
      return jsonResponse({ id, rejected: true })
    },
  )
}
