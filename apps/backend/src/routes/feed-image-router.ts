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
import type { ArticleContent } from '@aurboda/api-spec'

import { type Response, Router } from 'express'

import type { FeedPostRecord } from '../db/index.ts'
import type { CorrelationBlockParams } from '../services/article-block-data.ts'
import type { ImpactSvgData } from '../services/charts/impact-svg.ts'
import type { ChartRenderOpts, PostChart } from '../services/charts/post-chart-svg.ts'
import type { RaceChartSvgData } from '../services/charts/race-chart-svg.ts'
import type { ScatterSvgData } from '../services/charts/scatter-svg.ts'

import { isValidUsername } from '../api/auth-routes.ts'
import { isMissingDatabase } from '../db/index.ts'
import { renderArticleNote } from '../services/activitypub/article-object.ts'
import {
  articleBlockCacheKey,
  createNegativeCache,
  type NegativeCache,
} from '../services/article-block-misses.ts'
import { articleBlockFigureSvg } from '../services/article-figure.ts'
import { isCapabilityAuthorized } from '../services/feed-capability.ts'
import {
  activityHeartRateChart,
  articleBlockAt,
  articleBlockChart,
  bucketedCacheKey,
  exerciseTrendChart,
  imageCacheKey,
  type PostChartDeps,
  type ResolvedArticleBlock,
  STANDINGS_BUCKET_MS,
  standingsChart,
  TREND_BUCKET_MS,
} from '../services/post-chart.ts'
import { createRenderCache } from '../services/render-cache.ts'
import { UUID_RE } from '../utils.ts'

export type { ChartRenderOpts, CorrelationBlockParams, ResolvedArticleBlock }
export { createRenderCache, imageCacheKey }

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

export interface FeedImageDeps extends PostChartDeps {
  getPost: (user: string, postId: string) => Promise<FeedPostRecord | null>
  getActivity: (user: string, activityId: string) => Promise<ImageActivity | null>
  getRoute: (user: string, start: Date, end: Date) => Promise<[number, number][]>
  renderChart: (series: [Date, number][], opts?: ChartRenderOpts) => Promise<Buffer>
  /** Build the crisp `image/svg+xml` chart (same data as `renderChart`, no raster). */
  renderChartSvg: (series: [Date, number][], opts?: ChartRenderOpts) => string
  renderRoute: (coords: [number, number][]) => Promise<Buffer>
  renderScatter: (data: ScatterSvgData) => Promise<Buffer>
  renderScatterSvg: (data: ScatterSvgData) => string
  renderRaceChart: (data: RaceChartSvgData) => Promise<Buffer>
  renderRaceChartSvg: (data: RaceChartSvgData) => string
  renderImpact: (data: ImpactSvgData) => Promise<Buffer>
  renderImpactSvg: (data: ImpactSvgData) => string
  /** Rasterise an SVG to PNG (an article block's figure: the chart under its title band). */
  rasterizeSvg: (svg: string) => Promise<Buffer>
  /** Remembered block-image misses, shared with the markdown export (a fresh one when omitted). */
  articleBlockMisses?: NegativeCache
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
 * Resolve one article block to its render inputs, or `null` when the request
 * isn't eligible: invalid username / non-UUID id / bad index, missing DB,
 * missing post, a non-article post, a `followers`-only post without a matching
 * capability `token`, an out-of-range or prose block, or a windowed block whose
 * effective window is unbounded / non-increasing. Pure of Express.
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
): Promise<ResolvedArticleBlock | null> =>
  (await resolveArticleBlockOf(deps, username, postId, index, token))?.block ?? null

/** `resolveArticleBlock`, keeping the article it came from (a figure needs its number and label). */
const resolveArticleBlockOf = async (
  deps: Pick<FeedImageDeps, 'getPost'>,
  username: string,
  postId: string,
  index: number,
  token?: string,
): Promise<{ article: ArticleContent; block: ResolvedArticleBlock } | null> => {
  if (!Number.isInteger(index) || index < 0) return null
  const loaded = await loadArticleForImage(deps, username, postId, token)
  if (loaded == null) return null
  const block = articleBlockAt(loaded.article, loaded.updatedAt, index)
  return block == null ? null : { article: loaded.article, block }
}

/** A chart's image bytes: the PNG every consumer understands, or the crisp SVG. */
export const renderPostChartImage = async (
  deps: Pick<
    FeedImageDeps,
    | 'renderChart'
    | 'renderChartSvg'
    | 'renderImpact'
    | 'renderImpactSvg'
    | 'renderRaceChart'
    | 'renderRaceChartSvg'
    | 'renderScatter'
    | 'renderScatterSvg'
  >,
  chart: PostChart,
  format: 'png' | 'svg',
): Promise<Buffer> => {
  const svg = (markup: string): Buffer => Buffer.from(markup, 'utf8')
  switch (chart.type) {
    case 'line':
      return format === 'png'
        ? deps.renderChart(chart.series, chart.opts)
        : svg(deps.renderChartSvg(chart.series, chart.opts))
    case 'race':
      return format === 'png' ? deps.renderRaceChart(chart.data) : svg(deps.renderRaceChartSvg(chart.data))
    case 'scatter':
      return format === 'png' ? deps.renderScatter(chart.data) : svg(deps.renderScatterSvg(chart.data))
    case 'impact':
      return format === 'png' ? deps.renderImpact(chart.data) : svg(deps.renderImpactSvg(chart.data))
  }
}

/** One resolved article block's image bytes, or `null` when the block has too little data to draw. */
export const renderArticleBlockImage = async (
  deps: FeedImageDeps,
  user: string,
  block: ResolvedArticleBlock,
  format: 'png' | 'svg',
): Promise<Buffer | null> => {
  const chart = await articleBlockChart(deps, user, block)
  return chart == null ? null : renderPostChartImage(deps, chart, format)
}

/**
 * One article block's figure PNG: its chart under a title band naming the
 * figure, numbered and labelled by the same walk that writes the Note
 * (`renderArticleNote`), so the image and the text can't disagree. `null` when
 * the block has too little data to draw.
 */
export const renderArticleBlockFigure = async (
  deps: FeedImageDeps,
  user: string,
  article: ArticleContent,
  index: number,
  block: ResolvedArticleBlock,
): Promise<Buffer | null> => {
  const figure = renderArticleNote(article, () => '').figures.find((f) => f.block_index === index)
  if (figure == null) return null
  const svg = await articleBlockFigureSvg(deps, user, block, figure, async (chart) =>
    (await renderPostChartImage(deps, chart, 'svg')).toString('utf8'),
  )
  return svg == null ? null : deps.rasterizeSvg(svg)
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

export const standingsCacheKey = (
  kind: string,
  username: string,
  postId: string,
  updatedAt: Date,
  now: number,
): string => bucketedCacheKey(kind, username, postId, updatedAt, now, STANDINGS_BUCKET_MS)

export const trendCacheKey = (
  kind: string,
  username: string,
  postId: string,
  updatedAt: Date,
  now: number,
): string => bucketedCacheKey(kind, username, postId, updatedAt, now, TREND_BUCKET_MS)

const resolveChartPost = async (
  deps: Pick<FeedImageDeps, 'getPost'>,
  kind: 'challenge' | 'exercise',
  username: string,
  postId: string,
  token?: string,
): Promise<FeedPostRecord | null> => {
  if (!isValidUsername(username) || !UUID_RE.test(postId)) return null
  let post: FeedPostRecord | null
  try {
    post = await deps.getPost(username, postId)
  } catch (error) {
    if (isMissingDatabase(error)) return null
    throw error
  }
  if (post == null || post.kind !== kind || !post.include_chart) return null
  return isCapabilityAuthorized(post, token) ? post : null
}

/**
 * The challenge post a `standings` image request may render, or `null` when
 * ineligible: invalid username / non-UUID id, missing DB, missing post, not a
 * challenge post, a `followers`-only post without a matching capability
 * `token`, or the post not opted into `include_chart`.
 */
export const resolveStandingsPost = (
  deps: Pick<FeedImageDeps, 'getPost'>,
  username: string,
  postId: string,
  token?: string,
): Promise<FeedPostRecord | null> => resolveChartPost(deps, 'challenge', username, postId, token)

/**
 * The exercise post a `trend` image request may render, or `null` when ineligible: the same rules
 * as `resolveStandingsPost`, for an `exercise` post.
 */
export const resolveExercisePost = (
  deps: Pick<FeedImageDeps, 'getPost'>,
  username: string,
  postId: string,
  token?: string,
): Promise<FeedPostRecord | null> => resolveChartPost(deps, 'exercise', username, postId, token)

/** A challenge block's standings move like a challenge post's (`standings.png`); a windowed block's data, hourly. */
const blockBucketMs = (block: ResolvedArticleBlock): number | undefined =>
  block.type === 'challenge' ? STANDINGS_BUCKET_MS : undefined

export const createFeedImageRouter = (deps: FeedImageDeps): Router => {
  const router = Router()
  const cached = createRenderCache()

  router.get('/public/:username/feed/:postId/chart.png', async (req, res) => {
    const { postId, username } = req.params
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    const window = await resolveImageWindow(deps, username, postId, 'include_chart', token)
    if (!window) return notFound(res)
    const png = await cached(imageCacheKey('chart', username, postId, window), async () => {
      const chart = await activityHeartRateChart(deps, username, window)
      return chart == null ? null : renderPostChartImage(deps, chart, 'png')
    })
    if (!png) return notFound(res)
    sendPng(res, png)
  })

  router.get('/public/:username/feed/:postId/chart.svg', async (req, res) => {
    const { postId, username } = req.params
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    const window = await resolveImageWindow(deps, username, postId, 'include_chart', token)
    if (!window) return notFound(res)
    // Cached under a distinct key from the PNG; the built SVG string is stored as
    // its UTF-8 bytes so it shares the same buffer LRU (the DB series fetch is the
    // cost worth caching, not the string build).
    const svg = await cached(imageCacheKey('chartsvg', username, postId, window), async () => {
      const chart = await activityHeartRateChart(deps, username, window)
      return chart == null ? null : renderPostChartImage(deps, chart, 'svg')
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

  const standingsImage = async (
    username: string,
    post: FeedPostRecord,
    format: 'png' | 'svg',
  ): Promise<Buffer | null> => {
    const key = standingsCacheKey(`standings${format}`, username, post.id, post.updated_at, Date.now())
    return cached(key, async () => {
      const chart = await standingsChart(deps, username, post)
      return chart == null ? null : renderPostChartImage(deps, chart, format)
    })
  }

  router.get('/public/:username/feed/:postId/standings.png', async (req, res) => {
    const { postId, username } = req.params
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    const post = await resolveStandingsPost(deps, username, postId, token)
    if (!post) return notFound(res)
    const png = await standingsImage(username, post, 'png')
    if (!png) return notFound(res)
    sendPng(res, png)
  })

  router.get('/public/:username/feed/:postId/standings.svg', async (req, res) => {
    const { postId, username } = req.params
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    const post = await resolveStandingsPost(deps, username, postId, token)
    if (!post) return notFound(res)
    const svg = await standingsImage(username, post, 'svg')
    if (!svg) return notFound(res)
    sendSvg(res, svg)
  })

  const trendImage = async (
    username: string,
    post: FeedPostRecord,
    format: 'png' | 'svg',
  ): Promise<Buffer | null> => {
    const key = trendCacheKey(`trend${format}`, username, post.id, post.updated_at, Date.now())
    return cached(key, async () => {
      const chart = await exerciseTrendChart(deps, username, post)
      return chart == null ? null : renderPostChartImage(deps, chart, format)
    })
  }

  router.get('/public/:username/feed/:postId/trend.png', async (req, res) => {
    const { postId, username } = req.params
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    const post = await resolveExercisePost(deps, username, postId, token)
    if (!post) return notFound(res)
    const png = await trendImage(username, post, 'png')
    if (!png) return notFound(res)
    sendPng(res, png)
  })

  router.get('/public/:username/feed/:postId/trend.svg', async (req, res) => {
    const { postId, username } = req.params
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    const post = await resolveExercisePost(deps, username, postId, token)
    if (!post) return notFound(res)
    const svg = await trendImage(username, post, 'svg')
    if (!svg) return notFound(res)
    sendSvg(res, svg)
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
    const key = articleBlockCacheKey('blockpng', username, postId, idx, block.updatedAt, blockBucketMs(block))
    if (negativeBlocks.has(key)) return notFound(res)
    const png = await cached(key, () => renderArticleBlockImage(deps, username, block, 'png'))
    if (!png) {
      negativeBlocks.add(key)
      return notFound(res)
    }
    sendPng(res, png)
  })

  router.get('/public/:username/feed/:postId/blocks/:index/figure.png', async (req, res) => {
    const { index, postId, username } = req.params
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    const idx = Number(index)
    const resolved = await resolveArticleBlockOf(deps, username, postId, idx, token)
    if (!resolved) return notFound(res)
    const { article, block } = resolved
    const key = articleBlockCacheKey('blockfig', username, postId, idx, block.updatedAt, blockBucketMs(block))
    if (negativeBlocks.has(key)) return notFound(res)
    const png = await cached(key, () => renderArticleBlockFigure(deps, username, article, idx, block))
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
    const key = articleBlockCacheKey('blocksvg', username, postId, idx, block.updatedAt, blockBucketMs(block))
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
