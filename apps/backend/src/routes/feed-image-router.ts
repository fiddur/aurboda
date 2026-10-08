/**
 * The chart is offered both ways from the same series over the same window: a
 * rasterised PNG that every consumer understands (Mastodon attaches it) and a
 * crisp, scalable `image/svg+xml` for Aurboda-native rendering (#901). Rendered
 * on demand from the shared activity's data. An image is served for a
 * `public`/`unlisted` post that opted into that attachment (`include_chart` /
 * `include_map`); a `followers`-only post is served only when the request carries
 * the post's unguessable capability `?token=` (embedded solely in the Note
 * delivered to followers — #893), since the fediverse fetches media unsigned and
 * a signed-request gate wouldn't be exercised. `no-store` keeps the images
 * revocable (unshare / clear the flag / flip a public post to followers all take
 * effect immediately — the untoken'd public URL then 404s). Mounted before the
 * generic `/public/:username/:slug` resolver.
 */
import type { ArticleContent, CorrelationSelector, MetricType } from '@aurboda/api-spec'

import { defaultArticleChartBucket, getMetricDisplayName } from '@aurboda/api-spec'
import { type Response, Router } from 'express'

import type { FeedPostRecord } from '../db/index.ts'
import type { CorrelationBlockParams } from '../services/article-block-data.ts'
import type { ScatterSvgData } from '../services/charts/scatter-svg.ts'

import { isValidUsername } from '../api/auth-routes.ts'
import { isMissingDatabase } from '../db/index.ts'
import {
  articleBlockCacheKey,
  createNegativeCache,
  type NegativeCache,
} from '../services/article-block-misses.ts'
import { blockWindow, isZeroDurationBucket } from '../services/article.ts'
import { isCapabilityAuthorized } from '../services/feed-capability.ts'

export type { CorrelationBlockParams }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The window an image renders over. */
export interface ImageActivity {
  start_time: Date
  end_time?: Date
}

/** An eligible image request: the bounded window it renders over and the post's version. */
export interface ImageWindow {
  start_time: Date
  end_time: Date
  /** The post's `updated_at`; keys the render cache, matching the URL's `v`. */
  updated_at: Date
}

/** Optional chart styling — an article block labels its chart with the metric. */
export interface ChartRenderOpts {
  label?: string
  color?: string
}

export interface FeedImageDeps {
  getPost: (user: string, postId: string) => Promise<FeedPostRecord | null>
  getActivity: (user: string, activityId: string) => Promise<ImageActivity | null>
  getSeries: (user: string, metric: string, start: Date, end: Date) => Promise<[Date, number][]>
  getRoute: (user: string, start: Date, end: Date) => Promise<[number, number][]>
  renderChart: (series: [Date, number][], opts?: ChartRenderOpts) => Promise<Buffer>
  /** Build the crisp `image/svg+xml` chart (same data as `renderChart`, no raster). */
  renderChartSvg: (series: [Date, number][], opts?: ChartRenderOpts) => string
  renderRoute: (coords: [number, number][]) => Promise<Buffer>
  /** A bucketed metric series for an article chart block over its locked window. */
  getArticleChartSeries: (
    user: string,
    metric: MetricType,
    start: Date,
    end: Date,
    bucket: string,
  ) => Promise<[Date, number][]>
  /** The continuous correlation for an article correlation block, or null when too sparse (n < 3). */
  getCorrelationScatter: (user: string, params: CorrelationBlockParams) => Promise<ScatterSvgData | null>
  renderScatter: (data: ScatterSvgData) => Promise<Buffer>
  renderScatterSvg: (data: ScatterSvgData) => string
  /** Remembered block-image misses, shared with the markdown export (a fresh one when omitted). */
  articleBlockMisses?: NegativeCache
}

/**
 * One article chart/correlation block resolved to its render inputs: the block's
 * kind and its effective `[start, end]` window (its own override, else the
 * article default). Prose blocks and out-of-range indices don't resolve.
 */
export type ResolvedArticleBlock =
  | { type: 'chart'; metric: MetricType; bucket?: string; start: Date; end: Date; updatedAt: Date }
  | {
      type: 'correlation'
      trigger: CorrelationSelector
      outcome: CorrelationSelector
      lagDays?: number
      periodStart: string
      periodEnd: string
      updatedAt: Date
    }

/**
 * A tiny memoising cache with in-flight de-duplication (mirrors og-image-router):
 * repeated fetches for the same key serve the cached value, and concurrent misses
 * collapse to a single `produce`. Producing is expensive (a rasterised image, or
 * a many-block structured payload) and the source is effectively immutable per
 * key, so a bounded LRU + process-restart eviction is enough. `produce` returning
 * `null` (no data / unauthorized) is NOT cached. The caller checks eligibility
 * BEFORE consulting this, so an unshared/visibility-changed post 404s and never
 * reaches the cache. Generic over the cached value (defaults to `Buffer` for the
 * image endpoints; the structured endpoint caches its payload object).
 */
export const createRenderCache = <T = Buffer>(maxEntries = 200) => {
  const cache = new Map<string, T>()
  const inFlight = new Map<string, Promise<T | null>>()
  return async (key: string, produce: () => Promise<T | null>): Promise<T | null> => {
    const cached = cache.get(key)
    if (cached) return cached
    const pending = inFlight.get(key)
    if (pending) return pending
    const promise = produce()
    inFlight.set(key, promise)
    try {
      const value = await promise
      if (value) {
        if (cache.size >= maxEntries) {
          const oldest = cache.keys().next().value
          if (oldest !== undefined) cache.delete(oldest)
        }
        cache.set(key, value)
      }
      return value
    } finally {
      inFlight.delete(key)
    }
  }
}

/**
 * Resolve the activity window an image may render over, or `null` if the request
 * isn't eligible: invalid username / non-UUID id, missing DB, missing post, a
 * `followers`-only post without a matching capability `token`, the attachment
 * flag not opted in, no linked activity, or an open-ended activity (no bounded
 * window). Pure of Express — unit-testable.
 */
export const resolveImageWindow = async (
  deps: Pick<FeedImageDeps, 'getPost' | 'getActivity'>,
  username: string,
  postId: string,
  flag: 'include_chart' | 'include_map',
  token?: string,
): Promise<ImageWindow | null> => {
  if (!isValidUsername(username) || !UUID_RE.test(postId)) return null
  let post: FeedPostRecord | null
  try {
    post = await deps.getPost(username, postId)
  } catch (error) {
    if (isMissingDatabase(error)) return null
    throw error
  }
  if (post == null || !isCapabilityAuthorized(post, token) || !post[flag] || post.activity_id == null) {
    return null
  }
  const activity = await deps.getActivity(username, post.activity_id)
  if (activity?.end_time == null) return null
  return { end_time: activity.end_time, start_time: activity.start_time, updated_at: post.updated_at }
}

/**
 * Load the article behind an image request and authorize it, or `null` when
 * ineligible (invalid username / non-UUID id, missing DB, missing post, a
 * non-article post, or a `followers`-only post without a matching capability
 * `token`). Split out of `resolveArticleBlock` to keep each piece simple.
 */
const loadArticleForImage = async (
  deps: Pick<FeedImageDeps, 'getPost'>,
  username: string,
  postId: string,
  token?: string,
): Promise<{ article: ArticleContent; updatedAt: Date } | null> => {
  if (!isValidUsername(username) || !UUID_RE.test(postId)) return null
  let post: FeedPostRecord | null
  try {
    post = await deps.getPost(username, postId)
  } catch (error) {
    if (isMissingDatabase(error)) return null
    throw error
  }
  if (post == null || post.kind !== 'article' || post.article == null) return null
  if (!isCapabilityAuthorized(post, token)) return null
  return { article: post.article, updatedAt: post.updated_at }
}

/**
 * Resolve one article chart/correlation block to its render inputs, or `null`
 * when the request isn't eligible: invalid username / non-UUID id / bad index,
 * missing DB, missing post, a non-article post, a `followers`-only post without a
 * matching capability `token`, an out-of-range or prose block, or a block whose
 * effective window is unbounded / non-increasing. Pure of Express — unit-testable.
 *
 * Unlike a shared activity's chart, an article block has NO `include_chart`
 * opt-in flag: a chart/correlation block can embed any metric over any window, so
 * the post's visibility (public/unlisted open; followers-only via the unguessable
 * `token`) is the whole authorization boundary (#943).
 */
export const resolveArticleBlock = async (
  deps: Pick<FeedImageDeps, 'getPost'>,
  username: string,
  postId: string,
  index: number,
  token?: string,
): Promise<ResolvedArticleBlock | null> => {
  if (!Number.isInteger(index) || index < 0) return null
  const loaded = await loadArticleForImage(deps, username, postId, token)
  if (loaded == null) return null
  const block = loaded.article.blocks[index]
  if (block == null || (block.type !== 'chart' && block.type !== 'correlation')) return null
  const { end, start } = blockWindow(block, loaded.article)
  if (start == null || end == null) return null
  const startDate = new Date(start)
  const endDate = new Date(end)
  if (startDate.getTime() >= endDate.getTime()) return null
  const updatedAt = loaded.updatedAt
  if (block.type === 'chart') {
    return {
      bucket: block.bucket,
      end: endDate,
      metric: block.metric,
      start: startDate,
      type: 'chart',
      updatedAt,
    }
  }
  return {
    // Slice the day off the RAW ISO (author's wall-clock day), like the web
    // scatter — not the UTC day a Date round-trip would give.
    lagDays: block.lag_days,
    outcome: block.outcome,
    periodEnd: end.slice(0, 10),
    periodStart: start.slice(0, 10),
    trigger: block.trigger,
    type: 'correlation',
    updatedAt,
  }
}

/** Article-chart line colour, matching the web inline render (`ArticleChartBlock`). */
const ARTICLE_CHART_COLOR = '#673ab8'

/**
 * Render one resolved article block to its image bytes (PNG or the crisp SVG),
 * or `null` when the block has too little data to draw (a chart needs ≥ 2 points;
 * a correlation needs n ≥ 3, surfaced by `getCorrelationScatter` returning null)
 * or its bucket is a zero duration. Pure of Express so the routes stay thin.
 */
export const renderArticleBlockImage = async (
  deps: FeedImageDeps,
  user: string,
  block: ResolvedArticleBlock,
  format: 'png' | 'svg',
): Promise<Buffer | null> => {
  if (block.type === 'chart') {
    const bucket = block.bucket ?? defaultArticleChartBucket(block.start, block.end)
    if (isZeroDurationBucket(bucket)) return null
    const series = await deps.getArticleChartSeries(user, block.metric, block.start, block.end, bucket)
    if (series.length < 2) return null
    const opts: ChartRenderOpts = { color: ARTICLE_CHART_COLOR, label: getMetricDisplayName(block.metric) }
    return format === 'png'
      ? deps.renderChart(series, opts)
      : Buffer.from(deps.renderChartSvg(series, opts), 'utf8')
  }
  const data = await deps.getCorrelationScatter(user, {
    lagDays: block.lagDays,
    outcome: block.outcome,
    periodEnd: block.periodEnd,
    periodStart: block.periodStart,
    trigger: block.trigger,
  })
  if (data == null) return null
  return format === 'png' ? deps.renderScatter(data) : Buffer.from(deps.renderScatterSvg(data), 'utf8')
}

const notFound = (res: Response) => res.status(404).json({ error: 'Not found', success: false })

const sendPng = (res: Response, png: Buffer) => {
  // Revocable like the /series endpoint: never let a shared cache serve an image
  // for a post that was just un-shared.
  res.setHeader('Cache-Control', 'no-store')
  res.type('png').send(png)
}

const sendSvg = (res: Response, svg: Buffer) => {
  res.setHeader('Cache-Control', 'no-store') // revocable, same as the PNG
  res.type('image/svg+xml').send(svg)
}

/**
 * Keyed on the post's stored version, not the URL's `v`: a detail sync or an
 * edit bumps `updated_at` and re-renders, while a guessed `v` cannot bust the cache.
 */
export const imageCacheKey = (kind: string, username: string, postId: string, window: ImageWindow): string =>
  `${kind}:${username}:${postId}:${window.updated_at.getTime()}`

export const createFeedImageRouter = (deps: FeedImageDeps): Router => {
  const router = Router()
  const cached = createRenderCache()

  router.get('/public/:username/feed/:postId/chart.png', async (req, res) => {
    const { postId, username } = req.params
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    const window = await resolveImageWindow(deps, username, postId, 'include_chart', token)
    if (!window) return notFound(res)
    const { end_time, start_time } = window
    const png = await cached(imageCacheKey('chart', username, postId, window), async () => {
      const series = await deps.getSeries(username, 'heart_rate', start_time, end_time)
      return series.length === 0 ? null : deps.renderChart(series)
    })
    if (!png) return notFound(res)
    sendPng(res, png)
  })

  router.get('/public/:username/feed/:postId/chart.svg', async (req, res) => {
    const { postId, username } = req.params
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    const window = await resolveImageWindow(deps, username, postId, 'include_chart', token)
    if (!window) return notFound(res)
    const { end_time, start_time } = window
    // Cached under a distinct key from the PNG; the built SVG string is stored as
    // its UTF-8 bytes so it shares the same buffer LRU (the DB series fetch is the
    // cost worth caching, not the string build).
    const svg = await cached(imageCacheKey('chartsvg', username, postId, window), async () => {
      const series = await deps.getSeries(username, 'heart_rate', start_time, end_time)
      return series.length === 0 ? null : Buffer.from(deps.renderChartSvg(series), 'utf8')
    })
    if (!svg) return notFound(res)
    sendSvg(res, svg)
  })

  router.get('/public/:username/feed/:postId/route.png', async (req, res) => {
    const { postId, username } = req.params
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    const window = await resolveImageWindow(deps, username, postId, 'include_map', token)
    if (!window) return notFound(res)
    const { end_time, start_time } = window
    const png = await cached(imageCacheKey('route', username, postId, window), async () => {
      const coords = await deps.getRoute(username, start_time, end_time)
      return coords.length === 0 ? null : deps.renderRoute(coords)
    })
    if (!png) return notFound(res)
    sendPng(res, png)
  })

  // Article chart/correlation block images. Gated by post visibility + capability
  // token only (no `include_chart` flag — a block can embed any metric, so
  // visibility is the whole boundary, #943). See `articleBlockCacheKey` for why
  // the key carries `updated_at` and an hourly bucket: the block re-resolves its
  // data live (#934), and articles, unlike shared activities, are mutable and
  // their windows can gain data after publish.
  const negativeBlocks = deps.articleBlockMisses ?? createNegativeCache()

  router.get('/public/:username/feed/:postId/blocks/:index/image.png', async (req, res) => {
    const { index, postId, username } = req.params
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    const idx = Number(index)
    const block = await resolveArticleBlock(deps, username, postId, idx, token)
    if (!block) return notFound(res)
    const key = articleBlockCacheKey('blockpng', username, postId, idx, block.updatedAt)
    if (negativeBlocks.has(key)) return notFound(res)
    const png = await cached(key, () => renderArticleBlockImage(deps, username, block, 'png'))
    if (!png) {
      negativeBlocks.add(key)
      return notFound(res)
    }
    sendPng(res, png)
  })

  router.get('/public/:username/feed/:postId/blocks/:index/image.svg', async (req, res) => {
    const { index, postId, username } = req.params
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    const idx = Number(index)
    const block = await resolveArticleBlock(deps, username, postId, idx, token)
    if (!block) return notFound(res)
    const key = articleBlockCacheKey('blocksvg', username, postId, idx, block.updatedAt)
    if (negativeBlocks.has(key)) return notFound(res)
    const svg = await cached(key, () => renderArticleBlockImage(deps, username, block, 'svg'))
    if (!svg) {
      negativeBlocks.add(key)
      return notFound(res)
    }
    sendSvg(res, svg)
  })

  return router
}
