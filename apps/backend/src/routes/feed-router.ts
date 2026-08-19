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
  type ArticleExportResponse,
  type BaseResponse,
  type CreateArticleBody,
  createArticleBodySchema,
  type FeedPostResponse,
  type FeedPostsResponse,
  type ShareActivityBody,
  shareActivityBodySchema,
  type TimelineQuery,
  timelineQuerySchema,
  type TimelineResponse,
  type UpdateArticleBody,
  updateArticleBodySchema,
  type UpdateFeedPostBody,
  updateFeedPostBodySchema,
} from '@aurboda/api-spec'

import type { Activity, FeedPostRecord } from '../db/index.ts'
import type { TimelineHub } from '../services/timeline-hub.ts'

import {
  createArticlePost,
  createFeedPost,
  deleteFeedPost,
  getActivityById,
  getFeedPostById,
  listFeedPosts,
  updateFeedPost,
} from '../db/index.ts'
import { isPubliclyVisible } from '../services/activitypub/object.ts'
import { buildArticleMarkdown } from '../services/article-export.ts'
import { buildArticleContent, mergeArticleContent } from '../services/article.ts'
import { normalizeFeedMessage, serializeFeedPost } from '../services/feed.ts'
import { getTimelinePage } from '../services/timeline.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

/**
 * Fire-and-forget federation delivery hooks for the feed-post lifecycle,
 * injected so the router + MCP tools stay decoupled from the ActivityPub layer
 * (and testable without it). Each impl signs + fans the corresponding activity
 * out to the user's followers: `created` → `Create`, `updated` → `Update`,
 * `deleted` → `Delete{Tombstone}`.
 *
 * `created` receives the activity because the share handler already resolved it
 * (for the 404 check), so there's no double fetch. `updated`/`deleted` take only
 * the post: their implementation resolves whatever it needs *inside* the
 * fire-and-forget boundary, so a post-mutation lookup can never turn a
 * successful edit/delete into a 500.
 */
export interface FeedDeliver {
  created: (user: string, post: FeedPostRecord, activity: Activity) => void
  updated: (user: string, post: FeedPostRecord) => void
  deleted: (user: string, post: FeedPostRecord) => void
  /** Fan a freshly-published article out to followers (no linked activity). */
  createdArticle: (user: string, post: FeedPostRecord) => void
  /** Federate an article edit as an `Update` so followers replace the stored object. */
  updatedArticle: (user: string, post: FeedPostRecord) => void
}

export const createFeedRouter = (
  authMiddleware: AnyMiddleware,
  deliver?: FeedDeliver,
  hub?: TimelineHub,
  apiBaseUrl?: string,
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, FeedPostsResponse>('/', authMiddleware, async (req, res) => {
    const user = req.user!
    const records = await listFeedPosts(user)
    const posts = await Promise.all(
      records.map((record) => serializeFeedPost(user, record, { includeStructured: true })),
    )
    res.json({ posts, success: true })
  })

  // Live home-timeline updates over Server-Sent Events. Each ping (`event: new`)
  // means "a new post arrived — refetch the newest page"; the payload is empty so
  // no post content crosses the wire. The client falls back to polling if this
  // stream can't be opened or drops. Registered before `/:postId`-style routes.
  router.get<Record<string, never>, BaseResponse>('/timeline/stream', authMiddleware, async (req, res) => {
    const user = req.user!
    if (!hub) return res.status(503).json({ error: 'Live updates unavailable', success: false })

    // `X-Accel-Buffering: no` tells nginx not to buffer the stream (SSE needs
    // each event flushed immediately, not held back for a full response body).
    res.writeHead(200, {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
      'X-Accel-Buffering': 'no',
    })
    const write = (chunk: string) => {
      if (res.writableEnded) return
      try {
        res.write(chunk)
      } catch {
        /* client vanished mid-write */
      }
    }
    write(': connected\n\n')

    // Comment heartbeats keep the connection from being reaped as idle.
    const heartbeat = setInterval(() => write(': ping\n\n'), 25_000)
    let unsubscribe: (() => Promise<void>) | null = null
    let closed = false
    const cleanup = async () => {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
      if (unsubscribe) await unsubscribe().catch(() => {})
    }
    req.on('close', () => void cleanup())

    try {
      unsubscribe = await hub.subscribe(user, () => write('event: new\ndata: {}\n\n'))
      // The client may have disconnected while the channel was opening.
      if (closed) await unsubscribe().catch(() => {})
    } catch {
      // Couldn't open the live channel — end the stream so the client polls instead.
      await cleanup()
      if (!res.writableEnded) res.end()
    }
  })

  router.get<Record<string, never>, TimelineResponse, unknown, TimelineQuery>(
    '/timeline',
    authMiddleware,
    validateQuery(timelineQuerySchema),
    async (req, res) => {
      const user = req.user!
      const { entries, next_cursor } = await getTimelinePage(user, req.query.limit, req.query.cursor)
      res.json({ entries, next_cursor, success: true })
    },
  )

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
        message: normalizeFeedMessage(req.body.message) ?? null,
        series_metrics: req.body.series_metrics,
        visibility: req.body.visibility,
      })
      // Fan the post out to followers (best-effort; never blocks the response).
      deliver?.created(user, record, activity)
      res.json({ post: await serializeFeedPost(user, record, { includeStructured: true }), success: true })
    },
  )

  // Article posts (long-form: title + prose + inline chart/correlation blocks).
  // Create/edit have their own body shape; delete reuses `DELETE /:postId`.
  // Registered before the generic `/:postId` routes. Federated as a `Note`
  // (fan-out is best-effort and never blocks the response).
  router.post<Record<string, never>, FeedPostResponse, CreateArticleBody>(
    '/articles',
    authMiddleware,
    validateBody(createArticleBodySchema),
    async (req, res) => {
      const user = req.user!
      const built = buildArticleContent({
        blocks: req.body.blocks,
        default_end: req.body.default_end,
        default_start: req.body.default_start,
        title: req.body.title,
      })
      if (!built.ok) return res.status(400).json({ error: built.error, success: false })
      const record = await createArticlePost(user, {
        article: built.article,
        visibility: req.body.visibility,
      })
      deliver?.createdArticle(user, record)
      res.json({ post: await serializeFeedPost(user, record), success: true })
    },
  )

  router.patch<{ postId: string }, FeedPostResponse, UpdateArticleBody>(
    '/articles/:postId',
    authMiddleware,
    validateBody(updateArticleBodySchema),
    async (req, res) => {
      const user = req.user!
      const existing = await getFeedPostById(user, req.params.postId)
      if (!existing || existing.kind !== 'article' || existing.article == null) {
        return res.status(404).json({ error: 'Article not found', success: false })
      }
      const built = buildArticleContent(mergeArticleContent(existing.article, req.body))
      if (!built.ok) return res.status(400).json({ error: built.error, success: false })
      const record = await updateFeedPost(user, req.params.postId, {
        article: built.article,
        visibility: req.body.visibility,
      })
      if (!record) return res.status(404).json({ error: 'Article not found', success: false })
      deliver?.updatedArticle(user, record)
      res.json({ post: await serializeFeedPost(user, record), success: true })
    },
  )

  // Reddit/markdown export (C4): a paste-ready rendering of the article's title
  // + prose + one image link per chart/correlation block (the C1 endpoint).
  // Registered before the generic `/:postId` routes, like the other `/articles`
  // sub-routes.
  router.get<{ postId: string }, ArticleExportResponse>(
    '/articles/:postId/export',
    authMiddleware,
    async (req, res) => {
      const user = req.user!
      const post = await getFeedPostById(user, req.params.postId)
      if (!post || post.kind !== 'article' || post.article == null) {
        return res.status(404).json({ error: 'Article not found', success: false })
      }
      // The export is for pasting to a PUBLIC destination; a followers-only
      // article's chart images require its private capability token, so refuse
      // rather than emit that token into publicly-pasted text.
      if (!isPubliclyVisible(post.visibility)) {
        return res.status(400).json({
          error:
            'A followers-only article can’t be exported — its charts need a private link. Make it public or unlisted first.',
          success: false,
        })
      }
      if (!apiBaseUrl) {
        return res.status(503).json({ error: 'Export is not available', success: false })
      }
      const markdown = buildArticleMarkdown(
        apiBaseUrl,
        user,
        post.id,
        post.visibility,
        post.image_token,
        post.updated_at,
        post.article,
      )
      res.json({ markdown, success: true })
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
        message: normalizeFeedMessage(req.body.message),
        series_metrics: req.body.series_metrics,
        visibility: req.body.visibility,
      })
      if (!record) {
        return res.status(404).json({ error: 'Feed post not found', success: false })
      }
      // Federate the edit as an Update so followers replace the stored object.
      // Fire-and-forget: the impl resolves what it needs, so it can't 500 here.
      // An article (e.g. a visibility flip via this generic route) has no linked
      // activity, so it must go through the article path — `updated` would no-op.
      if (record.kind === 'article') deliver?.updatedArticle(user, record)
      else deliver?.updated(user, record)
      res.json({ post: await serializeFeedPost(user, record, { includeStructured: true }), success: true })
    },
  )

  router.delete<{ postId: string }, FeedPostResponse>('/:postId', authMiddleware, async (req, res) => {
    const user = req.user!
    // Capture the post before deleting so its Delete can be addressed by the
    // same visibility and reference the right object id.
    const existing = await getFeedPostById(user, req.params.postId)
    const deleted = await deleteFeedPost(user, req.params.postId)
    if (!deleted || !existing) {
      return res.status(404).json({ error: 'Feed post not found', success: false })
    }
    deliver?.deleted(user, existing)
    res.json({ success: true })
  })

  return router
}
