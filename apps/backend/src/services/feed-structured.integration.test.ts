import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

/**
 * Integration test for the structured-post resolver served at
 * `GET /public/:user/feed/:postId` — the payload an Aurboda peer fetches to
 * render a native chart. Exercises the real scalar + series resolution and the
 * public/unlisted gate against a live database.
 */
import { insertActivity } from '../db/activities/index.ts'
import { createFeedPost } from '../db/feed.ts'
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
    expect(structured?.activity_type).toBe('exercise')
    expect(structured?.start_time).toBe(START.toISOString())
    expect(structured?.end_time).toBe(END.toISOString())
    expect(structured?.duration_seconds).toBe(2400)

    const byKey = Object.fromEntries((structured?.metrics ?? []).map((m) => [m.key, m.value]))
    expect(byKey.heart_rate_avg).toBe(150)
    expect(byKey.duration).toBe(2400)

    // The opted-in series is inlined with non-empty samples at the floored bucket.
    expect(structured?.series).toHaveLength(1)
    const hr = structured?.series[0]
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
    expect(structured?.metrics.map((m) => m.key)).toEqual(['heart_rate_avg'])
    expect(structured?.series).toEqual([])
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
    expect(structured?.series.map((s) => s.metric)).toEqual(['heart_rate'])
    expect(structured?.metrics.map((m) => m.key)).toEqual(['heart_rate_avg'])
  })

  test('returns null for an unknown post id', async () => {
    const user = getTestUser()
    expect(await resolveStructuredPost(user, '00000000-0000-4000-8000-000000000000')).toBeNull()
  })
})
