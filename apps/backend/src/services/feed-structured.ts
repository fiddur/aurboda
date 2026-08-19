/**
 * Build the native structured representation of a shared post — the payload
 * served at `GET /public/:username/feed/:postId` and fetched by a following
 * Aurboda instance to render a native chart/article instead of the
 * Mastodon-style HTML.
 *
 * An `activity` post reuses the exact same shared-scalar resolution as
 * delivery/the object dispatcher (`resolveActivityScalars`) and the exact same
 * data-scoped series resolution as the public `/series` endpoint
 * (`resolvePublicSeries`), so what a peer renders can never exceed what the
 * author shared. An `article` post resolves each chart/correlation block live
 * over its own locked window — the same bucketing (`queryMetricsBucketed`) and
 * correlation engine (`getContinuousCorrelation`) the block's own PNG and the
 * web's inline render use — so a peer's native render matches byte-for-byte
 * what the author sees. Only `public`/`unlisted` posts resolve unconditionally;
 * a `followers`-only post resolves only with a matching capability `token`
 * (the same gate as the object dispatcher, the outbox, and the block images).
 */
import type {
  ArticleBlock,
  ArticleContent,
  FeedStructuredArticle,
  FeedStructuredArticleBlock,
  FeedStructuredArticleChartBlock,
  FeedStructuredArticleCorrelationBlock,
  FeedStructuredPost,
} from '@aurboda/api-spec'

import { defaultArticleChartBucket } from '@aurboda/api-spec'

import type { FeedPostRecord } from '../db/index.ts'

import { getFeedPostById, getUserSettings } from '../db/index.ts'
import { metricUnits } from '../schema.ts'
import { resolveActivityScalars } from './activitypub/feed-activity.ts'
import { blockWindow, isZeroDurationBucket } from './article.ts'
import { getContinuousCorrelation } from './correlations/explore.ts'
import { isCapabilityAuthorized } from './feed-capability.ts'
import { floorSeriesBucket, samplesFromBucketedResult } from './feed-series.ts'
// Series + payload assembly live in the shared leaf module so the owner-facing
// feed serialisation (`feed.ts`) produces the identical payload (#1008).
import { assembleStructuredActivity, resolveStructuredSeries } from './feed-structured-activity.ts'
import { resolveFeedActivity } from './feed.ts'
import { queryMetricsBucketed } from './queries/index.ts'

/**
 * Resolve one article `chart` block to its structured samples over its
 * effective window (own override, else the article default), or `null` when
 * the block has no bounded window or a zero-duration bucket. Mirrors
 * `renderArticleBlockImage`'s chart path, minus the raster step — the samples
 * are the payload here, not a rendered image.
 */
const resolveStructuredChartBlock = async (
  user: string,
  block: Extract<ArticleBlock, { type: 'chart' }>,
  content: ArticleContent,
  tz: string | undefined,
): Promise<FeedStructuredArticleChartBlock | null> => {
  const { end, start } = blockWindow(block, content)
  if (start == null || end == null) return null
  const startDate = new Date(start)
  const endDate = new Date(end)
  if (startDate.getTime() >= endDate.getTime()) return null
  // Floor sub-5s buckets to the public-series minimum, like `resolvePublicSeries`
  // — an author-stored `1s` bucket over a wide window would otherwise yield
  // ~600k buckets on this unauthenticated endpoint. `floorSeriesBucket` now
  // understands `d`, so the common `1d`/`1h` buckets pass through unchanged. A
  // fuller sample cap + cache is tracked in #972 (with the block image's #969).
  const authored = block.bucket ?? defaultArticleChartBucket(startDate, endDate)
  if (isZeroDurationBucket(authored)) return null
  const bucket = floorSeriesBucket(authored)

  const result = await queryMetricsBucketed(user, [block.metric], startDate, endDate, bucket, { tz })
  const samples = samplesFromBucketedResult(result, block.metric)

  const resolved: FeedStructuredArticleChartBlock = {
    bucket,
    end,
    metric: block.metric,
    samples,
    start,
    type: 'chart',
  }
  if (block.caption !== undefined) resolved.caption = block.caption
  const unit = metricUnits[block.metric]
  if (unit) resolved.unit = unit
  return resolved
}

/**
 * Resolve one article `correlation` block to its computed correlation +
 * aligned scatter over its effective window, or `null` when the block has no
 * bounded window. Mirrors `renderArticleBlockImage`'s correlation path (the
 * same `getContinuousCorrelation` call), minus the raster step. Unlike the
 * image path (which 404s below n < 3), every windowed correlation block
 * resolves here — the receiver renders the same "not enough data" fallback the
 * web's live `ArticleCorrelationBlock` shows for a sparse result.
 */
const resolveStructuredCorrelationBlock = async (
  user: string,
  block: Extract<ArticleBlock, { type: 'correlation' }>,
  content: ArticleContent,
): Promise<FeedStructuredArticleCorrelationBlock | null> => {
  const { end, start } = blockWindow(block, content)
  if (start == null || end == null) return null
  if (new Date(start).getTime() >= new Date(end).getTime()) return null

  const c = await getContinuousCorrelation(user, {
    lagDays: block.lag_days,
    outcome: block.outcome,
    periodEnd: end.slice(0, 10),
    periodStart: start.slice(0, 10),
    trigger: block.trigger,
  })

  const resolved: FeedStructuredArticleCorrelationBlock = {
    end,
    group_comparison: c.group_comparison,
    n: c.n,
    outcome: block.outcome,
    pearson: c.pearson,
    pearson_p: c.pearson_p,
    series: c.series,
    spearman: c.spearman,
    start,
    trigger: block.trigger,
    type: 'correlation',
  }
  if (block.caption !== undefined) resolved.caption = block.caption
  if (block.lag_days !== undefined) resolved.lag_days = block.lag_days
  return resolved
}

/**
 * Build the structured payload for an article post: its title and every block,
 * resolved in order. A prose block passes its raw markdown through unchanged
 * (rendered by the receiver's own sanitising renderer — #910); a chart or
 * correlation block resolves live over its locked window and is omitted only
 * when that window itself is invalid (unbounded or non-increasing) — the same
 * condition `resolveArticleBlock` treats as ineligible for an image.
 *
 * Chart buckets in the author's own device timezone (`device_timezone`),
 * matching the block-image renderer, so a `1d` bucket splits on the author's
 * calendar days.
 */
const resolveStructuredArticle = async (
  user: string,
  article: ArticleContent,
): Promise<FeedStructuredArticle> => {
  const settings = await getUserSettings(user)
  const tz = settings?.device_timezone ?? undefined

  const blocks: FeedStructuredArticleBlock[] = []
  for (const block of article.blocks) {
    if (block.type === 'prose') {
      blocks.push({ markdown: block.markdown, type: 'prose' })
      continue
    }
    if (block.type === 'chart') {
      const resolved = await resolveStructuredChartBlock(user, block, article, tz)
      if (resolved) blocks.push(resolved)
      continue
    }
    const resolved = await resolveStructuredCorrelationBlock(user, block, article)
    if (resolved) blocks.push(resolved)
  }

  return { blocks, kind: 'article', title: article.title }
}

/**
 * Load one of `user`'s feed posts and authorize the requester, or null if the
 * post is unknown or the caller isn't allowed to see it. `public`/`unlisted`
 * posts authorize unconditionally; a `followers`-only post authorizes only with
 * a matching capability `token` (the same token that authorizes its
 * followers-only images), so an accepted follower's instance can render the
 * native chart/article while a public guess still 404s.
 *
 * Split from the content resolution so the unauthenticated `/feed/:postId` route
 * can authorize BEFORE consulting its cache (mirroring the sibling image routes'
 * `resolveImageWindow`/`resolveArticleBlock`): the `token` never enters the cache
 * key, an anonymous walk of `?token=…` can't inflate the key space, and flipping
 * a post to `followers` (or deleting it) drops it immediately instead of serving
 * a pre-authorized payload until a cache bucket rolls.
 */
export const loadAuthorizedStructuredPost = async (
  user: string,
  postId: string,
  token?: string,
): Promise<FeedPostRecord | null> => {
  const post = await getFeedPostById(user, postId)
  if (post == null || !isCapabilityAuthorized(post, token)) return null
  return post
}

/**
 * Resolve an already-authorized post to its structured payload, or null when it
 * has no resolvable content (an article with no body, an activity post with no
 * linked/resolvable activity). Caller MUST have authorized `post` first (via
 * `loadAuthorizedStructuredPost`) — this does no visibility check.
 */
export const resolveStructuredContent = async (
  user: string,
  post: FeedPostRecord,
): Promise<FeedStructuredPost | null> => {
  if (post.kind === 'article') {
    if (post.article == null) return null
    return resolveStructuredArticle(user, post.article)
  }

  if (post.activity_id == null) return null

  const activity = await resolveFeedActivity(user, post.activity_id)
  if (activity == null) return null

  const scalars = await resolveActivityScalars(
    user,
    { end_time: activity.end_time, start_time: activity.start_time },
    post.included_metrics,
  )

  const series = activity.end_time
    ? await resolveStructuredSeries(user, post.series_metrics, activity.start_time, activity.end_time)
    : []

  return assembleStructuredActivity(activity, scalars, series, post.message)
}

/**
 * Build the structured payload for one of `user`'s feed posts, or null if it is
 * unknown, not authorized for the caller, or has no resolvable content. A thin
 * load-then-resolve convenience over `loadAuthorizedStructuredPost` +
 * `resolveStructuredContent`; the cached `/feed/:postId` route calls those two
 * directly so it can authorize before consulting its cache.
 */
export const resolveStructuredPost = async (
  user: string,
  postId: string,
  token?: string,
): Promise<FeedStructuredPost | null> => {
  const post = await loadAuthorizedStructuredPost(user, postId, token)
  if (post == null) return null
  return resolveStructuredContent(user, post)
}
