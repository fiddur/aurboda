/**
 * Public feed read surface (UNAUTHENTICATED).
 *
 * Handles: GET /public/:username/series
 *
 * Returns bucketed samples for a single metric over a window — but ONLY when a
 * feed post explicitly shared that metric as a series for an activity whose
 * window covers the request. There is no auth token (this is deliberately
 * public, like a shared-dashboard slug), so the data-driven scoping in
 * `resolvePublicSeries` is the entire privacy boundary. Unshared metrics and
 * out-of-window ranges 404.
 *
 * Mounted BEFORE the generic `/public/:username/:slug` resolver so `series` is
 * never mistaken for a share slug.
 */
import {
  type FeedPostsResponse,
  type FeedPostStructuredResponse,
  type FeedStructuredPost,
  type PublicSeriesQuery,
  publicSeriesQuerySchema,
  type PublicSeriesResponse,
} from '@aurboda/api-spec'

import { isValidUsername } from '../api/auth-routes.ts'
import { findCoveringSharedSeriesWindow, isMissingDatabase, listPublicFeedPostsPage } from '../db/index.ts'
import { resolvePublicSeries } from '../services/feed-series.ts'
import { loadAuthorizedStructuredPost, resolveStructuredContent } from '../services/feed-structured.ts'
import { serializeFeedPost } from '../services/feed.ts'
import { queryMetricsBucketed } from '../services/queries/index.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'
import { createRenderCache } from './feed-image-router.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Most recent public/unlisted posts returned for a profile's feed (newest-first). */
const PROFILE_FEED_LIMIT = 50

export const createFeedPublicRouter = (): TypedRouter => {
  const router = typedRouter()
  // Caches the resolved structured payload OBJECT for the unauthenticated
  // `/feed/:postId` endpoint, which resolves up to 100 blocks per request — the
  // same bounded LRU + in-flight de-dup the block images use. The route authorizes
  // the post BEFORE consulting this cache (like the sibling image routes), so the
  // capability token is NOT part of the key: a `followers`-only payload never
  // reaches the cache via a public request, and an anonymous `?token=…` walk can't
  // inflate the key space. Keyed on `updated_at` AND a coarse hourly bucket — the
  // SAME two-part key the block-image cache uses for the same live-resolved article
  // data: `updated_at` busts on an edit, and the hourly term bounds staleness from
  // *backfilled measurements inside an already-locked window* (which don't touch
  // `updated_at`) to ≤1h, so this endpoint can't freeze into a lifetime snapshot
  // while its own PNG stays live (#934 locks the window, not the data). A smaller
  // cap than the image LRU because a payload can be large (per-block sample cap is
  // #972). Producing `null` (no content) isn't cached.
  const structuredCache = createRenderCache<FeedStructuredPost>(50)

  router.get<{ username: string }, PublicSeriesResponse, unknown, PublicSeriesQuery>(
    '/public/:username/series',
    validateQuery(publicSeriesQuerySchema),
    async (req, res) => {
      const { username } = req.params
      if (!isValidUsername(username)) {
        return res.status(404).json({ error: 'Not found', success: false })
      }
      const { bucket, end, metric, start } = req.query
      try {
        const result = await resolvePublicSeries(metric, new Date(start), new Date(end), bucket, {
          findCoveringWindow: (m, s, e) => findCoveringSharedSeriesWindow(username, m, s, e),
          queryBucketed: (m, s, e, b) => queryMetricsBucketed(username, [m], s, e, b, {}),
        })
        if (!result) {
          return res.status(404).json({ error: 'Not found', success: false })
        }
        // `no-store`: sharing is revocable (delete the post, flip it to
        // `followers`, or drop the metric from `series_metrics`) and must take
        // effect immediately, so shared caches/CDNs must never serve a series
        // that was just un-shared.
        res.setHeader('Cache-Control', 'no-store')
        res.json({ ...result, success: true })
      } catch (error) {
        if (isMissingDatabase(error)) {
          return res.status(404).json({ error: 'Not found', success: false })
        }
        throw error
      }
    },
  )

  // A user's public feed for their profile page: the most recent `public`/
  // `unlisted` posts, newest-first (same set as the ActivityPub outbox — never
  // `followers`-only). Serialized exactly like the authenticated `/feed`, so the
  // web renders them with the same post card. Bounded to the latest page.
  // `no-store` like the sibling `/series` and `/feed/:postId` endpoints: sharing
  // is revocable, so flipping a post to `followers` or deleting it must drop it
  // from the profile immediately, never linger in a shared cache. Mounted before
  // the generic `/public/:username/:slug` resolver so `posts` is never mistaken
  // for a share slug.
  router.get<{ username: string }, FeedPostsResponse>('/public/:username/posts', async (req, res) => {
    const { username } = req.params
    // The response reuses the authed `/feed` shape (which requires `posts`), so a
    // 404 carries an empty list rather than a bare error body.
    if (!isValidUsername(username)) {
      return res.status(404).json({ error: 'Not found', posts: [], success: false })
    }
    try {
      const records = await listPublicFeedPostsPage(username, PROFILE_FEED_LIMIT, 0)
      const posts = await Promise.all(records.map((record) => serializeFeedPost(username, record)))
      res.setHeader('Cache-Control', 'no-store')
      res.json({ posts, success: true })
    } catch (error) {
      if (isMissingDatabase(error)) {
        return res.status(404).json({ error: 'Not found', posts: [], success: false })
      }
      throw error
    }
  })

  // The native structured post (typed metrics + inline series) another Aurboda
  // instance fetches on ingest to render a chart. Same data-scoping as `/series`
  // and only the metrics/series actually shared. `public`/`unlisted` resolve
  // unconditionally; a `followers`-only post resolves only with a matching
  // capability `?token=` (the same token that authorizes its followers-only
  // images), so an accepted follower's instance can render the native chart.
  // `no-store` for the same revocability reason as the series endpoint.
  router.get<{ username: string; postId: string }, FeedPostStructuredResponse, unknown, { token?: string }>(
    '/public/:username/feed/:postId',
    async (req, res) => {
      const { postId, username } = req.params
      if (!isValidUsername(username) || !UUID_RE.test(postId)) {
        return res.status(404).json({ error: 'Not found', success: false })
      }
      const token = typeof req.query.token === 'string' ? req.query.token : undefined
      try {
        // Authorize BEFORE the cache: an unauthorized post 404s and never reaches
        // it, so the token stays out of the key and a revoked/flipped post stops
        // resolving immediately. Cache keyed on `updated_at` so an edit busts it.
        const post = await loadAuthorizedStructuredPost(username, postId, token)
        if (!post) {
          return res.status(404).json({ error: 'Not found', success: false })
        }
        const key = `structured:${username}:${postId}:${post.updated_at.getTime()}:${Math.floor(Date.now() / 3_600_000)}`
        const structured = await structuredCache(key, () => resolveStructuredContent(username, post))
        if (!structured) {
          return res.status(404).json({ error: 'Not found', success: false })
        }
        res.setHeader('Cache-Control', 'no-store')
        res.json({ structured, success: true })
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
