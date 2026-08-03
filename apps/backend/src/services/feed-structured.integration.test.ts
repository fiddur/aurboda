import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

/**
 * Integration test for the structured-post resolver served at
 * `GET /public/:user/feed/:postId` — the payload an Aurboda peer fetches to
 * render a native chart or article. Exercises the real scalar + series
 * resolution (activity posts) and the real bucketed-chart + continuous-
 * correlation resolution (article posts), plus the shared public/unlisted gate,
 * against a live database.
 */
import { insertActivity } from '../db/activities/index.ts'
import { createArticlePost, createFeedPost } from '../db/feed.ts'
import { insertTimeSeries } from '../db/time-series.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { resolveStructuredPost } from './feed-structured.ts'

const CONTAINER_TIMEOUT = 120_000
const START = new Date('2026-07-01T08:00:00Z')
const END = new Date('2026-07-01T08:40:00Z')

const seedActivityWithHeartRate = async (user: string): Promise<string> => {
  const activityId = await insertActivity(user, {
    activity_type: 'exercise',
    end_time: END,
    source: 'garmin',
    start_time: START,
    title: 'Morning run',
  })
  // Dense heart-rate samples across the window (5s cadence, 150 bpm) so both the
  // scalar summary and the series resolve.
  await insertTimeSeries(
    user,
    Array.from({ length: 120 }, (_, i) => ({
      metric: 'heart_rate' as const,
      source: 'garmin' as const,
      time: new Date(START.getTime() + i * 5_000),
      value: 150,
    })),
  )
  return activityId
}

describe('resolveStructuredPost', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('assembles typed metrics + inline series for a public post', async () => {
    const user = getTestUser()
    const activityId = await seedActivityWithHeartRate(user)
    const post = await createFeedPost(user, {
      activity_id: activityId,
      include_chart: false,
      include_map: false,
      included_metrics: ['heart_rate_avg', 'duration'],
      series_metrics: ['heart_rate'],
      visibility: 'public',
    })

    const structured = await resolveStructuredPost(user, post.id)
    expect(structured).not.toBeNull()
    if (structured?.kind !== 'activity') throw new Error('expected an activity payload')
    expect(structured.activity_type).toBe('exercise')
    expect(structured.start_time).toBe(START.toISOString())
    expect(structured.end_time).toBe(END.toISOString())
    expect(structured.duration_seconds).toBe(2400)

    const byKey = Object.fromEntries(structured.metrics.map((m) => [m.key, m.value]))
    expect(byKey.heart_rate_avg).toBe(150)
    expect(byKey.duration).toBe(2400)

    // The opted-in series is inlined with non-empty samples at the floored bucket.
    expect(structured.series).toHaveLength(1)
    const hr = structured.series[0]
    expect(hr?.metric).toBe('heart_rate')
    expect(hr?.bucket).toBe('5s')
    expect(hr?.samples.length).toBeGreaterThan(0)
    expect(hr?.samples[0].avg).toBe(150)
  })

  test('omits series the post did not opt into', async () => {
    const user = getTestUser()
    const activityId = await seedActivityWithHeartRate(user)
    const post = await createFeedPost(user, {
      activity_id: activityId,
      include_chart: false,
      include_map: false,
      included_metrics: ['heart_rate_avg'],
      series_metrics: [], // no series shared
      visibility: 'public',
    })
    const structured = await resolveStructuredPost(user, post.id)
    if (structured?.kind !== 'activity') throw new Error('expected an activity payload')
    expect(structured.metrics.map((m) => m.key)).toEqual(['heart_rate_avg'])
    expect(structured.series).toEqual([])
  })

  test('gates a followers-only post on the capability token', async () => {
    const user = getTestUser()
    const activityId = await seedActivityWithHeartRate(user)
    const post = await createFeedPost(user, {
      activity_id: activityId,
      include_chart: false,
      include_map: false,
      included_metrics: ['heart_rate_avg'],
      series_metrics: ['heart_rate'],
      visibility: 'followers',
    })
    // No token / wrong token → not authorized.
    expect(await resolveStructuredPost(user, post.id)).toBeNull()
    expect(await resolveStructuredPost(user, post.id, 'wrong')).toBeNull()
    // The post's own capability token (delivered to followers) → resolves.
    const structured = await resolveStructuredPost(user, post.id, post.image_token)
    if (structured?.kind !== 'activity') throw new Error('expected an activity payload')
    expect(structured.series.map((s) => s.metric)).toEqual(['heart_rate'])
    expect(structured.metrics.map((m) => m.key)).toEqual(['heart_rate_avg'])
  })

  test('returns null for an unknown post id', async () => {
    const user = getTestUser()
    expect(await resolveStructuredPost(user, '00000000-0000-4000-8000-000000000000')).toBeNull()
  })
})

describe('resolveStructuredPost — article posts', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('resolves prose verbatim and a chart block’s bucketed samples over its window', async () => {
    const user = getTestUser()
    // Dense heart-rate samples across the window (5-minute cadence, 150 bpm) so
    // the default `1h` bucket (a ≤2-day window) has real data to aggregate.
    await insertTimeSeries(
      user,
      Array.from({ length: 8 }, (_, i) => ({
        metric: 'heart_rate' as const,
        source: 'garmin' as const,
        time: new Date(START.getTime() + i * 5 * 60_000),
        value: 150,
      })),
    )
    const post = await createArticlePost(user, {
      article: {
        blocks: [
          { markdown: 'Slept **well**.', type: 'prose' },
          { end: END.toISOString(), metric: 'heart_rate', start: START.toISOString(), type: 'chart' },
        ],
        title: 'My analysis',
      },
      visibility: 'public',
    })

    const structured = await resolveStructuredPost(user, post.id)
    expect(structured?.kind).toBe('article')
    if (structured?.kind !== 'article') throw new Error('expected an article payload')
    expect(structured.title).toBe('My analysis')
    expect(structured.blocks).toEqual([
      { markdown: 'Slept **well**.', type: 'prose' },
      expect.objectContaining({ metric: 'heart_rate', type: 'chart' }),
    ])
    const chart = structured.blocks[1]
    if (chart.type !== 'chart') throw new Error('expected a chart block')
    expect(chart.bucket).toBe('1h')
    expect(chart.samples.length).toBeGreaterThan(0)
    expect(chart.samples[0].avg).toBe(150)
  })

  test('keeps a `1d` chart bucket as authored (not rewritten)', async () => {
    const user = getTestUser()
    await insertTimeSeries(
      user,
      Array.from({ length: 8 }, (_, i) => ({
        metric: 'heart_rate' as const,
        source: 'garmin' as const,
        time: new Date(START.getTime() + i * 5 * 60_000),
        value: 150,
      })),
    )
    const post = await createArticlePost(user, {
      article: {
        blocks: [
          {
            bucket: '1d',
            end: END.toISOString(),
            metric: 'heart_rate',
            start: START.toISOString(),
            type: 'chart',
          },
        ],
        title: 'Daily',
      },
      visibility: 'public',
    })
    const structured = await resolveStructuredPost(user, post.id)
    if (structured?.kind !== 'article') throw new Error('expected an article payload')
    const chart = structured.blocks[0]
    if (chart.type !== 'chart') throw new Error('expected a chart block')
    // `1d` is passed through — NOT rewritten (a broken floor turned it into `5s`).
    expect(chart.bucket).toBe('1d')
    expect(chart.samples.length).toBeGreaterThan(0)
    expect(chart.samples[0].avg).toBe(150)
  })

  test('floors a sub-5s chart bucket on this unauthenticated endpoint', async () => {
    const user = getTestUser()
    await insertTimeSeries(user, [
      { metric: 'heart_rate' as const, source: 'garmin' as const, time: START, value: 150 },
    ])
    const post = await createArticlePost(user, {
      article: {
        blocks: [
          {
            bucket: '1s',
            end: END.toISOString(),
            metric: 'heart_rate',
            start: START.toISOString(),
            type: 'chart',
          },
        ],
        title: 'Dense',
      },
      visibility: 'public',
    })
    const structured = await resolveStructuredPost(user, post.id)
    if (structured?.kind !== 'article') throw new Error('expected an article payload')
    const chart = structured.blocks[0]
    if (chart.type !== 'chart') throw new Error('expected a chart block')
    // `1s` is floored to the 5s public-series minimum (not queried at 1s).
    expect(chart.bucket).toBe('5s')
  })

  test('resolves a correlation block (present unconditionally, even with no overlapping data)', async () => {
    const user = getTestUser()
    const post = await createArticlePost(user, {
      article: {
        blocks: [
          {
            end: END.toISOString(),
            outcome: { kind: 'metric', metric: 'sleep_score' },
            start: START.toISOString(),
            trigger: { kind: 'metric', metric: 'steps' },
            type: 'correlation',
          },
        ],
        title: 'Steps vs sleep',
      },
      visibility: 'public',
    })

    const structured = await resolveStructuredPost(user, post.id)
    if (structured?.kind !== 'article') throw new Error('expected an article payload')
    expect(structured.blocks).toHaveLength(1)
    const block = structured.blocks[0]
    if (block.type !== 'correlation') throw new Error('expected a correlation block')
    // No data seeded for either dimension — n is 0, not an error, so the block
    // still resolves (unlike the block-image endpoint, which would 404 below n < 3).
    expect(block.n).toBe(0)
    expect(block.series).toEqual([])
    expect(block.trigger).toEqual({ kind: 'metric', metric: 'steps' })
    expect(block.outcome).toEqual({ kind: 'metric', metric: 'sleep_score' })
  })

  test('gates a followers-only article on the capability token', async () => {
    const user = getTestUser()
    const post = await createArticlePost(user, {
      article: { blocks: [{ markdown: 'Private thoughts', type: 'prose' }], title: 'Private' },
      visibility: 'followers',
    })
    expect(await resolveStructuredPost(user, post.id)).toBeNull()
    expect(await resolveStructuredPost(user, post.id, 'wrong')).toBeNull()
    const structured = await resolveStructuredPost(user, post.id, post.image_token)
    expect(structured?.kind).toBe('article')
  })

  test('omits a chart/correlation block whose window is invalid (start on or after end)', async () => {
    const user = getTestUser()
    const post = await createArticlePost(user, {
      article: {
        blocks: [
          { markdown: 'Intro', type: 'prose' },
          { end: START.toISOString(), metric: 'heart_rate', start: END.toISOString(), type: 'chart' },
        ],
        title: 'Broken window',
      },
      visibility: 'public',
    })
    const structured = await resolveStructuredPost(user, post.id)
    if (structured?.kind !== 'article') throw new Error('expected an article payload')
    expect(structured.blocks).toEqual([{ markdown: 'Intro', type: 'prose' }])
  })
})
