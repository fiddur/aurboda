/**
 * Public feed-post image endpoints (UNAUTHENTICATED).
 *
 * Handles: GET /public/:username/feed/:postId/chart.png
 *          GET /public/:username/feed/:postId/chart.svg
 *          GET /public/:username/feed/:postId/route.png
 *          GET /public/:username/feed/:postId/blocks/:index/image.png
 *          GET /public/:username/feed/:postId/blocks/:index/image.svg
 *
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
import type { ScatterSvgData } from '../services/charts/scatter-svg.ts'

import { isValidUsername } from '../api/auth-routes.ts'
import { isMissingDatabase } from '../db/index.ts'
import { blockWindow } from '../services/article.ts'
import { isCapabilityAuthorized } from '../services/feed-capability.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The window an image renders over. */
export interface ImageActivity {
  start_time: Date
  end_time?: Date
}

/** Optional chart styling — an article block labels its chart with the metric. */
export interface ChartRenderOpts {
  label?: string
  color?: string
}

/** The window-resolved inputs for one article correlation block's scatter. */
export interface CorrelationBlockParams {
  trigger: CorrelationSelector
  outcome: CorrelationSelector
  lagDays?: number
  start: Date
  end: Date
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
      start: Date
      end: Date
      updatedAt: Date
    }

/**
 * A tiny memoising render cache with in-flight de-duplication (mirrors
 * og-image-router): repeated fetches for the same image serve a cached buffer,
 * and concurrent misses collapse to a single render. Rendering is CPU-heavy and
 * the source data (a past activity's series/GPS) is effectively immutable, so a
 * bounded LRU + process-restart eviction is enough. `produce` returning `null`
 * (no data) is NOT cached. The caller checks eligibility BEFORE consulting this,
 * so an unshared/visibility-changed post 404s and never reaches the cache.
 */
export const createRenderCache = (maxEntries = 200) => {
  const cache = new Map<string, Buffer>()
  const inFlight = new Map<string, Promise<Buffer | null>>()
  return async (key: string, produce: () => Promise<Buffer | null>): Promise<Buffer | null> => {
    const cached = cache.get(key)
    if (cached) return cached
    const pending = inFlight.get(key)
    if (pending) return pending
    const promise = produce()
    inFlight.set(key, promise)
    try {
      const png = await promise
      if (png) {
        if (cache.size >= maxEntries) {
          const oldest = cache.keys().next().value
          if (oldest !== undefined) cache.delete(oldest)
        }
        cache.set(key, png)
      }
      return png
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
): Promise<ImageActivity | null> => {
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
  return activity
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
    end: endDate,
    lagDays: block.lag_days,
    outcome: block.outcome,
    start: startDate,
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
 * a correlation needs n ≥ 3, surfaced by `getCorrelationScatter` returning null).
 * Pure of Express so the routes stay thin.
 */
const renderArticleBlockImage = async (
  deps: FeedImageDeps,
  user: string,
  block: ResolvedArticleBlock,
  format: 'png' | 'svg',
): Promise<Buffer | null> => {
  if (block.type === 'chart') {
    const bucket = block.bucket ?? defaultArticleChartBucket(block.start, block.end)
    const series = await deps.getArticleChartSeries(user, block.metric, block.start, block.end, bucket)
    if (series.length < 2) return null
    const opts: ChartRenderOpts = { color: ARTICLE_CHART_COLOR, label: getMetricDisplayName(block.metric) }
    return format === 'png'
      ? deps.renderChart(series, opts)
      : Buffer.from(deps.renderChartSvg(series, opts), 'utf8')
  }
  const data = await deps.getCorrelationScatter(user, {
    end: block.end,
    lagDays: block.lagDays,
    outcome: block.outcome,
    start: block.start,
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

export const createFeedImageRouter = (deps: FeedImageDeps): Router => {
  const router = Router()
  const cached = createRenderCache()

  router.get('/public/:username/feed/:postId/chart.png', async (req, res) => {
    const { postId, username } = req.params
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    const activity = await resolveImageWindow(deps, username, postId, 'include_chart', token)
    if (!activity?.end_time) return notFound(res)
    const { end_time, start_time } = activity
    const png = await cached(`chart:${username}:${postId}`, async () => {
      const series = await deps.getSeries(username, 'heart_rate', start_time, end_time)
      return series.length === 0 ? null : deps.renderChart(series)
    })
    if (!png) return notFound(res)
    sendPng(res, png)
  })

  router.get('/public/:username/feed/:postId/chart.svg', async (req, res) => {
    const { postId, username } = req.params
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    const activity = await resolveImageWindow(deps, username, postId, 'include_chart', token)
    if (!activity?.end_time) return notFound(res)
    const { end_time, start_time } = activity
    // Cached under a distinct key from the PNG; the built SVG string is stored as
    // its UTF-8 bytes so it shares the same buffer LRU (the DB series fetch is the
    // cost worth caching, not the string build).
    const svg = await cached(`chartsvg:${username}:${postId}`, async () => {
      const series = await deps.getSeries(username, 'heart_rate', start_time, end_time)
      return series.length === 0 ? null : Buffer.from(deps.renderChartSvg(series), 'utf8')
    })
    if (!svg) return notFound(res)
    sendSvg(res, svg)
  })

  router.get('/public/:username/feed/:postId/route.png', async (req, res) => {
    const { postId, username } = req.params
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    const activity = await resolveImageWindow(deps, username, postId, 'include_map', token)
    if (!activity?.end_time) return notFound(res)
    const { end_time, start_time } = activity
    const png = await cached(`route:${username}:${postId}`, async () => {
      const coords = await deps.getRoute(username, start_time, end_time)
      return coords.length === 0 ? null : deps.renderRoute(coords)
    })
    if (!png) return notFound(res)
    sendPng(res, png)
  })

  // Article chart/correlation block images. Gated by post visibility + capability
  // token only (no `include_chart` flag — a block can embed any metric, so
  // visibility is the whole boundary, #943). Cache key includes the post's
  // `updated_at` so editing the article serves a fresh render (articles, unlike
  // shared activities, are mutable).
  router.get('/public/:username/feed/:postId/blocks/:index/image.png', async (req, res) => {
    const { index, postId, username } = req.params
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    const block = await resolveArticleBlock(deps, username, postId, Number(index), token)
    if (!block) return notFound(res)
    const png = await cached(`blockpng:${username}:${postId}:${index}:${block.updatedAt.getTime()}`, () =>
      renderArticleBlockImage(deps, username, block, 'png'),
    )
    if (!png) return notFound(res)
    sendPng(res, png)
  })

  router.get('/public/:username/feed/:postId/blocks/:index/image.svg', async (req, res) => {
    const { index, postId, username } = req.params
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    const block = await resolveArticleBlock(deps, username, postId, Number(index), token)
    if (!block) return notFound(res)
    const svg = await cached(`blocksvg:${username}:${postId}:${index}:${block.updatedAt.getTime()}`, () =>
      renderArticleBlockImage(deps, username, block, 'svg'),
    )
    if (!svg) return notFound(res)
    sendSvg(res, svg)
  })

  return router
}
