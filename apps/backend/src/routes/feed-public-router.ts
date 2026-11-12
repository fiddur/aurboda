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
  type OfficialFeedEntry,
  type OfficialFeedQuery,
  officialFeedQuerySchema,
  type OfficialFeedResponse,
  type OfficialFeedSetting,
  type PublicPostsQuery,
  publicPostsQuerySchema,
  type PublicSeriesQuery,
  publicSeriesQuerySchema,
  type PublicSeriesResponse,
  type PublicTagPostsQuery,
  publicTagPostsQuerySchema,
  type PublicTagPostsResponse,
  type BaseResponse,
  normalizeTag,
} from '@aurboda/api-spec'

import type { PublicTagPostRecord, PublicTagsApi } from '../services/central-public-tags.ts'
import type { PublicTagActions } from '../services/public-tags.ts'

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
  buildOfficialFeedAtom,
  buildTagFeedAtom,
  type OfficialFeedAtomEntry,
  postEntryHtml,
  postEntryTitle,
} from '../services/article-atom.ts'
import { renderableArticleBlocks } from '../services/article-export.ts'
import { resolvePublicSeries } from '../services/feed-series.ts'
import { loadAuthorizedStructuredPost, resolveStructuredContent } from '../services/feed-structured.ts'
import { serializeFeedPost } from '../services/feed.ts'
import { decodeKeysetCursor, encodeKeysetCursor, type KeysetCursor } from '../services/keyset-cursor.ts'
import {
  isOfficialFeedOn,
  mergeOfficialFeedPage,
  OFFICIAL_FEED_PAGE_SIZE,
  officialRemoteHandles,
} from '../services/official-feed.ts'
import { serializePublicTagPost } from '../services/public-tags.ts'
import { queryMetricsBucketed } from '../services/queries/index.ts'
import { createRenderCache } from '../services/render-cache.ts'
import { getSettings, type UserSettings } from '../services/settings.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { UUID_RE } from '../utils.ts'
import { validateQuery } from '../validation.ts'

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
  /** The instance's official feed setting; absent, the official feed is off. */
  readOfficialFeed?: () => Promise<OfficialFeedSetting>
  /** The official feed's posts by authors on other servers; absent, only local users' are listed. */
  listOfficialRemotePosts?: PublicTagsApi['listOfficialRemotePosts']
  /** The public tag pages; absent, every tag 404s. */
  publicTags?: Pick<PublicTagActions, 'latest' | 'page'>
}

const localUsernames = (rows: readonly ({ origin: 'local'; username: string } | { origin: 'remote' })[]) =>
  rows.flatMap((entry) => (entry.origin === 'local' ? [entry.username] : []))

/**
 * The Atom memo's key: every listed entry's id and `updated_at`, so an edit, a
 * new article or one dropping out (deleted, or flipped away from `public`)
 * misses it, plus the hourly bucket the structured cache uses, since a chart
 * block's data can arrive without touching the post.
 */
const atomMemoKey = (scope: string, rows: { id: string; updated_at: Date }[], now: number): string =>
  `atom:${scope}:${Math.floor(now / 3_600_000)}:${rows.map((r) => `${r.id}@${r.updated_at.getTime()}`).join(',')}`

export const createFeedPublicRouter = ({
  apiBaseUrl,
  listOfficialRemotePosts,
  publicTags,
  readOfficialFeed,
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
    const post = await serializeFeedPost(username, record, { settings, webHost })
    if (
      record.kind === 'activity' ||
      record.kind === 'article' ||
      record.kind === 'challenge' ||
      record.kind === 'exercise' ||
      record.kind === 'dashboard'
    ) {
      const key = `structured:${username}:${record.id}:${record.updated_at.getTime()}:${Math.floor(Date.now() / 3_600_000)}`
      post.structured =
        (await structuredCache(key, () => resolveStructuredContent(username, record))) ?? undefined
    }
    return post
  }

  // A listed user whose database is gone (deleted mid-way, or never created) is
  // left out of the official feed; warn once per user rather than per request.
  const missingOfficialUsers = new Set<string>()
  const onMissingOfficialUser = (username: string) => {
    if (missingOfficialUsers.has(username)) return
    missingOfficialUsers.add(username)
    console.warn(`⚠️ Official feed: no database for listed user ${username}, leaving them out`)
  }

  const officialFeedPage = async (setting: OfficialFeedSetting, limit: number, before?: KeysetCursor) => {
    const handles = officialRemoteHandles(setting)
    const fetchRemote =
      listOfficialRemotePosts && handles.length > 0 && setting.tags.length > 0
        ? (remoteLimit: number) => listOfficialRemotePosts(handles, setting.tags, remoteLimit, before)
        : undefined
    return mergeOfficialFeedPage<FeedPostPageRow, PublicTagPostRecord>({
      fetchRemote,
      fetchUser: (username, userLimit) =>
        listPublicFeedPostsKeyset(username, userLimit, before && { created_at: before.ts, id: before.id }, {
          anyTags: setting.tags,
          includeReplies: false,
          publicOnly: true,
        }),
      limit,
      onMissingUser: onMissingOfficialUser,
      users: setting.users,
    })
  }

  const settingsOf = async (usernames: string[]): Promise<Map<string, UserSettings | null>> =>
    new Map(
      await Promise.all(
        [...new Set(usernames)].map(
          async (username) => [username, await getSettings(username).catch(() => null)] as const,
        ),
      ),
    )

  const enabledOfficialFeed = async (): Promise<OfficialFeedSetting | null> => {
    const setting = readOfficialFeed ? await readOfficialFeed() : null
    return setting && isOfficialFeedOn(setting) ? setting : null
  }

  // The instance's official feed (its blog): `public` posts — never `unlisted`,
  // which an instance-wide listing would list — by the admin-chosen users and
  // remote authors that carry one of the chosen tags, newest first across their
  // databases and the central tag posts. Local posts serialise as on the
  // author's profile listing, sharing its structured cache; remote ones as on a
  // public tag page.
  // `no-store` for the profile listing's revocability reason. No MCP twin: a
  // public read of what the profiles already serve.
  router.get<Record<string, never>, OfficialFeedResponse, unknown, OfficialFeedQuery>(
    '/public/official-feed',
    validateQuery(officialFeedQuerySchema),
    async (req, res) => {
      const setting = await enabledOfficialFeed()
      if (!setting) {
        return res.status(404).json({ error: 'Not found', posts: [], success: false })
      }
      const page = await officialFeedPage(
        setting,
        OFFICIAL_FEED_PAGE_SIZE,
        decodeKeysetCursor(req.query.cursor),
      )
      const settingsByUser = await settingsOf(localUsernames(page.rows))
      const posts = await Promise.all(
        page.rows.map(async (entry): Promise<OfficialFeedEntry> => {
          if (entry.origin === 'remote') return { ...serializePublicTagPost(entry.row), origin: 'remote' }
          const { row, username } = entry
          return {
            ...(await serializePublicPost(username, row, settingsByUser.get(username) ?? null)),
            author_username: username,
            origin: 'local',
          }
        }),
      )
      res.setHeader('Cache-Control', 'no-store')
      res.json({
        next_cursor: page.next ? encodeKeysetCursor(page.next.cursor_ts, page.next.id) : null,
        posts,
        remote_authors: setting.remote_authors,
        success: true,
        tags: setting.tags,
        users: setting.users,
      })
    },
  )

  // The official feed's Atom document: its newest entries, every post kind, an
  // article's body as on the per-user articles feed, any other local post's as
  // it federates, and a remote post's as received. Cached briefly like the
  // articles feed; feed readers poll.
  router.get<Record<string, never>, string>('/public/official-feed.atom', async (_req, res) => {
    const setting = await enabledOfficialFeed()
    if (!setting) {
      return res.status(404).type('text/plain').send('Not found')
    }
    const { rows } = await officialFeedPage(setting, ATOM_ENTRY_LIMIT)
    const memoRows = rows.map((entry) => ({
      id: entry.origin === 'local' ? `${entry.username}/${entry.row.id}` : `@remote/${entry.row.id}`,
      updated_at: entry.row.updated_at,
    }))
    // `#` is never in a username, so this scope can't meet a user's articles memo.
    const xml = await atomCache(atomMemoKey('#official', memoRows, Date.now()), async () => {
      const settingsByUser = await settingsOf(localUsernames(rows))
      const entries = await Promise.all(
        rows.map(async (entry): Promise<OfficialFeedAtomEntry> => {
          if (entry.origin === 'remote') return { origin: 'remote', ...entry.row }
          const { row, username } = entry
          const post = await serializeFeedPost(username, row, {
            settings: settingsByUser.get(username) ?? null,
            webHost,
          })
          const html = row.article
            ? articleEntryHtml(
                apiBaseUrl,
                username,
                { ...row, article: row.article },
                await renderableBlocks(username, row.id, row.article),
              )
            : postEntryHtml(post)
          return {
            created_at: row.created_at,
            html,
            id: row.id,
            origin: 'local',
            title: postEntryTitle(post),
            updated_at: row.updated_at,
            username,
          }
        }),
      )
      return buildOfficialFeedAtom({ apiBaseUrl, entries, now: new Date(), webHost })
    })
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.type(ATOM_CONTENT_TYPE).send(xml ?? '')
  })

  // `no-store`: a removed tag or a deleted post must drop out at once.
  router.get<{ tag: string }, PublicTagPostsResponse | BaseResponse, unknown, PublicTagPostsQuery>(
    '/public/tags/:tag/posts',
    validateQuery(publicTagPostsQuerySchema),
    async (req, res) => {
      const result = publicTags
        ? await publicTags.page(req.params.tag, req.query.cursor)
        : { ok: false as const }
      if (!result.ok) {
        return res.status(404).json({ error: 'Not found', success: false })
      }
      res.setHeader('Cache-Control', 'no-store')
      res.json(result.page)
    },
  )

  router.get<{ tag: string }, string>('/public/tags/:tag.atom', async (req, res, next) => {
    const latest = publicTags ? await publicTags.latest(req.params.tag, ATOM_ENTRY_LIMIT) : null
    if (!latest) return next()
    const xml = buildTagFeedAtom({
      apiBaseUrl,
      entries: latest.posts,
      now: new Date(),
      tag: latest.tag,
      webHost,
    })
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.type(ATOM_CONTENT_TYPE).send(xml)
  })

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
  // activity, article, challenge, exercise and dashboard post — `structured` carries only the author's per-post
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
          {
            includeReplies: false,
            kind: req.query.kind,
            ...(req.query.tag === undefined ? {} : { tag: normalizeTag(req.query.tag) ?? undefined }),
          },
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
