import { feedStructuredPostSchema } from '@aurboda/api-spec'
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
import { createChallenge, upsertChallengeMember } from '../db/challenges.ts'
import { createArticlePost, createChallengePost, createFeedPost } from '../db/feed.ts'
import { insertTimeSeries } from '../db/time-series.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { configureStructuredChallenge } from './feed-structured-challenge.ts'
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
      message: 'Lovely morning!',
      series_metrics: ['heart_rate'],
      visibility: 'public',
    })

    const structured = await resolveStructuredPost(user, post.id)
    expect(structured).not.toBeNull()
    if (structured?.kind !== 'activity') throw new Error('expected an activity payload')
    expect(structured.activityType).toBe('exercise')
    // The author's personal message rides the structured payload.
    expect(structured.message).toBe('Lovely morning!')
    expect(structured.startTime).toBe(START.toISOString())
    expect(structured.endTime).toBe(END.toISOString())
    expect(structured).not.toHaveProperty('durationSeconds')

    const byKey = Object.fromEntries(structured.metrics.map((m) => [m.key, m.value]))
    expect(byKey.heartRateAvg).toBe(150)
    expect(byKey.duration).toBe(2400)

    // The opted-in series is inlined with non-empty samples at the floored bucket.
    expect(structured.series).toHaveLength(1)
    const hr = structured.series[0]
    expect(hr?.metric).toBe('heartRate')
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
    expect(structured.metrics.map((m) => m.key)).toEqual(['heartRateAvg'])
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
    expect(structured.series.map((s) => s.metric)).toEqual(['heartRate'])
    expect(structured.metrics.map((m) => m.key)).toEqual(['heartRateAvg'])
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

  test('resolves an impact block to its sessions, timeline and effects over its window', async () => {
    const user = getTestUser()
    const sessionStart = new Date('2026-07-01T10:00:00Z')
    await insertActivity(user, {
      activity_type: 'yoga',
      end_time: new Date(sessionStart.getTime() + 30 * 60_000),
      source: 'manual',
      start_time: sessionStart,
    })
    await insertTimeSeries(
      user,
      Array.from({ length: 18 }, (_, i) => i * 5 - 30).flatMap((offset) => {
        const time = new Date(sessionStart.getTime() + offset * 60_000)
        return [
          { metric: 'hrv_rmssd' as const, source: 'garmin' as const, time, value: 50 + offset / 10 },
          { metric: 'heart_rate' as const, source: 'garmin' as const, time, value: 70 - offset / 10 },
          { metric: 'stress_level' as const, source: 'garmin' as const, time, value: 30 },
        ]
      }),
    )
    const post = await createArticlePost(user, {
      article: {
        blocks: [
          {
            activity: 'yoga',
            activity_type: 'activity_type',
            caption: 'Morning yoga',
            end: '2026-07-02T00:00:00.000Z',
            start: '2026-07-01T00:00:00.000Z',
            type: 'impact',
          },
          { activity: 'yoga', activity_type: 'activity_type', type: 'impact' },
        ],
        title: 'Yoga',
      },
      visibility: 'public',
    })

    const structured = await resolveStructuredPost(user, post.id)
    if (structured?.kind !== 'article') throw new Error('expected an article payload')
    expect(feedStructuredPostSchema.safeParse(structured).success).toBe(true)
    expect(structured.blocks).toHaveLength(1)
    const block = structured.blocks[0]
    if (block.type !== 'impact') throw new Error('expected an impact block')
    expect(block).toMatchObject({
      activity: 'yoga',
      activity_type: 'activity_type',
      caption: 'Morning yoga',
      end: '2026-07-02T00:00:00.000Z',
      occurrences: 1,
      start: '2026-07-01T00:00:00.000Z',
      window_minutes: 30,
    })
    expect(block.avg_duration_min).toBe(30)
    expect(block.timeline.find((b) => b.phase === 'during')?.hrv.mean).not.toBeNull()
    expect(block.timeline.filter((b) => b.hr.mean != null).length).toBeGreaterThanOrEqual(2)
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

  test('a prose block declares the pictures its markdown embeds', async () => {
    const user = getTestUser()
    const url = `https://example.org/api/public/${user}/images/0b8a4c5e-2f1d-4a8e-9c3b-6d7e8f9a0b1c.webp`
    const post = await createArticlePost(user, {
      article: {
        blocks: [
          { markdown: `Before\n\n![My mat](${url})\n\nAfter`, type: 'prose' },
          { markdown: 'Yoga without a picture', type: 'prose' },
        ],
        title: 'Yoga',
      },
      visibility: 'public',
    })
    const structured = await resolveStructuredPost(user, post.id)
    if (structured?.kind !== 'article') throw new Error('expected an article payload')
    expect(feedStructuredPostSchema.parse(structured)).toEqual(structured)
    expect(structured.blocks[0]).toEqual({
      images: [{ alt: 'My mat', url }],
      markdown: `Before\n\n![My mat](${url})\n\nAfter`,
      type: 'prose',
    })
    expect(structured.blocks[1]).not.toHaveProperty('images')
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

describe('resolveStructuredPost — challenge posts', () => {
  beforeAll(async () => {
    await startTestDb()
    configureStructuredChallenge({ apiBaseUrl: 'https://qs.example/api', webHost: 'https://qs.example' })
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test("resolves an own challenge share to its document and the local member's standings", async () => {
    const user = getTestUser()
    await insertTimeSeries(user, [
      { metric: 'resting_heart_rate', source: 'manual', time: new Date('2026-06-01T08:00:00Z'), value: 50 },
      { metric: 'resting_heart_rate', source: 'manual', time: new Date('2026-06-02T08:00:00Z'), value: 60 },
    ])
    const challenge = await createChallenge(user, {
      announce_winner: true,
      end_ts: new Date('2026-06-03T00:00:00Z'),
      is_public: true,
      name: 'June RHR',
      spec: {
        activity_type_id: null,
        aggregation: 'sum',
        bucket_size: '1d',
        filter_field: null,
        filter_value: null,
        measure: null,
        pattern: 'resting_heart_rate',
        source_type: 'metric',
        unit: 'bpm',
      },
      start_ts: new Date('2026-06-01T00:00:00Z'),
      timezone: 'UTC',
    })
    await upsertChallengeMember(user, challenge.id, {
      display_name: user,
      identity_base_url: `https://qs.example/u/${user}`,
      kind: 'local',
      local_user: user,
    })
    const post = await createChallengePost(user, {
      challenge: { name: 'June RHR', url: `https://qs.example/u/${user}/${challenge.slug}` },
      message: 'Come along',
      visibility: 'public',
    })

    const structured = await resolveStructuredPost(user, post.id)
    if (structured?.kind !== 'challenge') throw new Error('expected a challenge payload')
    expect(structured.message).toBe('Come along')
    expect(structured.challenge.name).toBe('June RHR')
    expect(structured.challenge.url).toBe(`https://qs.example/u/${user}/${challenge.slug}`)
    expect(structured.standings?.members).toHaveLength(1)
    expect(structured.standings?.members[0].total).toBe(110)
  })

  test('a challenge share whose challenge is gone resolves to null', async () => {
    const user = getTestUser()
    const post = await createChallengePost(user, {
      challenge: { name: 'Gone', url: `https://qs.example/u/${user}/nope` },
      visibility: 'public',
    })
    expect(await resolveStructuredPost(user, post.id)).toBeNull()
  })

  test("an article's challenge block resolves to the challenge and its standings", async () => {
    const user = getTestUser()
    const challenge = await createChallenge(user, {
      announce_winner: true,
      end_ts: new Date('2026-06-03T00:00:00Z'),
      is_public: true,
      name: 'June RHR',
      spec: {
        activity_type_id: null,
        aggregation: 'sum',
        bucket_size: '1d',
        filter_field: null,
        filter_value: null,
        measure: null,
        pattern: 'resting_heart_rate',
        source_type: 'metric',
        unit: 'bpm',
      },
      start_ts: new Date('2026-06-01T00:00:00Z'),
      timezone: 'UTC',
    })
    const url = `https://qs.example/u/${user}/${challenge.slug}`
    const post = await createArticlePost(user, {
      article: {
        blocks: [{ caption: 'Join me', challenge_url: url, type: 'challenge' }],
        title: 'Signup open',
      },
      visibility: 'public',
    })

    const structured = await resolveStructuredPost(user, post.id)
    if (structured?.kind !== 'article') throw new Error('expected an article payload')
    expect(structured.blocks).toHaveLength(1)
    expect(structured.blocks[0]).toMatchObject({ caption: 'Join me', type: 'challenge', url })
    const block = structured.blocks[0]
    if (block.type !== 'challenge') throw new Error('expected a challenge block')
    expect(block.challenge?.name).toBe('June RHR')
    expect(block.standings?.kind).toBe('standings')
  })

  test("an article's unresolvable challenge block keeps only its URL and caption", async () => {
    const user = getTestUser()
    const url = `https://qs.example/u/${user}/gone`
    const post = await createArticlePost(user, {
      article: {
        blocks: [{ caption: 'Join me', challenge_url: url, type: 'challenge' }],
        title: 'Signup open',
      },
      visibility: 'public',
    })

    const structured = await resolveStructuredPost(user, post.id)
    if (structured?.kind !== 'article') throw new Error('expected an article payload')
    expect(structured.blocks).toEqual([{ caption: 'Join me', type: 'challenge', url }])
  })
})
