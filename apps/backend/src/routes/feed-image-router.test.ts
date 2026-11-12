import type { ArticleContent } from '@aurboda/api-spec'

import express from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import type { FeedPostRecord } from '../db/index.ts'
import type { RaceChartSvgData } from '../services/charts/race-chart-svg.ts'
import type { ScatterSvgData } from '../services/charts/scatter-svg.ts'
import type { ExerciseTrendSeries } from '../services/feed-structured-exercise.ts'

import { createNegativeCache, forgetArticleBlockMisses } from '../services/article-block-misses.ts'
import { impactData } from '../test/impact-fixture.ts'
import {
  createFeedImageRouter,
  createRenderCache,
  type FeedImageDeps,
  type ImageActivity,
  type ImageWindow,
  renderArticleBlockImage,
  resolveArticleBlock,
  type ResolvedArticleBlock,
  imageCacheKey,
  resolveExercisePost,
  resolveImageWindow,
  resolveStandingsPost,
  standingsCacheKey,
  trendCacheKey,
} from './feed-image-router.ts'

const POST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ACTIVITY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const activity: ImageActivity = {
  end_time: new Date('2026-07-01T07:11:00Z'),
  start_time: new Date('2026-07-01T06:30:00Z'),
}

const makePost = (overrides: Partial<FeedPostRecord> = {}): FeedPostRecord => ({
  activity_id: ACTIVITY_ID,
  article: null,
  autoshare_rule_id: null,
  challenge: null,
  dashboard: null,
  exercise: null,
  created_at: new Date('2026-07-01T08:00:00Z'),
  id: POST_ID,
  image_token: 'secret-token',
  in_reply_to_actor_uri: null,
  in_reply_to_handle: null,
  in_reply_to_uri: null,
  include_chart: true,
  include_map: true,
  include_exercises: false,
  included_metrics: [],
  kind: 'activity',
  message: null,
  series_metrics: [],
  tags: [],
  updated_at: new Date('2026-07-01T08:00:00Z'),
  visibility: 'public',
  ...overrides,
})

const window: ImageWindow = {
  end_time: new Date('2026-07-01T07:11:00Z'),
  start_time: new Date('2026-07-01T06:30:00Z'),
  updated_at: new Date('2026-07-01T08:00:00Z'),
}

const deps = (post: FeedPostRecord | null, act: ImageActivity | null = activity) => ({
  getActivity: async () => act,
  getPost: async () => post,
})

describe('resolveImageWindow', () => {
  test('resolves the activity window for an eligible public opted-in post', async () => {
    expect(await resolveImageWindow(deps(makePost()), 'fiddur', POST_ID, 'include_chart')).toEqual(window)
  })

  test('null for an invalid username or non-UUID post id (no DB hit)', async () => {
    expect(await resolveImageWindow(deps(makePost()), 'Bad..Name', POST_ID, 'include_chart')).toBeNull()
    expect(await resolveImageWindow(deps(makePost()), 'fiddur', 'not-a-uuid', 'include_chart')).toBeNull()
  })

  test('null when the post is missing', async () => {
    expect(await resolveImageWindow(deps(null), 'fiddur', POST_ID, 'include_chart')).toBeNull()
  })

  test('null for a followers-only post without a token', async () => {
    const post = makePost({ image_token: 'secret-token', visibility: 'followers' })
    expect(await resolveImageWindow(deps(post), 'fiddur', POST_ID, 'include_chart')).toBeNull()
  })

  test('null for a followers-only post with the wrong token', async () => {
    const post = makePost({ image_token: 'secret-token', visibility: 'followers' })
    expect(await resolveImageWindow(deps(post), 'fiddur', POST_ID, 'include_chart', 'wrong')).toBeNull()
    // A prefix of the real token must not pass (length-checked constant-time compare).
    expect(await resolveImageWindow(deps(post), 'fiddur', POST_ID, 'include_chart', 'secret')).toBeNull()
  })

  test('resolves a followers-only post when the capability token matches (#893)', async () => {
    const post = makePost({ image_token: 'secret-token', visibility: 'followers' })
    expect(await resolveImageWindow(deps(post), 'fiddur', POST_ID, 'include_chart', 'secret-token')).toEqual(
      window,
    )
  })

  test('a token is ignored for a public post (already unauthenticated)', async () => {
    expect(
      await resolveImageWindow(deps(makePost()), 'fiddur', POST_ID, 'include_chart', 'anything'),
    ).toEqual(window)
  })

  test('null when the requested attachment was not opted into', async () => {
    const post = makePost({ include_chart: false })
    expect(await resolveImageWindow(deps(post), 'fiddur', POST_ID, 'include_chart')).toBeNull()
    // ...but the map flag is still on for the same post.
    expect(await resolveImageWindow(deps(post), 'fiddur', POST_ID, 'include_map')).toEqual(window)
  })

  test('null when the post has no linked activity', async () => {
    expect(
      await resolveImageWindow(deps(makePost({ activity_id: null })), 'fiddur', POST_ID, 'include_chart'),
    ).toBeNull()
  })

  test('carries the post version, so a bumped updated_at renders afresh', async () => {
    const updated_at = new Date('2026-07-01T09:15:00Z')
    const resolved = await resolveImageWindow(
      deps(makePost({ updated_at })),
      'fiddur',
      POST_ID,
      'include_map',
    )
    expect(resolved?.updated_at).toEqual(updated_at)
    expect(imageCacheKey('route', 'fiddur', POST_ID, window)).not.toBe(
      imageCacheKey('route', 'fiddur', POST_ID, { ...window, updated_at }),
    )
  })

  test('null for an open-ended activity (no bounded window)', async () => {
    const openEnded = { start_time: activity.start_time }
    expect(await resolveImageWindow(deps(makePost(), openEnded), 'fiddur', POST_ID, 'include_map')).toBeNull()
  })
})

const WINDOW = { end: '2026-07-02T00:00:00Z', start: '2026-07-01T00:00:00Z' }

const article = (blocks: ArticleContent['blocks'], extra: Partial<ArticleContent> = {}): ArticleContent => ({
  blocks,
  title: 'My analysis',
  ...extra,
})

const articlePost = (content: ArticleContent, overrides: Partial<FeedPostRecord> = {}): FeedPostRecord =>
  makePost({ activity_id: null, article: content, kind: 'article', ...overrides })

describe('resolveArticleBlock', () => {
  const chart = article([{ end: WINDOW.end, metric: 'heart_rate', start: WINDOW.start, type: 'chart' }])
  const correlation = article([
    {
      end: WINDOW.end,
      outcome: { kind: 'metric', metric: 'sleep_score' },
      start: WINDOW.start,
      trigger: { kind: 'metric', metric: 'steps' },
      type: 'correlation',
    },
  ])

  test('resolves a chart block to its metric and window', async () => {
    const block = await resolveArticleBlock(deps(articlePost(chart)), 'fiddur', POST_ID, 0)
    expect(block).toMatchObject({
      end: new Date(WINDOW.end),
      metric: 'heart_rate',
      start: new Date(WINDOW.start),
      type: 'chart',
    })
  })

  test('resolves a correlation block with its selectors', async () => {
    const block = await resolveArticleBlock(deps(articlePost(correlation)), 'fiddur', POST_ID, 0)
    expect(block).toMatchObject({
      outcome: { kind: 'metric', metric: 'sleep_score' },
      trigger: { kind: 'metric', metric: 'steps' },
      type: 'correlation',
    })
  })

  test('correlation day bounds are the ISO window’s date part (matches the web toDay)', async () => {
    // Windows are Z-only (iso8601DateTimeSchema), so the day is `iso.slice(0, 10)` —
    // slicing the raw string, not round-tripping through Date, keeps web parity exact.
    const corr = article([
      {
        end: '2026-07-10T06:00:00Z',
        outcome: { kind: 'metric', metric: 'sleep_score' },
        start: '2026-07-01T18:00:00Z',
        trigger: { kind: 'metric', metric: 'steps' },
        type: 'correlation',
      },
    ])
    const block = await resolveArticleBlock(deps(articlePost(corr)), 'fiddur', POST_ID, 0)
    expect(block).toMatchObject({ periodEnd: '2026-07-10', periodStart: '2026-07-01', type: 'correlation' })
  })

  test('inherits the article default window when the block omits its own', async () => {
    const content = article([{ metric: 'heart_rate', type: 'chart' }], {
      default_end: WINDOW.end,
      default_start: WINDOW.start,
    })
    const block = await resolveArticleBlock(deps(articlePost(content)), 'fiddur', POST_ID, 0)
    expect(block).toMatchObject({ end: new Date(WINDOW.end), start: new Date(WINDOW.start), type: 'chart' })
  })

  test('carries the post updated_at (so an edit busts the image cache)', async () => {
    const updated_at = new Date('2026-07-05T09:00:00Z')
    const block = await resolveArticleBlock(deps(articlePost(chart, { updated_at })), 'fiddur', POST_ID, 0)
    expect(block?.updatedAt).toEqual(updated_at)
  })

  test('null for a prose block, an out-of-range, negative, or non-integer index', async () => {
    const content = article([{ markdown: '# hi', type: 'prose' }, ...chart.blocks])
    expect(await resolveArticleBlock(deps(articlePost(content)), 'fiddur', POST_ID, 0)).toBeNull() // prose
    expect(await resolveArticleBlock(deps(articlePost(content)), 'fiddur', POST_ID, 5)).toBeNull() // out of range
    expect(await resolveArticleBlock(deps(articlePost(content)), 'fiddur', POST_ID, -1)).toBeNull()
    expect(await resolveArticleBlock(deps(articlePost(content)), 'fiddur', POST_ID, 1.5)).toBeNull()
    expect(await resolveArticleBlock(deps(articlePost(content)), 'fiddur', POST_ID, Number.NaN)).toBeNull()
  })

  test('null for a non-article post', async () => {
    expect(await resolveArticleBlock(deps(makePost()), 'fiddur', POST_ID, 0)).toBeNull()
  })

  test('resolves a challenge block to its URL, with no window needed', async () => {
    const updated_at = new Date('2026-07-05T00:00:00Z')
    const content = article([{ challenge_url: 'https://qs.example/u/olle/nov', type: 'challenge' }])
    const block = await resolveArticleBlock(deps(articlePost(content, { updated_at })), 'fiddur', POST_ID, 0)
    expect(block).toEqual({ type: 'challenge', updatedAt: updated_at, url: 'https://qs.example/u/olle/nov' })
  })

  test('gated on visibility only — no include_chart flag needed for an article', async () => {
    // A public article block resolves even with include_chart off (articles have
    // no opt-in flag; visibility is the whole boundary, #943).
    const post = articlePost(chart, { include_chart: false })
    expect(await resolveArticleBlock(deps(post), 'fiddur', POST_ID, 0)).not.toBeNull()
  })

  test('followers-only: null without a token, resolves with the matching token, null with a wrong one', async () => {
    const post = articlePost(chart, { image_token: 'secret-token', visibility: 'followers' })
    expect(await resolveArticleBlock(deps(post), 'fiddur', POST_ID, 0)).toBeNull()
    expect(await resolveArticleBlock(deps(post), 'fiddur', POST_ID, 0, 'wrong')).toBeNull()
    expect(await resolveArticleBlock(deps(post), 'fiddur', POST_ID, 0, 'secret-token')).not.toBeNull()
  })

  test('null when a block resolves to an unbounded or non-increasing window', async () => {
    const noWindow = article([{ metric: 'heart_rate', type: 'chart' }]) // no block window, no article default
    expect(await resolveArticleBlock(deps(articlePost(noWindow)), 'fiddur', POST_ID, 0)).toBeNull()
    const reversed = article([{ end: WINDOW.start, metric: 'heart_rate', start: WINDOW.end, type: 'chart' }])
    expect(await resolveArticleBlock(deps(articlePost(reversed)), 'fiddur', POST_ID, 0)).toBeNull()
  })

  test('null for an invalid username or non-UUID post id (no DB hit)', async () => {
    expect(await resolveArticleBlock(deps(articlePost(chart)), 'Bad..Name', POST_ID, 0)).toBeNull()
    expect(await resolveArticleBlock(deps(articlePost(chart)), 'fiddur', 'not-a-uuid', 0)).toBeNull()
  })
})

describe('renderArticleBlockImage', () => {
  const START = new Date('2026-07-01T00:00:00Z')
  const END = new Date('2026-07-08T00:00:00Z')
  const UPDATED = new Date('2026-07-09T00:00:00Z')
  const series: [Date, number][] = [
    [START, 60],
    [END, 65],
  ]
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

  const chartBlock: ResolvedArticleBlock = {
    end: END,
    metric: 'heart_rate',
    start: START,
    type: 'chart',
    updatedAt: UPDATED,
  }
  const correlationBlock: ResolvedArticleBlock = {
    outcome: { kind: 'metric', metric: 'sleep_score' },
    periodEnd: '2026-07-08',
    periodStart: '2026-07-01',
    trigger: { kind: 'metric', metric: 'steps' },
    type: 'correlation',
    updatedAt: UPDATED,
  }

  const mkDeps = (over: Partial<FeedImageDeps> = {}): FeedImageDeps => ({
    getActivity: async () => null,
    getArticleChartSeries: vi.fn(async () => series),
    getArticleImpact: async () => impactData(),
    getCorrelationScatter: vi.fn(async () => scatter),
    getPost: async () => null,
    getRoute: async () => [],
    getSeries: async () => [],
    getExerciseTrend: async () => null,
    getChallengeRaceByUrl: vi.fn(async () => null),
    getStandingsChart: async () => null,
    rasterizeSvg: async () => Buffer.from('figure-png'),
    renderChart: vi.fn(async () => Buffer.from('chart-png')),
    renderChartSvg: vi.fn(() => '<svg>chart</svg>'),
    renderImpact: async () => Buffer.from('impact-png'),
    renderImpactSvg: () => '<svg>impact</svg>',
    renderRoute: async () => Buffer.from(''),
    renderScatter: vi.fn(async () => Buffer.from('scatter-png')),
    renderRaceChart: async () => Buffer.from(''),
    renderRaceChartSvg: () => '',
    renderScatterSvg: vi.fn(() => '<svg>scatter</svg>'),
    ...over,
  })

  const race: RaceChartSvgData = {
    asOf: END,
    endTime: END,
    lines: [
      {
        color: '#2b9ea7',
        name: 'olle',
        points: [
          [START, 0],
          [END, 10],
        ],
      },
    ],
    startTime: START,
    timezone: 'UTC',
    title: 'Steps',
  }
  const challengeBlock: ResolvedArticleBlock = {
    type: 'challenge',
    updatedAt: UPDATED,
    url: 'https://qs.example/u/olle/nov',
  }

  test('renders a challenge block as the standings race chart', async () => {
    const renderRaceChart = vi.fn(async () => Buffer.from('race-png'))
    const d = mkDeps({ getChallengeRaceByUrl: vi.fn(async () => race), renderRaceChart })
    expect(await renderArticleBlockImage(d, 'fiddur', challengeBlock, 'png')).toEqual(Buffer.from('race-png'))
    expect(d.getChallengeRaceByUrl).toHaveBeenCalledWith('fiddur', 'https://qs.example/u/olle/nov')
    expect(renderRaceChart).toHaveBeenCalledWith(race)
    const svg = await renderArticleBlockImage(
      mkDeps({ getChallengeRaceByUrl: async () => race, renderRaceChartSvg: () => '<svg>race</svg>' }),
      'fiddur',
      challengeBlock,
      'svg',
    )
    expect(svg?.toString('utf8')).toBe('<svg>race</svg>')
  })

  test('null for a challenge block without standings or a drawable line', async () => {
    expect(await renderArticleBlockImage(mkDeps(), 'fiddur', challengeBlock, 'png')).toBeNull()
    const empty = mkDeps({ getChallengeRaceByUrl: async () => ({ ...race, lines: [] }) })
    expect(await renderArticleBlockImage(empty, 'fiddur', challengeBlock, 'png')).toBeNull()
  })

  test('renders a chart block as PNG (labelled with the metric display name)', async () => {
    const d = mkDeps()
    const png = await renderArticleBlockImage(d, 'fiddur', chartBlock, 'png')
    expect(png).toEqual(Buffer.from('chart-png'))
    expect(d.getArticleChartSeries).toHaveBeenCalledWith('fiddur', 'heart_rate', START, END, '1d')
    expect(d.renderChart).toHaveBeenCalledWith(series, { color: '#2b9ea7', label: 'Heart Rate' })
  })

  test('renders a chart block as SVG bytes', async () => {
    const d = mkDeps()
    const svg = await renderArticleBlockImage(d, 'fiddur', chartBlock, 'svg')
    expect(svg).toEqual(Buffer.from('<svg>chart</svg>', 'utf8'))
    expect(d.renderScatter).not.toHaveBeenCalled()
  })

  test('renders a correlation block via the scatter renderer', async () => {
    const d = mkDeps()
    const png = await renderArticleBlockImage(d, 'fiddur', correlationBlock, 'png')
    expect(png).toEqual(Buffer.from('scatter-png'))
    expect(d.getCorrelationScatter).toHaveBeenCalledWith('fiddur', {
      lagDays: undefined,
      outcome: correlationBlock.type === 'correlation' ? correlationBlock.outcome : undefined,
      periodEnd: '2026-07-08',
      periodStart: '2026-07-01',
      trigger: correlationBlock.type === 'correlation' ? correlationBlock.trigger : undefined,
    })
  })

  test('null when the chart has < 2 points', async () => {
    const d = mkDeps({ getArticleChartSeries: vi.fn(async () => [[START, 60]] as [Date, number][]) })
    expect(await renderArticleBlockImage(d, 'fiddur', chartBlock, 'png')).toBeNull()
  })

  test('null when the correlation is too sparse (getCorrelationScatter → null)', async () => {
    const d = mkDeps({ getCorrelationScatter: vi.fn(async () => null) })
    expect(await renderArticleBlockImage(d, 'fiddur', correlationBlock, 'png')).toBeNull()
  })

  test('null for a zero-duration bucket, without hitting the DB (avoids a date_bin 500)', async () => {
    const d = mkDeps()
    const png = await renderArticleBlockImage(d, 'fiddur', { ...chartBlock, bucket: '0s' }, 'png')
    expect(png).toBeNull()
    expect(d.getArticleChartSeries).not.toHaveBeenCalled()
  })
})

describe('createNegativeCache', () => {
  test('remembers a negative key and evicts the oldest past the bound', () => {
    const neg = createNegativeCache(2)
    expect(neg.has('a')).toBe(false)
    neg.add('a')
    neg.add('b')
    expect(neg.has('a')).toBe(true)
    neg.add('c') // over the bound → evicts the oldest ('a')
    expect(neg.has('a')).toBe(false)
    expect(neg.has('c')).toBe(true)
  })
})

describe('createRenderCache', () => {
  const png = (s: string) => Buffer.from(s)

  test('renders once per key, then serves the cached buffer', async () => {
    const cached = createRenderCache()
    const produce = vi.fn(async () => png('a'))
    expect(await cached('k', produce)).toEqual(png('a'))
    expect(await cached('k', produce)).toEqual(png('a'))
    expect(produce).toHaveBeenCalledTimes(1)
  })

  test('de-duplicates concurrent misses into a single render', async () => {
    const cached = createRenderCache()
    const produce = vi.fn(async () => png('b'))
    const [a, b] = await Promise.all([cached('k', produce), cached('k', produce)])
    expect(a).toEqual(png('b'))
    expect(b).toEqual(png('b'))
    expect(produce).toHaveBeenCalledTimes(1)
  })

  test('renders separately per key', async () => {
    const cached = createRenderCache()
    const produce = vi.fn(async (): Promise<Buffer | null> => png('x'))
    await cached('k1', produce)
    await cached('k2', produce)
    expect(produce).toHaveBeenCalledTimes(2)
  })

  test('does not cache a null (no-data) result', async () => {
    const cached = createRenderCache()
    const produce = vi.fn(async (): Promise<Buffer | null> => null)
    expect(await cached('k', produce)).toBeNull()
    expect(await cached('k', produce)).toBeNull()
    expect(produce).toHaveBeenCalledTimes(2)
  })

  test('evicts the oldest entry past the bound', async () => {
    const cached = createRenderCache(1)
    const produce = vi.fn(async (): Promise<Buffer | null> => png('v'))
    await cached('k1', produce) // cached
    await cached('k2', produce) // evicts k1
    await cached('k1', produce) // re-renders (was evicted)
    expect(produce).toHaveBeenCalledTimes(3)
  })
})

describe('article block image misses', () => {
  const post = articlePost(
    article([{ end: WINDOW.end, metric: 'heart_rate', start: WINDOW.start, type: 'chart' }]),
  )
  const appWith = (misses: ReturnType<typeof createNegativeCache>, points: () => [Date, number][]) => {
    const app = express()
    app.use(
      createFeedImageRouter({
        articleBlockMisses: misses,
        getActivity: async () => null,
        getArticleChartSeries: async () => points(),
        getArticleImpact: async () => impactData(),
        getCorrelationScatter: async () => null,
        getPost: async () => post,
        getRoute: async () => [],
        getSeries: async () => [],
        getExerciseTrend: async () => null,
        getChallengeRaceByUrl: async () => null,
        getStandingsChart: async () => null,
        rasterizeSvg: async () => Buffer.from('figure-png'),
        renderChart: async () => Buffer.from('chart-png'),
        renderChartSvg: () => '<svg>chart</svg>',
        renderImpact: async () => Buffer.from('impact-png'),
        renderImpactSvg: () => '<svg>impact</svg>',
        renderRaceChart: async () => Buffer.from(''),
        renderRaceChartSvg: () => '',
        renderRoute: async () => Buffer.from(''),
        renderScatter: async () => Buffer.from(''),
        renderScatterSvg: () => '',
      }),
    )
    return app
  }
  const path = `/public/fiddur/feed/${POST_ID}/blocks/0/image.png`

  test('a remembered 404 holds until the export forgets it once the block draws', async () => {
    const misses = createNegativeCache()
    let points: [Date, number][] = []
    const app = appWith(misses, () => points)

    expect((await supertest(app).get(path)).status).toBe(404)
    points = [
      [new Date('2026-07-01T06:00:00Z'), 60],
      [new Date('2026-07-01T07:00:00Z'), 62],
    ]
    expect((await supertest(app).get(path)).status).toBe(404)

    forgetArticleBlockMisses(misses, 'fiddur', POST_ID, 0)

    const res = await supertest(app).get(path)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/image\/png/)
  })
})

describe('article challenge block images', () => {
  const post = articlePost(article([{ challenge_url: 'https://qs.example/u/olle/nov', type: 'challenge' }]))
  const race: RaceChartSvgData = {
    asOf: new Date('2026-11-03T12:00:00Z'),
    endTime: new Date('2026-11-30T23:00:00Z'),
    lines: [
      {
        color: '#2b9ea7',
        name: 'olle',
        points: [
          [new Date('2026-10-31T23:00:00Z'), 0],
          [new Date('2026-11-01T23:00:00Z'), 900],
        ],
      },
    ],
    startTime: new Date('2026-10-31T23:00:00Z'),
    timezone: 'UTC',
    title: 'November steps',
  }
  const appWith = (data: RaceChartSvgData | null, target: FeedPostRecord = post) => {
    const getChallengeRaceByUrl = vi.fn(async () => data)
    const app = express()
    app.use(
      createFeedImageRouter({
        getActivity: async () => null,
        getArticleChartSeries: async () => [],
        getArticleImpact: async () => impactData(),
        getChallengeRaceByUrl,
        getCorrelationScatter: async () => null,
        getExerciseTrend: async () => null,
        getPost: async () => target,
        getRoute: async () => [],
        getSeries: async () => [],
        getStandingsChart: async () => null,
        rasterizeSvg: async () => Buffer.from('figure-png'),
        renderChart: async () => Buffer.from(''),
        renderChartSvg: () => '',
        renderImpact: async () => Buffer.from('impact-png'),
        renderImpactSvg: () => '<svg>impact</svg>',
        renderRaceChart: async () => Buffer.from('race-png'),
        renderRaceChartSvg: () => '<svg>race</svg>',
        renderRoute: async () => Buffer.from(''),
        renderScatter: async () => Buffer.from(''),
        renderScatterSvg: () => '',
      }),
    )
    return { app, getChallengeRaceByUrl }
  }
  const png = `/public/fiddur/feed/${POST_ID}/blocks/0/image.png`

  test('serves the standings race of the linked challenge', async () => {
    const { app, getChallengeRaceByUrl } = appWith(race)
    const res = await supertest(app).get(png)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/image\/png/)
    expect(getChallengeRaceByUrl).toHaveBeenCalledWith('fiddur', 'https://qs.example/u/olle/nov')
    const svg = await supertest(app).get(`/public/fiddur/feed/${POST_ID}/blocks/0/image.svg`)
    expect(svg.status).toBe(200)
    expect(svg.headers['content-type']).toMatch(/image\/svg\+xml/)
  })

  test('404 when the challenge has no standings', async () => {
    expect((await supertest(appWith(null).app).get(png)).status).toBe(404)
  })

  test('a followers-only article needs its token', async () => {
    const { app } = appWith(race, { ...post, visibility: 'followers' })
    expect((await supertest(app).get(png)).status).toBe(404)
    expect((await supertest(app).get(`${png}?token=secret-token`)).status).toBe(200)
  })
})

describe('standings images', () => {
  const challengePost = (over: Partial<FeedPostRecord> = {}) =>
    makePost({
      activity_id: null,
      challenge: { name: 'November steps', url: 'https://aurboda.example/u/fiddur/nov' },
      include_map: false,
      kind: 'challenge',
      ...over,
    })
  const chart: RaceChartSvgData = {
    asOf: new Date('2026-11-03T12:00:00Z'),
    endTime: new Date('2026-11-30T23:00:00Z'),
    lines: [
      {
        color: '#8b5cf6',
        name: 'freja',
        points: [
          [new Date('2026-10-31T23:00:00Z'), 0],
          [new Date('2026-11-01T23:00:00Z'), 1200],
        ],
      },
    ],
    startTime: new Date('2026-10-31T23:00:00Z'),
    timezone: 'Europe/Stockholm',
    title: 'November steps',
  }
  const appWith = (post: FeedPostRecord, data: RaceChartSvgData | null = chart) => {
    const getStandingsChart = vi.fn(async () => data)
    const renderRaceChart = vi.fn(async () => Buffer.from('race-png'))
    const app = express()
    app.use(
      createFeedImageRouter({
        getActivity: async () => null,
        getArticleChartSeries: async () => [],
        getArticleImpact: async () => impactData(),
        getCorrelationScatter: async () => null,
        getPost: async () => post,
        getRoute: async () => [],
        getSeries: async () => [],
        getExerciseTrend: async () => null,
        getChallengeRaceByUrl: async () => null,
        getStandingsChart,
        rasterizeSvg: async () => Buffer.from('figure-png'),
        renderChart: async () => Buffer.from(''),
        renderChartSvg: () => '',
        renderImpact: async () => Buffer.from('impact-png'),
        renderImpactSvg: () => '<svg>impact</svg>',
        renderRaceChart,
        renderRaceChartSvg: () => '<svg>race</svg>',
        renderRoute: async () => Buffer.from(''),
        renderScatter: async () => Buffer.from(''),
        renderScatterSvg: () => '',
      }),
    )
    return { app, getStandingsChart, renderRaceChart }
  }
  const png = `/public/fiddur/feed/${POST_ID}/standings.png`

  test('resolveStandingsPost gates on kind, opt-in and capability token', async () => {
    const get = (post: FeedPostRecord | null) => ({ getPost: async () => post })
    expect(await resolveStandingsPost(get(challengePost()), 'fiddur', POST_ID)).not.toBeNull()
    expect(await resolveStandingsPost(get(makePost()), 'fiddur', POST_ID)).toBeNull()
    expect(
      await resolveStandingsPost(get(challengePost({ include_chart: false })), 'fiddur', POST_ID),
    ).toBeNull()
    const followers = challengePost({ visibility: 'followers' })
    expect(await resolveStandingsPost(get(followers), 'fiddur', POST_ID)).toBeNull()
    expect(await resolveStandingsPost(get(followers), 'fiddur', POST_ID, 'secret-token')).not.toBeNull()
    expect(await resolveStandingsPost(get(challengePost()), 'fiddur', 'not-a-uuid')).toBeNull()
  })

  test('404 for a non-challenge post', async () => {
    expect((await supertest(appWith(makePost()).app).get(png)).status).toBe(404)
  })

  test('404 when the post did not opt into the chart', async () => {
    const { app, getStandingsChart } = appWith(challengePost({ include_chart: false }))
    expect((await supertest(app).get(png)).status).toBe(404)
    expect(getStandingsChart).not.toHaveBeenCalled()
  })

  test('a followers-only post needs its token', async () => {
    const { app } = appWith(challengePost({ visibility: 'followers' }))
    expect((await supertest(app).get(png)).status).toBe(404)
    const res = await supertest(app).get(`${png}?token=secret-token`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/image\/png/)
    expect(res.headers['cache-control']).toBe('no-store')
  })

  test('404 without standings or without a drawable line', async () => {
    expect((await supertest(appWith(challengePost(), null).app).get(png)).status).toBe(404)
    expect((await supertest(appWith(challengePost(), { ...chart, lines: [] }).app).get(png)).status).toBe(404)
  })

  test('renders once and serves the cached PNG on the second call', async () => {
    const { app, getStandingsChart, renderRaceChart } = appWith(challengePost())
    const first = await supertest(app).get(png)
    expect(first.status).toBe(200)
    expect(first.body).toEqual(Buffer.from('race-png'))
    expect((await supertest(app).get(png)).status).toBe(200)
    expect(getStandingsChart).toHaveBeenCalledTimes(1)
    expect(renderRaceChart).toHaveBeenCalledTimes(1)
  })

  test('serves the SVG', async () => {
    const res = await supertest(appWith(challengePost()).app).get(
      `/public/fiddur/feed/${POST_ID}/standings.svg`,
    )
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/image\/svg\+xml/)
  })

  test('the cache key moves with the post version and every five minutes', () => {
    const updated = new Date('2026-11-04T08:00:00Z')
    const t = Date.parse('2026-11-04T12:00:00Z')
    const key = standingsCacheKey('standingspng', 'fiddur', POST_ID, updated, t)
    expect(standingsCacheKey('standingspng', 'fiddur', POST_ID, updated, t + 299_999)).toBe(key)
    expect(standingsCacheKey('standingspng', 'fiddur', POST_ID, updated, t + 300_000)).not.toBe(key)
    expect(standingsCacheKey('standingspng', 'fiddur', POST_ID, new Date(updated.getTime() + 1), t)).not.toBe(
      key,
    )
  })
})

describe('exercise trend images (#1398)', () => {
  const exercisePost = (over: Partial<FeedPostRecord> = {}) =>
    makePost({
      activity_id: null,
      exercise: {
        activity_type: 'strength_training',
        field: 'sets.exercise',
        include_records: true,
        include_sessions: false,
        name: 'Bench Press',
        value: 'Bench Press',
      },
      include_map: false,
      kind: 'exercise',
      ...over,
    })
  const trend: ExerciseTrendSeries = {
    measure: 'e1rm',
    series: [
      [new Date('2026-10-01'), 77],
      [new Date('2026-10-07'), 82],
    ],
  }
  const appWith = (post: FeedPostRecord, data: ExerciseTrendSeries | null = trend) => {
    const getExerciseTrend = vi.fn(async () => data)
    const renderChart = vi.fn(async () => Buffer.from('trend-png'))
    const renderChartSvg = vi.fn(() => '<svg>trend</svg>')
    const app = express()
    app.use(
      createFeedImageRouter({
        getActivity: async () => null,
        getArticleChartSeries: async () => [],
        getArticleImpact: async () => impactData(),
        getCorrelationScatter: async () => null,
        getExerciseTrend,
        getPost: async () => post,
        getRoute: async () => [],
        getSeries: async () => [],
        getChallengeRaceByUrl: async () => null,
        getStandingsChart: async () => null,
        rasterizeSvg: async () => Buffer.from('figure-png'),
        renderChart,
        renderChartSvg,
        renderImpact: async () => Buffer.from('impact-png'),
        renderImpactSvg: () => '<svg>impact</svg>',
        renderRaceChart: async () => Buffer.from(''),
        renderRaceChartSvg: () => '',
        renderRoute: async () => Buffer.from(''),
        renderScatter: async () => Buffer.from(''),
        renderScatterSvg: () => '',
      }),
    )
    return { app, getExerciseTrend, renderChart, renderChartSvg }
  }
  const png = `/public/fiddur/feed/${POST_ID}/trend.png`

  test('resolveExercisePost gates on kind, opt-in and capability token', async () => {
    const get = (post: FeedPostRecord | null) => ({ getPost: async () => post })
    expect(await resolveExercisePost(get(exercisePost()), 'fiddur', POST_ID)).not.toBeNull()
    expect(await resolveExercisePost(get(makePost()), 'fiddur', POST_ID)).toBeNull()
    expect(
      await resolveExercisePost(get(exercisePost({ include_chart: false })), 'fiddur', POST_ID),
    ).toBeNull()
    const followers = exercisePost({ visibility: 'followers' })
    expect(await resolveExercisePost(get(followers), 'fiddur', POST_ID)).toBeNull()
    expect(await resolveExercisePost(get(followers), 'fiddur', POST_ID, 'secret-token')).not.toBeNull()
    expect(await resolveExercisePost(get(null), 'fiddur', POST_ID)).toBeNull()
  })

  test('404 for a non-exercise post or without the opt-in', async () => {
    expect((await supertest(appWith(makePost()).app).get(png)).status).toBe(404)
    const { app, getExerciseTrend } = appWith(exercisePost({ include_chart: false }))
    expect((await supertest(app).get(png)).status).toBe(404)
    expect(getExerciseTrend).not.toHaveBeenCalled()
  })

  test('a followers-only post needs its token', async () => {
    const { app } = appWith(exercisePost({ visibility: 'followers' }))
    expect((await supertest(app).get(png)).status).toBe(404)
    const res = await supertest(app).get(`${png}?token=secret-token`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/image\/png/)
    expect(res.headers['cache-control']).toBe('no-store')
  })

  test('404 without a drawable trend', async () => {
    expect((await supertest(appWith(exercisePost(), null).app).get(png)).status).toBe(404)
    const single: ExerciseTrendSeries = { ...trend, series: trend.series.slice(0, 1) }
    expect((await supertest(appWith(exercisePost(), single).app).get(png)).status).toBe(404)
  })

  test('renders the labelled line once and serves the cached PNG on the second call', async () => {
    const { app, getExerciseTrend, renderChart } = appWith(exercisePost())
    const first = await supertest(app).get(png)
    expect(first.status).toBe(200)
    expect(first.body).toEqual(Buffer.from('trend-png'))
    expect((await supertest(app).get(png)).status).toBe(200)
    expect(getExerciseTrend).toHaveBeenCalledTimes(1)
    expect(renderChart).toHaveBeenCalledExactlyOnceWith(trend.series, {
      color: '#2b9ea7',
      label: 'Best e1RM · Bench Press',
    })
  })

  test('serves the SVG', async () => {
    const { app, renderChartSvg } = appWith(exercisePost())
    const res = await supertest(app).get(`/public/fiddur/feed/${POST_ID}/trend.svg`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/image\/svg\+xml/)
    expect(renderChartSvg).toHaveBeenCalledTimes(1)
  })

  test('the cache key moves with the post version and every hour', () => {
    const updated = new Date('2026-11-04T08:00:00Z')
    const t = Date.parse('2026-11-04T12:00:00Z')
    const key = trendCacheKey('trendpng', 'fiddur', POST_ID, updated, t)
    expect(trendCacheKey('trendpng', 'fiddur', POST_ID, updated, t + 3_599_999)).toBe(key)
    expect(trendCacheKey('trendpng', 'fiddur', POST_ID, updated, t + 3_600_000)).not.toBe(key)
    expect(trendCacheKey('trendpng', 'fiddur', POST_ID, new Date(updated.getTime() + 1), t)).not.toBe(key)
  })
})

describe('article block figure images', () => {
  const chartSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="420" viewBox="0 0 1000 420"></svg>'
  const points: [Date, number][] = [
    [new Date('2026-07-01T06:00:00Z'), 60],
    [new Date('2026-07-01T07:00:00Z'), 62],
  ]
  const content = article([
    { markdown: 'Intro', type: 'prose' },
    { caption: 'Overnight HR', end: WINDOW.end, metric: 'heart_rate', start: WINDOW.start, type: 'chart' },
  ])
  const appWith = (target: FeedPostRecord, series: [Date, number][] = points) => {
    const rasterizeSvg = vi.fn(async (_svg: string) => Buffer.from('figure-png'))
    const renderChart = vi.fn(async () => Buffer.from('chart-png'))
    const app = express()
    app.use(
      createFeedImageRouter({
        getActivity: async () => null,
        getArticleChartSeries: async () => series,
        getArticleImpact: async () => impactData(),
        getChallengeRaceByUrl: async () => null,
        getCorrelationScatter: async () => null,
        getExerciseTrend: async () => null,
        getPost: async () => target,
        getRoute: async () => [],
        getSeries: async () => [],
        getStandingsChart: async () => null,
        rasterizeSvg,
        renderChart,
        renderChartSvg: () => chartSvg,
        renderImpact: async () => Buffer.from('impact-png'),
        renderImpactSvg: () => '<svg>impact</svg>',
        renderRaceChart: async () => Buffer.from(''),
        renderRaceChartSvg: () => '',
        renderRoute: async () => Buffer.from(''),
        renderScatter: async () => Buffer.from(''),
        renderScatterSvg: () => '',
      }),
    )
    return { app, rasterizeSvg, renderChart }
  }
  const figure = (index: number) => `/public/fiddur/feed/${POST_ID}/blocks/${index}/figure.png`

  test('serves the chart under its figure title, numbered like the Note', async () => {
    const { app, rasterizeSvg } = appWith(articlePost(content))
    const res = await supertest(app).get(figure(1))
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/image\/png/)
    expect(res.headers['cache-control']).toBe('no-store')
    const svg = rasterizeSvg.mock.calls[0][0]
    expect(svg).toContain('Figure 1')
    expect(svg).toContain('Overnight HR')
    expect(svg).toContain('<svg x="0" y="88"')
  })

  test('404 for a sparse block, a prose index, or a followers-only article without its token', async () => {
    expect((await supertest(appWith(articlePost(content), []).app).get(figure(1))).status).toBe(404)
    expect((await supertest(appWith(articlePost(content)).app).get(figure(0))).status).toBe(404)
    const { app } = appWith(articlePost(content, { visibility: 'followers' }))
    expect((await supertest(app).get(figure(1))).status).toBe(404)
    expect((await supertest(app).get(`${figure(1)}?token=secret-token`)).status).toBe(200)
  })

  test('caches separately from image.png', async () => {
    const { app, rasterizeSvg, renderChart } = appWith(articlePost(content))
    await supertest(app).get(`/public/fiddur/feed/${POST_ID}/blocks/1/image.png`)
    await supertest(app).get(figure(1))
    await supertest(app).get(figure(1))
    expect(renderChart).toHaveBeenCalledTimes(1)
    expect(rasterizeSvg).toHaveBeenCalledTimes(1)
  })

  test("forgetting a block's misses covers its figure", async () => {
    const misses = createNegativeCache()
    misses.add(`blockfig:fiddur:${POST_ID}:1:0:0`)
    forgetArticleBlockMisses(misses, 'fiddur', POST_ID, 1)
    expect(misses.has(`blockfig:fiddur:${POST_ID}:1:0:0`)).toBe(false)
  })
})

describe('article impact block images', () => {
  const content = article([
    { markdown: 'Intro', type: 'prose' },
    { ...WINDOW, activity: 'yoga', activity_type: 'activity_type', type: 'impact', window_minutes: 60 },
  ])
  const appWith = (sessions = 3) => {
    const getArticleImpact = vi.fn(async () => impactData({ occurrences: sessions }))
    const renderImpact = vi.fn(async () => Buffer.from('impact-png'))
    const rasterizeSvg = vi.fn(async (_svg: string) => Buffer.from('figure-png'))
    const app = express()
    app.use(
      createFeedImageRouter({
        getActivity: async () => null,
        getArticleChartSeries: async () => [],
        getArticleImpact,
        getChallengeRaceByUrl: async () => null,
        getCorrelationScatter: async () => null,
        getExerciseTrend: async () => null,
        getPost: async () => articlePost(content),
        getRoute: async () => [],
        getSeries: async () => [],
        getStandingsChart: async () => null,
        rasterizeSvg,
        renderChart: async () => Buffer.from(''),
        renderChartSvg: () => '',
        renderImpact,
        renderImpactSvg: () =>
          '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="560" viewBox="0 0 1000 560"></svg>',
        renderRaceChart: async () => Buffer.from(''),
        renderRaceChartSvg: () => '',
        renderRoute: async () => Buffer.from(''),
        renderScatter: async () => Buffer.from(''),
        renderScatterSvg: () => '',
      }),
    )
    return { app, getArticleImpact, rasterizeSvg, renderImpact }
  }
  const block = (file: string) => `/public/fiddur/feed/${POST_ID}/blocks/1/${file}`

  test('serves image.png from the impact over the block window', async () => {
    const { app, getArticleImpact, renderImpact } = appWith()
    const res = await supertest(app).get(block('image.png'))
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/image\/png/)
    expect(renderImpact).toHaveBeenCalledWith(impactData())
    expect(getArticleImpact).toHaveBeenCalledWith('fiddur', {
      activity: 'yoga',
      activityType: 'activity_type',
      end: new Date(WINDOW.end),
      start: new Date(WINDOW.start),
      windowMinutes: 60,
    })
  })

  test('serves image.svg', async () => {
    const res = await supertest(appWith().app).get(block('image.svg'))
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/image\/svg\+xml/)
    expect(res.body.toString()).toContain('height="560"')
  })

  test('serves figure.png at the impact size under its title band', async () => {
    const { app, rasterizeSvg } = appWith()
    expect((await supertest(app).get(block('figure.png'))).status).toBe(200)
    const svg = rasterizeSvg.mock.calls[0][0]
    expect(svg).toContain('Figure 1')
    expect(svg).toContain('Impact of yoga')
    expect(svg).toContain('height="648"')
  })

  test('404 when the window has no sessions', async () => {
    const { app } = appWith(0)
    expect((await supertest(app).get(block('image.png'))).status).toBe(404)
    expect((await supertest(app).get(block('figure.png'))).status).toBe(404)
  })
})
