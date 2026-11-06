/**
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
  type ArticleContent,
  type FeedPost,
  type FeedPostResponse,
  type FeedPostsResponse,
  type FeedPostStructuredResponse,
  type FeedStructuredPost,
  type PublicPostsQuery,
  publicPostsQuerySchema,
  type PublicSeriesQuery,
  publicSeriesQuerySchema,
  type PublicSeriesResponse,
} from '@aurboda/api-spec'

import { isValidUsername } from '../api/auth-routes.ts'
import {
  type FeedPostPageRow,
  type FeedPostRecord,
  findCoveringSharedSeriesWindow,
  getFeedPostById,
  isMissingDatabase,
  listPublicFeedPostsKeyset,
} from '../db/index.ts'
import { isPubliclyVisible } from '../services/activitypub/object.ts'
import { toWireKey, wireMetricToMetricType } from '../services/activitypub/quant-wire.ts'
import {
  ATOM_CONTENT_TYPE,
  ATOM_ENTRY_LIMIT,
  articleEntryHtml,
  buildArticlesAtom,
} from '../services/article-atom.ts'
import { renderableArticleBlocks } from '../services/article-export.ts'
import { resolvePublicSeries } from '../services/feed-series.ts'
import { loadAuthorizedStructuredPost, resolveStructuredContent } from '../services/feed-structured.ts'
import { serializeFeedPost } from '../services/feed.ts'
import { decodeKeysetCursor, encodeKeysetCursor } from '../services/keyset-cursor.ts'
import { queryMetricsBucketed } from '../services/queries/index.ts'
import { getSettings, type UserSettings } from '../services/settings.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { UUID_RE } from '../utils.ts'
import { validateQuery } from '../validation.ts'
import { createRenderCache } from './feed-image-router.ts'

/**
 * Page size of a profile's public feed listing (newest-first). Matches the authed
 * `/feed`: each post can carry a full structured payload (bucketed series + GPS
 * route), and the client builds a chart/map per card, so one unauthenticated
 * page must stay small — `next_cursor` reaches the rest (#1055).
 */
const PROFILE_FEED_LIMIT = 20

export interface FeedPublicRouterDeps {
  /** Public base URL of this API, for the Atom feed's self link and chart image URLs. */
  apiBaseUrl: string
  /** Public base URL of the web app, for the Atom feed's blog and permalink URLs. */
  webHost: string
  /** Which of an article's chart blocks would render; injectable so the Atom memo is observable in tests. */
  renderableBlocks?: (user: string, postId: string, article: ArticleContent) => Promise<ReadonlySet<number>>
}

/**
 * The Atom memo's key: every listed entry's id and `updated_at`, so an edit, a
 * new article or one dropping out (deleted, or flipped away from `public`)
 * misses it, plus the hourly bucket the structured cache uses, since a chart
 * block's data can arrive without touching the post.
 */
const atomMemoKey = (username: string, rows: { id: string; updated_at: Date }[], now: number): string =>
  `atom:${username}:${Math.floor(now / 3_600_000)}:${rows.map((r) => `${r.id}@${r.updated_at.getTime()}`).join(',')}`

export const createFeedPublicRouter = ({
  apiBaseUrl,
  renderableBlocks = renderableArticleBlocks,
  webHost,
}: FeedPublicRouterDeps): TypedRouter => {
  const router = typedRouter()
  // Caches the resolved structured payload OBJECT, shared (one key shape) by the
  // unauthenticated `/feed/:postId` endpoint and the `/posts` profile listing, so
  // either warms the other. Both routes authorize the post BEFORE consulting it,
  // so the capability token is NOT part of the key: a `followers`-only payload
  // never reaches the cache via a public request, and an anonymous `?token=…`
  // walk can't inflate the key space. Keyed on `updated_at` AND a coarse hourly
  // bucket (the block-image cache's two-part key): `updated_at` busts on any
  // edit, and the hourly term bounds staleness from backfilled measurements
  // inside an already-locked window (which don't touch `updated_at`) to ≤1h
  // (#934 locks the window, not the data). Cap sized for the listing writing up
  // to PROFILE_FEED_LIMIT entries per profile without a handful of concurrently
  // browsed profiles thrashing it. Producing `null` (no content) isn't cached.
  const structuredCache = createRenderCache<FeedStructuredPost>(200)
  const atomCache = createRenderCache<string>(100)

  const serializePublicPost = async (
    username: string,
    record: FeedPostRecord,
    settings: UserSettings | null,
  ): Promise<FeedPost> => {
    const post = await serializeFeedPost(username, record, { settings })
    if (
      record.kind === 'activity' ||
      record.kind === 'article' ||
      record.kind === 'challenge' ||
      record.kind === 'exercise'
    ) {
      const key = `structured:${username}:${record.id}:${record.updated_at.getTime()}:${Math.floor(Date.now() / 3_600_000)}`
      post.structured =
        (await structuredCache(key, () => resolveStructuredContent(username, record))) ?? undefined
    }
    return post
  }

  router.get<{ username: string }, PublicSeriesResponse, unknown, PublicSeriesQuery>(
    '/public/:username/series',
    validateQuery(publicSeriesQuerySchema),
    async (req, res) => {
      const { username } = req.params
      if (!isValidUsername(username)) {
        return res.status(404).json({ error: 'Not found', success: false })
      }
      const { bucket, end, start } = req.query
      const metric = wireMetricToMetricType(req.query.metric)
      if (metric === null) {
        return res.status(404).json({ error: 'Not found', success: false })
      }
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
        res.json({ ...result, metric: toWireKey(result.metric), success: true })
      } catch (error) {
        if (isMissingDatabase(error)) {
          return res.status(404).json({ error: 'Not found', success: false })
        }
        throw error
      }
    },
  )

  // A user's public feed for their profile page: the most recent `public`/
  // `unlisted` posts, newest-first (the ActivityPub outbox's set), serialized
  // like the authenticated `/feed` with the structured payload attached per
  // activity, article, challenge and exercise post — `structured` carries only the author's per-post
  // opt-ins, the same payload `/public/:username/feed/:postId` serves. An
  // article's live blocks fetch the owner-authenticated metric endpoints, which
  // a visitor can't reach, so the page renders its server-resolved blocks
  // instead. Structured resolution is
  // expensive (bucketed series queries + a GPS-track load per opted-in post, a
  // bucketed query per article chart block, a correlation per correlation block),
  // so it goes through the shared LRU above — same key shape as the sibling
  // endpoint — while the per-request visibility filter keeps un-sharing
  // immediate despite the cache.
  // `no-store` like the sibling `/series` and `/feed/:postId` endpoints: sharing
  // is revocable, so flipping a post to `followers` or deleting it must drop it
  // from the profile immediately, never linger in a shared cache. Mounted before
  // the generic `/public/:username/:slug` resolver so `posts` is never mistaken
  // for a share slug.
  router.get<{ username: string }, FeedPostsResponse, unknown, PublicPostsQuery>(
    '/public/:username/posts',
    validateQuery(publicPostsQuerySchema),
    async (req, res) => {
      const { username } = req.params
      // The response reuses the authed `/feed` shape (which requires `posts`), so a
      // 404 carries an empty list rather than a bare error body.
      if (!isValidUsername(username)) {
        return res.status(404).json({ error: 'Not found', posts: [], success: false })
      }
      try {
        // Replies are excluded here (the outbox still lists them): Mastodon's own
        // default profile tab hides replies, and a bare comment lifted out of its
        // thread reads as noise on a profile.
        const decoded = decodeKeysetCursor(req.query.cursor)
        // One row past the page: enough to know whether a next page exists,
        // without a second count query (as in `getFeedPage`).
        const rows = await listPublicFeedPostsKeyset(
          username,
          PROFILE_FEED_LIMIT + 1,
          decoded && { created_at: decoded.ts, id: decoded.id },
          { includeReplies: false, kind: req.query.kind },
        )
        const hasMore = rows.length > PROFILE_FEED_LIMIT
        const records = hasMore ? rows.slice(0, PROFILE_FEED_LIMIT) : rows
        const last = records[records.length - 1]
        const settings = await getSettings(username).catch(() => null)
        const posts = await Promise.all(
          records.map((record) => serializePublicPost(username, record, settings)),
        )
        res.setHeader('Cache-Control', 'no-store')
        res.json({
          next_cursor: hasMore && last ? encodeKeysetCursor(last.cursor_ts, last.id) : null,
          posts,
          success: true,
        })
      } catch (error) {
        if (isMissingDatabase(error)) {
          return res.status(404).json({ error: 'Not found', posts: [], success: false })
        }
        throw error
      }
    },
  )

  // The Atom feed of a profile's public articles — the instance blog for readers
  // without a fediverse account. Unlisted articles stay out: syndicating to feed
  // readers is listing. No MCP twin: a syndication format, like the OpenAPI
  // document. Feed readers poll, so unlike the JSON listing it may be cached
  // briefly; an un-shared article drops out within `max-age`.
  router.get<{ username: string }, string>('/public/:username/articles.atom', async (req, res) => {
    const { username } = req.params
    if (!isValidUsername(username)) {
      return res.status(404).type('text/plain').send('Not found')
    }
    try {
      const rows = await listPublicFeedPostsKeyset(username, ATOM_ENTRY_LIMIT, undefined, {
        includeReplies: false,
        kind: 'article',
        publicOnly: true,
      })
      const articles = rows.filter(
        (record): record is FeedPostPageRow & { article: ArticleContent } => record.article != null,
      )
      const xml = await atomCache(atomMemoKey(username, articles, Date.now()), async () => {
        const entries = await Promise.all(
          articles.map(async (record) => ({
            created_at: record.created_at,
            html: articleEntryHtml(
              apiBaseUrl,
              username,
              record,
              await renderableBlocks(username, record.id, record.article),
            ),
            id: record.id,
            title: record.article.title,
            updated_at: record.updated_at,
          })),
        )
        return buildArticlesAtom({ apiBaseUrl, entries, now: new Date(), username, webHost })
      })
      res.setHeader('Cache-Control', 'public, max-age=300')
      res.type(ATOM_CONTENT_TYPE).send(xml ?? '')
    } catch (error) {
      if (isMissingDatabase(error)) {
        return res.status(404).type('text/plain').send('Not found')
      }
      throw error
    }
  })

  // One post's permalink page (`/u/:username/posts/:postId`), which a federated
  // Note's id URL redirects a browser to. Only `public`/`unlisted` resolve — no
  // capability token here, so a followers-only post never renders on the web.
  // Replies resolve too: their ids are opened from remote servers like any other.
  router.get<{ username: string; postId: string }, FeedPostResponse>(
    '/public/:username/posts/:postId',
    async (req, res) => {
      const { postId, username } = req.params
      if (!isValidUsername(username) || !UUID_RE.test(postId)) {
        return res.status(404).json({ error: 'Not found', success: false })
      }
      try {
        const record = await getFeedPostById(username, postId)
        if (!record || !isPubliclyVisible(record.visibility)) {
          return res.status(404).json({ error: 'Not found', success: false })
        }
        const settings = await getSettings(username).catch(() => null)
        const post = await serializePublicPost(username, record, settings)
        res.setHeader('Cache-Control', 'no-store')
        res.json({ post, success: true })
      } catch (error) {
        if (isMissingDatabase(error)) {
          return res.status(404).json({ error: 'Not found', success: false })
        }
        throw error
      }
    },
  )

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
