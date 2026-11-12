/**
 * Where a feed post's chart comes from: the series, race or scatter its feed image draws. Shared
 * by the feed image routes (`chart`, `trend`, `standings` and article block images) and the
 * post's Open Graph card, so the card shows exactly what the feed attachment does.
 */
import type { ActivityImpactType, ArticleContent, CorrelationSelector, MetricType } from '@aurboda/api-spec'

import {
  activityMeasureLabels,
  DEFAULT_IMPACT_WINDOW_MINUTES,
  defaultArticleChartBucket,
  getMetricDisplayName,
} from '@aurboda/api-spec'

import type { FeedPostRecord } from '../db/index.ts'
import type { CorrelationBlockParams, ImpactBlockParams } from './article-block-data.ts'
import type { ImpactSvgData } from './charts/impact-svg.ts'
import type { RaceChartSvgData } from './charts/race-chart-svg.ts'
import type { ScatterSvgData } from './charts/scatter-svg.ts'
import type { ExerciseTrendSeries } from './feed-structured-exercise.ts'

import { blockWindow, isZeroDurationBucket } from './article.ts'
import {
  type ChartRenderOpts,
  isDrawableImpact,
  isDrawablePostChart,
  type PostChart,
} from './charts/post-chart-svg.ts'

export interface PostChartDeps {
  getActivity: (user: string, activityId: string) => Promise<{ start_time: Date; end_time?: Date } | null>
  getSeries: (user: string, metric: string, start: Date, end: Date) => Promise<[Date, number][]>
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
  /** An article impact block's numbers over its locked window. */
  getArticleImpact: (user: string, params: ImpactBlockParams) => Promise<ImpactSvgData>
  /** A challenge post's standings race, or null when it has no standings to draw. */
  getStandingsChart: (user: string, post: FeedPostRecord) => Promise<RaceChartSvgData | null>
  /** The standings race of the challenge at a URL (an article's challenge block), or null. */
  getChallengeRaceByUrl: (user: string, url: string) => Promise<RaceChartSvgData | null>
  /** An exercise post's trend line, or null when it has fewer than 2 points. */
  getExerciseTrend: (user: string, post: FeedPostRecord) => Promise<ExerciseTrendSeries | null>
}

/**
 * One non-prose article block resolved to its render inputs; a windowed block's
 * window is its own override, else the article default.
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
  | { type: 'challenge'; url: string; updatedAt: Date }
  | {
      type: 'impact'
      activity: string
      activityType: ActivityImpactType
      windowMinutes: number
      start: Date
      end: Date
      updatedAt: Date
    }

/**
 * The block at `index` resolved to its render inputs, or null for an out-of-range or prose
 * block, or a windowed block whose effective window is unbounded / non-increasing.
 */
export const articleBlockAt = (
  article: ArticleContent,
  updatedAt: Date,
  index: number,
): ResolvedArticleBlock | null => {
  if (!Number.isInteger(index) || index < 0) return null
  const block = article.blocks[index]
  if (block == null || block.type === 'prose') return null
  if (block.type === 'challenge') return { type: 'challenge', updatedAt, url: block.challenge_url }
  const { end, start } = blockWindow(block, article)
  if (start == null || end == null) return null
  const startDate = new Date(start)
  const endDate = new Date(end)
  if (startDate.getTime() >= endDate.getTime()) return null
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
  if (block.type === 'impact') {
    return {
      activity: block.activity,
      activityType: block.activity_type,
      end: endDate,
      start: startDate,
      type: 'impact',
      updatedAt,
      windowMinutes: block.window_minutes ?? DEFAULT_IMPACT_WINDOW_MINUTES,
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
const ARTICLE_CHART_COLOR = '#2b9ea7'
const TREND_COLOR = '#2b9ea7'

/** The shared activity's heart rate over its window; null with no samples at all. */
export const activityHeartRateChart = async (
  deps: Pick<PostChartDeps, 'getSeries'>,
  user: string,
  window: { start_time: Date; end_time: Date },
): Promise<PostChart | null> => {
  const series = await deps.getSeries(user, 'heart_rate', window.start_time, window.end_time)
  return series.length === 0 ? null : { series, type: 'line' }
}

/** An exercise post's trend, labelled with its measure and the exercise; null under 2 points. */
export const exerciseTrendChart = async (
  deps: Pick<PostChartDeps, 'getExerciseTrend'>,
  user: string,
  post: FeedPostRecord,
): Promise<PostChart | null> => {
  const trend = await deps.getExerciseTrend(user, post)
  if (trend == null || trend.series.length < 2) return null
  const label = [activityMeasureLabels[trend.measure], post.exercise?.name].filter(Boolean).join(' · ')
  return { opts: { color: TREND_COLOR, label }, series: trend.series, type: 'line' }
}

/** A challenge post's standings race; null without a line to draw. */
export const standingsChart = async (
  deps: Pick<PostChartDeps, 'getStandingsChart'>,
  user: string,
  post: FeedPostRecord,
): Promise<PostChart | null> => {
  const data = await deps.getStandingsChart(user, post)
  return data == null || data.lines.length === 0 ? null : { data, type: 'race' }
}

/**
 * One article block's chart, or null when it has too little data to draw (a chart needs ≥ 2
 * points; a correlation n ≥ 3, surfaced by `getCorrelationScatter` returning null; a challenge
 * a race line; an impact a session and two buckets with data) or its bucket is a zero duration.
 */
export const articleBlockChart = async (
  deps: Pick<
    PostChartDeps,
    'getArticleChartSeries' | 'getArticleImpact' | 'getChallengeRaceByUrl' | 'getCorrelationScatter'
  >,
  user: string,
  block: ResolvedArticleBlock,
): Promise<PostChart | null> => {
  if (block.type === 'impact') {
    const data = await deps.getArticleImpact(user, {
      activity: block.activity,
      activityType: block.activityType,
      end: block.end,
      start: block.start,
      windowMinutes: block.windowMinutes,
    })
    return isDrawableImpact(data) ? { data, type: 'impact' } : null
  }
  if (block.type === 'challenge') {
    const data = await deps.getChallengeRaceByUrl(user, block.url)
    return data == null || data.lines.length === 0 ? null : { data, type: 'race' }
  }
  if (block.type === 'chart') {
    const bucket = block.bucket ?? defaultArticleChartBucket(block.start, block.end)
    if (isZeroDurationBucket(bucket)) return null
    const series = await deps.getArticleChartSeries(user, block.metric, block.start, block.end, bucket)
    if (series.length < 2) return null
    const opts: ChartRenderOpts = { color: ARTICLE_CHART_COLOR, label: getMetricDisplayName(block.metric) }
    return { opts, series, type: 'line' }
  }
  const data = await deps.getCorrelationScatter(user, {
    lagDays: block.lagDays,
    outcome: block.outcome,
    periodEnd: block.periodEnd,
    periodStart: block.periodStart,
    trigger: block.trigger,
  })
  return data == null ? null : { data, type: 'scatter' }
}

/** Each try may run a correlation; a card for an article of empty blocks should not run them all. */
const MAX_ARTICLE_BLOCK_TRIES = 3

/** The blocks a card tries, in order, for its article chart. */
const articleCardBlocks = (article: ArticleContent, updatedAt: Date): ResolvedArticleBlock[] =>
  article.blocks
    .map((_, index) => articleBlockAt(article, updatedAt, index))
    .filter((block): block is ResolvedArticleBlock => block != null)
    .slice(0, MAX_ARTICLE_BLOCK_TRIES)

const firstArticleChart = async (
  deps: PostChartDeps,
  user: string,
  article: ArticleContent,
  updatedAt: Date,
): Promise<PostChart | null> => {
  for (const block of articleCardBlocks(article, updatedAt)) {
    const chart = await articleBlockChart(deps, user, block)
    if (chart != null && isDrawablePostChart(chart)) return chart
  }
  return null
}

/**
 * The chart a post's link-preview card draws: the same one its feed attachment shows, under the
 * same opt-in. An activity post's heart rate (`include_chart`), an exercise post's trend and a
 * challenge post's standings (both `include_chart`), and an article's first block that draws. A
 * route map is left out: it needs basemap tiles. Visibility is the caller's to check.
 */
export const postCardChart = async (
  deps: PostChartDeps,
  user: string,
  post: FeedPostRecord,
): Promise<PostChart | null> => {
  const chart = await (async (): Promise<PostChart | null> => {
    switch (post.kind) {
      case 'activity': {
        if (!post.include_chart || post.activity_id == null) return null
        const activity = await deps.getActivity(user, post.activity_id)
        if (activity?.end_time == null) return null
        return activityHeartRateChart(deps, user, {
          end_time: activity.end_time,
          start_time: activity.start_time,
        })
      }
      case 'exercise':
        return post.include_chart ? exerciseTrendChart(deps, user, post) : null
      case 'challenge':
        return post.include_chart ? standingsChart(deps, user, post) : null
      case 'article':
        return post.article == null ? null : firstArticleChart(deps, user, post.article, post.updated_at)
      default:
        return null
    }
  })()
  return chart != null && isDrawablePostChart(chart) ? chart : null
}

/** Remote members' standings are cached for this long, so a finer render key buys nothing. */
export const STANDINGS_BUCKET_MS = 300_000

/** New sessions move an exercise's trend, at most a few times a day. */
export const TREND_BUCKET_MS = 3_600_000

/** An article block's window can gain data after publish (`articleBlockCacheKey`'s default bucket). */
const ARTICLE_BUCKET_MS = 3_600_000

export const timeBucket = (now: number, bucketMs: number): number => Math.floor(now / bucketMs)

/**
 * Keyed on the post's stored version, not the URL's `v`: a detail sync or an
 * edit bumps `updated_at` and re-renders, while a guessed `v` cannot bust the cache.
 */
export const imageCacheKey = (
  kind: string,
  username: string,
  postId: string,
  window: { updated_at: Date },
): string => `${kind}:${username}:${postId}:${window.updated_at.getTime()}`

/** The post's version plus a time bucket: an edit busts it, and so does the data moving on. */
export const bucketedCacheKey = (
  kind: string,
  username: string,
  postId: string,
  updatedAt: Date,
  now: number,
  bucketMs: number,
): string =>
  `${imageCacheKey(kind, username, postId, { updated_at: updatedAt })}:${timeBucket(now, bucketMs)}`

/**
 * How long a card's chart may stand before it is drawn afresh, matching the feed image's render
 * cache: undefined where the chart moves only with the post (an activity's heart rate) or the post
 * cannot have one. An article's tried blocks move hourly, or with the standings when a challenge
 * block is among them.
 */
export const postChartBucketMs = (
  post: Pick<FeedPostRecord, 'article' | 'include_chart' | 'kind' | 'updated_at'>,
): number | undefined => {
  switch (post.kind) {
    case 'exercise':
      return post.include_chart ? TREND_BUCKET_MS : undefined
    case 'challenge':
      return post.include_chart ? STANDINGS_BUCKET_MS : undefined
    case 'article': {
      const blocks = post.article == null ? [] : articleCardBlocks(post.article, post.updated_at)
      if (blocks.length === 0) return undefined
      return blocks.some((block) => block.type === 'challenge') ? STANDINGS_BUCKET_MS : ARTICLE_BUCKET_MS
    }
    default:
      return undefined
  }
}

/** The card chart of a public post; anything else, or a post that is gone, has none. */
export const loadPublicPostChartWith =
  (deps: PostChartDeps & { getPost: (user: string, postId: string) => Promise<FeedPostRecord | null> }) =>
  async (user: string, postId: string): Promise<PostChart | null> => {
    const post = await deps.getPost(user, postId)
    return post?.visibility === 'public' ? postCardChart(deps, user, post) : null
  }
