import type { ArticleContent } from '@aurboda/api-spec'

import { describe, expect, test, vi } from 'vitest'

import type { FeedPostRecord } from '../db/index.ts'
import type { RaceChartSvgData } from './charts/race-chart-svg.ts'
import type { ScatterSvgData } from './charts/scatter-svg.ts'

import { impactBucket, impactData } from '../test/impact-fixture.ts'
import {
  articleBlockAt,
  articleBlockChart,
  loadPublicPostChartWith,
  bucketedCacheKey,
  imageCacheKey,
  postCardChart,
  postChartBucketMs,
  type PostChartDeps,
  STANDINGS_BUCKET_MS,
  timeBucket,
  TREND_BUCKET_MS,
} from './post-chart.ts'

const POST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ACTIVITY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const START = new Date('2026-07-01T06:30:00Z')
const END = new Date('2026-07-01T07:11:00Z')
const UPDATED = new Date('2026-07-01T08:00:00Z')
const WINDOW = { end: '2026-07-08T00:00:00Z', start: '2026-07-01T00:00:00Z' }

const series: [Date, number][] = [
  [START, 120],
  [END, 150],
]
const race: RaceChartSvgData = {
  asOf: END,
  endTime: END,
  lines: [{ color: '#2b9ea7', name: 'olle', points: series }],
  startTime: START,
  timezone: 'UTC',
  title: 'Steps',
}
const scatter: ScatterSvgData = {
  group_comparison: null,
  n: 5,
  outcome: { kind: 'metric', metric: 'sleep_score' },
  pearson: 0.5,
  pearson_p: 0.01,
  series: [{ outcome: 2, trigger: 1 }],
  spearman: 0.5,
  trigger: { kind: 'metric', metric: 'steps' },
}

const makePost = (overrides: Partial<FeedPostRecord> = {}): FeedPostRecord => ({
  activity_id: ACTIVITY_ID,
  article: null,
  autoshare_rule_id: null,
  challenge: null,
  created_at: UPDATED,
  dashboard: null,
  exercise: null,
  id: POST_ID,
  image_token: 'secret-token',
  in_reply_to_actor_uri: null,
  in_reply_to_handle: null,
  in_reply_to_uri: null,
  include_chart: true,
  include_exercises: false,
  include_map: true,
  included_metrics: [],
  kind: 'activity',
  message: null,
  series_metrics: [],
  tags: [],
  updated_at: UPDATED,
  visibility: 'public',
  ...overrides,
})

const article = (blocks: ArticleContent['blocks']): ArticleContent => ({ blocks, title: 'My analysis' })

const articlePost = (blocks: ArticleContent['blocks']): FeedPostRecord =>
  makePost({ activity_id: null, article: article(blocks), include_chart: false, kind: 'article' })

const mkDeps = (over: Partial<PostChartDeps> = {}): PostChartDeps => ({
  getActivity: vi.fn(async () => ({ end_time: END, start_time: START })),
  getArticleChartSeries: vi.fn(async () => series),
  getArticleImpact: vi.fn(async () => impactData()),
  getChallengeRaceByUrl: vi.fn(async () => race),
  getCorrelationScatter: vi.fn(async () => scatter),
  getExerciseTrend: vi.fn(async () => ({ measure: 'e1rm' as const, series })),
  getSeries: vi.fn(async () => series),
  getStandingsChart: vi.fn(async () => race),
  ...over,
})

describe('articleBlockAt', () => {
  test('resolves a chart block over its window, and leaves prose and bad indexes out', () => {
    const content = article([
      { markdown: 'hi', type: 'prose' },
      { end: WINDOW.end, metric: 'heart_rate', start: WINDOW.start, type: 'chart' },
    ])
    expect(articleBlockAt(content, UPDATED, 1)).toEqual({
      bucket: undefined,
      end: new Date(WINDOW.end),
      metric: 'heart_rate',
      start: new Date(WINDOW.start),
      type: 'chart',
      updatedAt: UPDATED,
    })
    for (const index of [0, 2, -1, 0.5]) expect(articleBlockAt(content, UPDATED, index)).toBeNull()
  })

  test('resolves an impact block over the article default window, 30 minutes around by default', () => {
    const content: ArticleContent = {
      blocks: [
        { activity: 'yoga', activity_type: 'activity_type', type: 'impact' },
        { activity: 'coffee', activity_type: 'tag', type: 'impact', window_minutes: 120 },
      ],
      default_end: WINDOW.end,
      default_start: WINDOW.start,
      title: 'Yoga',
    }
    expect(articleBlockAt(content, UPDATED, 0)).toEqual({
      activity: 'yoga',
      activityType: 'activity_type',
      end: new Date(WINDOW.end),
      start: new Date(WINDOW.start),
      type: 'impact',
      updatedAt: UPDATED,
      windowMinutes: 30,
    })
    expect(articleBlockAt(content, UPDATED, 1)).toMatchObject({ activity: 'coffee', windowMinutes: 120 })
  })

  test('leaves out an impact block without a window or with a reversed one', () => {
    const block = { activity: 'yoga', activity_type: 'activity_type' as const, type: 'impact' as const }
    expect(articleBlockAt(article([block]), UPDATED, 0)).toBeNull()
    const reversed = article([{ ...block, end: WINDOW.start, start: WINDOW.end }])
    expect(articleBlockAt(reversed, UPDATED, 0)).toBeNull()
  })
})

describe('articleBlockChart for an impact block', () => {
  const block = {
    activity: 'yoga',
    activityType: 'activity_type' as const,
    end: new Date(WINDOW.end),
    start: new Date(WINDOW.start),
    type: 'impact' as const,
    updatedAt: UPDATED,
    windowMinutes: 60,
  }

  test('draws the impact over the block window', async () => {
    const deps = mkDeps()
    expect(await articleBlockChart(deps, 'fiddur', block)).toEqual({ data: impactData(), type: 'impact' })
    expect(deps.getArticleImpact).toHaveBeenCalledWith('fiddur', {
      activity: 'yoga',
      activityType: 'activity_type',
      end: new Date(WINDOW.end),
      start: new Date(WINDOW.start),
      windowMinutes: 60,
    })
  })

  test('none without sessions, or with fewer than two buckets that have data', async () => {
    const none = mkDeps({ getArticleImpact: async () => impactData({ occurrences: 0 }) })
    expect(await articleBlockChart(none, 'fiddur', block)).toBeNull()
    const sparse = mkDeps({
      getArticleImpact: async () =>
        impactData({
          timeline: [
            impactBucket('before', -30, 0, null),
            impactBucket('during', 0, 0, 40),
            impactBucket('after', 0, 30, null),
          ],
        }),
    })
    expect(await articleBlockChart(sparse, 'fiddur', block)).toBeNull()
  })
})

describe('postCardChart', () => {
  test('an activity post draws its heart rate over the activity window, as chart.png does', async () => {
    const deps = mkDeps()
    expect(await postCardChart(deps, 'fiddur', makePost())).toEqual({ series, type: 'line' })
    expect(deps.getActivity).toHaveBeenCalledWith('fiddur', ACTIVITY_ID)
    expect(deps.getSeries).toHaveBeenCalledWith('fiddur', 'heart_rate', START, END)
  })

  test('an activity post without the chart opted in, an open activity or a single sample has none', async () => {
    expect(await postCardChart(mkDeps(), 'fiddur', makePost({ include_chart: false }))).toBeNull()
    const open = mkDeps({ getActivity: async () => ({ start_time: START }) })
    expect(await postCardChart(open, 'fiddur', makePost())).toBeNull()
    const single = mkDeps({ getSeries: async () => [series[0]] })
    expect(await postCardChart(single, 'fiddur', makePost())).toBeNull()
  })

  test('an exercise post draws its trend, labelled like trend.png', async () => {
    const post = makePost({
      activity_id: null,
      exercise: {
        activity_type: 'strength_training',
        field: 'sets.exercise',
        include_records: true,
        include_sessions: true,
        name: 'Bench',
        value: 'Bench',
      },
      kind: 'exercise',
    })
    expect(await postCardChart(mkDeps(), 'fiddur', post)).toEqual({
      opts: { color: '#2b9ea7', label: 'Best e1RM · Bench' },
      series,
      type: 'line',
    })
    expect(await postCardChart(mkDeps(), 'fiddur', { ...post, include_chart: false })).toBeNull()
  })

  test('a challenge post draws its standings race when opted in and there is a line', async () => {
    const post = makePost({ activity_id: null, kind: 'challenge' })
    expect(await postCardChart(mkDeps(), 'fiddur', post)).toEqual({ data: race, type: 'race' })
    expect(await postCardChart(mkDeps(), 'fiddur', { ...post, include_chart: false })).toBeNull()
    const empty = mkDeps({ getStandingsChart: async () => ({ ...race, lines: [] }) })
    expect(await postCardChart(empty, 'fiddur', post)).toBeNull()
  })

  test('an article draws its first block that has data, with no opt-in flag', async () => {
    const getArticleChartSeries = vi.fn(async () => [series[0]])
    const deps = mkDeps({ getArticleChartSeries })
    const post = articlePost([
      { markdown: 'hi', type: 'prose' },
      { end: WINDOW.end, metric: 'heart_rate', start: WINDOW.start, type: 'chart' },
      {
        end: WINDOW.end,
        outcome: { kind: 'metric', metric: 'sleep_score' },
        start: WINDOW.start,
        trigger: { kind: 'metric', metric: 'steps' },
        type: 'correlation',
      },
    ])
    expect(await postCardChart(deps, 'fiddur', post)).toEqual({ data: scatter, type: 'scatter' })
    expect(getArticleChartSeries).toHaveBeenCalledTimes(1)
  })

  test('an article labels a chart block with its metric', async () => {
    const post = articlePost([{ end: WINDOW.end, metric: 'heart_rate', start: WINDOW.start, type: 'chart' }])
    expect(await postCardChart(mkDeps(), 'fiddur', post)).toEqual({
      opts: { color: '#2b9ea7', label: 'Heart Rate' },
      series,
      type: 'line',
    })
  })

  test('an article tries at most three blocks', async () => {
    const getChallengeRaceByUrl = vi.fn(async () => null)
    const block = { challenge_url: 'https://qs.example/u/olle/nov', type: 'challenge' as const }
    const post = articlePost([block, block, block, block])
    expect(await postCardChart(mkDeps({ getChallengeRaceByUrl }), 'fiddur', post)).toBeNull()
    expect(getChallengeRaceByUrl).toHaveBeenCalledTimes(3)
  })

  test('a reply or a dashboard post has no chart', async () => {
    for (const kind of ['reply', 'dashboard'] as const) {
      expect(await postCardChart(mkDeps(), 'fiddur', makePost({ kind }))).toBeNull()
    }
  })
})

describe('loadPublicPostChartWith', () => {
  test('loads a public post’s chart, and none for any other visibility or a missing post', async () => {
    const posts: (FeedPostRecord | null)[] = [
      makePost(),
      makePost({ visibility: 'unlisted' }),
      makePost({ visibility: 'followers' }),
      null,
    ]
    const results = await Promise.all(
      posts.map((post) =>
        loadPublicPostChartWith({ ...mkDeps(), getPost: async () => post })('fiddur', POST_ID),
      ),
    )
    expect(results).toEqual([{ series, type: 'line' }, null, null, null])
  })
})

describe('postChartBucketMs', () => {
  const challengeBlock = { challenge_url: 'https://qs.example/u/olle/nov', type: 'challenge' as const }
  const chartBlock = {
    end: WINDOW.end,
    metric: 'heart_rate' as const,
    start: WINDOW.start,
    type: 'chart' as const,
  }

  test('matches the feed image caches: an activity none, an exercise hourly, a challenge five minutes', () => {
    expect(postChartBucketMs(makePost())).toBeUndefined()
    expect(postChartBucketMs(makePost({ kind: 'exercise' }))).toBe(TREND_BUCKET_MS)
    expect(postChartBucketMs(makePost({ kind: 'challenge' }))).toBe(STANDINGS_BUCKET_MS)
    expect(TREND_BUCKET_MS).toBe(3_600_000)
    expect(STANDINGS_BUCKET_MS).toBe(300_000)
  })

  test('none for a post that cannot have a chart', () => {
    for (const kind of ['exercise', 'challenge'] as const) {
      expect(postChartBucketMs(makePost({ include_chart: false, kind }))).toBeUndefined()
    }
    expect(postChartBucketMs(makePost({ kind: 'reply' }))).toBeUndefined()
    expect(postChartBucketMs(articlePost([{ markdown: 'hi', type: 'prose' }]))).toBeUndefined()
  })

  test('an article hourly, or five minutes when a challenge block is among the three it tries', () => {
    expect(postChartBucketMs(articlePost([chartBlock]))).toBe(3_600_000)
    expect(postChartBucketMs(articlePost([chartBlock, challengeBlock]))).toBe(STANDINGS_BUCKET_MS)
    expect(postChartBucketMs(articlePost([chartBlock, chartBlock, chartBlock, challengeBlock]))).toBe(
      3_600_000,
    )
  })
})

describe('cache keys', () => {
  test('keep the feed image routes’ format: the post version, then the time bucket', () => {
    expect(imageCacheKey('chart', 'fiddur', POST_ID, { updated_at: UPDATED })).toBe(
      `chart:fiddur:${POST_ID}:${UPDATED.getTime()}`,
    )
    expect(bucketedCacheKey('trendpng', 'fiddur', POST_ID, UPDATED, 7_300_000, TREND_BUCKET_MS)).toBe(
      `trendpng:fiddur:${POST_ID}:${UPDATED.getTime()}:2`,
    )
    expect(timeBucket(7_300_000, TREND_BUCKET_MS)).toBe(2)
  })
})
