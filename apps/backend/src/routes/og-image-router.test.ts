import type { SharedExerciseData } from '@aurboda/api-spec'

import express from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import type { ResolvedChallenge } from '../services/challenge-card.ts'
import type { PostChart } from '../services/charts/post-chart-svg.ts'
import type { ResolvedPost } from '../services/post-card.ts'
import type { ResolvedExercise } from './share-html-router.ts'

import { createOgImageRouter, type OgImageDeps } from './og-image-router.ts'

const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const resolvedChallenge = (overrides: Partial<ResolvedChallenge> = {}): ResolvedChallenge => ({
  banner_updated_at: null,
  end_ts: '2026-11-01T00:00:00.000Z',
  id: 'c1',
  is_public: true,
  members: [],
  name: 'Step count',
  spec: { pattern: 'steps', source_type: 'metric', unit: 'steps' },
  start_ts: '2026-10-04T00:00:00.000Z',
  timezone: 'UTC',
  ...overrides,
})

const resolvedExercise = (overrides: Partial<ResolvedExercise> = {}): ResolvedExercise => ({
  activity_type: 'strength_training',
  activity_type_name: 'Strength training',
  field: 'sets.exercise',
  id: 'e1',
  is_public: true,
  name: 'Bench',
  value: 'Bench Press',
  ...overrides,
})

const exerciseData: SharedExerciseData = {
  done: { count: 43, first: '2025-03-04T08:00:00.000Z', last: '2026-11-04T08:00:00.000Z' },
  history: [],
  per_week: null,
  records: [{ measure: 'e1rm', start_time: '2025-12-21T09:00:00.000Z', value: 39.5 }],
  trend: null,
}

const buildApp = (overrides: Partial<OgImageDeps> = {}) => {
  const deps: OgImageDeps = {
    loadAvatarDataUri: async () => 'data:image/png;base64,AAAA',
    latestExerciseSession: vi.fn(async () => '2026-11-04T08:00:00.000Z'),
    loadBannerDataUri: vi.fn(async () => 'data:image/jpeg;base64,BBBB'),
    loadExerciseCard: vi.fn(async () => ({ data: exerciseData, timeZone: 'Europe/Stockholm' })),
    loadDashboardChart: vi.fn(async () => null),
    loadPostChart: vi.fn(async () => null),
    now: () => new Date('2026-10-01T12:00:00Z'),
    profileExists: async () => false,
    renderImage: vi.fn(async () => fakePng),
    resolveChallenge: async () => null,
    resolveDashboard: async () => null,
    resolveExercise: async () => null,
    resolvePost: async () => null,
    webHost: 'https://aurboda.net',
    ...overrides,
  }
  const app = express()
  app.use(createOgImageRouter(deps))
  return { app, deps }
}

describe('GET /u/:username/:slug/opengraph-image.png', () => {
  test('renders a PNG for a public dashboard', async () => {
    const { app, deps } = buildApp({
      resolveDashboard: async () => ({
        is_public: true,
        name: 'Training',
        updated_at: '2026-10-01T08:00:00.000Z',
      }),
    })
    const res = await supertest(app).get('/u/fiddur/abc/opengraph-image.png')
    expect(res.status).toBe(200)
    expect(res.type).toBe('image/png')
    expect(res.headers['cache-control']).toBe('public, max-age=3600')
    expect(deps.renderImage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'dashboard', title: 'Training', username: 'fiddur' }),
    )
  })

  test('renders a challenge card when no dashboard matches', async () => {
    const { app, deps } = buildApp({
      resolveChallenge: async () =>
        resolvedChallenge({
          members: [
            { cached_total: null, display_name: 'Anna', is_host: true },
            { cached_total: 900, display_name: 'Bo', is_host: false },
          ],
        }),
    })
    const res = await supertest(app).get('/u/fiddur/xyz/opengraph-image.png')
    expect(res.status).toBe(200)
    expect(deps.renderImage).toHaveBeenCalledWith(
      expect.objectContaining({
        challenge: expect.objectContaining({
          joined: 1,
          measure: 'Steps',
          members: [
            { name: 'Bo', total: 900 },
            { name: 'Anna', total: null },
          ],
          phrase: 'Starts in 3 days',
        }),
        kind: 'challenge',
        title: 'Step count',
        username: 'fiddur',
      }),
    )
  })

  test('re-renders a challenge card when member totals change', async () => {
    let total = 100
    const { app, deps } = buildApp({
      resolveChallenge: async () =>
        resolvedChallenge({ members: [{ cached_total: total, display_name: 'Bo', is_host: false }] }),
    })
    await supertest(app).get('/u/fiddur/xyz/opengraph-image.png')
    await supertest(app).get('/u/fiddur/xyz/opengraph-image.png')
    expect(deps.renderImage).toHaveBeenCalledTimes(1)
    total = 250
    await supertest(app).get('/u/fiddur/xyz/opengraph-image.png')
    expect(deps.renderImage).toHaveBeenCalledTimes(2)
  })

  test('loads no banner for a challenge without one', async () => {
    const { app, deps } = buildApp({ resolveChallenge: async () => resolvedChallenge() })
    await supertest(app).get('/u/fiddur/xyz/opengraph-image.png')
    expect(deps.loadBannerDataUri).not.toHaveBeenCalled()
    expect(deps.renderImage).toHaveBeenCalledWith(
      expect.objectContaining({
        challenge: expect.not.objectContaining({ bannerDataUri: expect.anything() }),
      }),
    )
  })

  test('draws the host-set banner and re-renders when it changes', async () => {
    let bannerUpdatedAt = '2026-10-01T08:00:00.000Z'
    const { app, deps } = buildApp({
      resolveChallenge: async () => resolvedChallenge({ banner_updated_at: bannerUpdatedAt }),
    })
    await supertest(app).get('/u/fiddur/xyz/opengraph-image.png')
    expect(deps.loadBannerDataUri).toHaveBeenCalledWith('fiddur', 'c1')
    expect(deps.renderImage).toHaveBeenCalledWith(
      expect.objectContaining({
        challenge: expect.objectContaining({ bannerDataUri: 'data:image/jpeg;base64,BBBB' }),
      }),
    )
    bannerUpdatedAt = '2026-10-01T09:00:00.000Z'
    await supertest(app).get('/u/fiddur/xyz/opengraph-image.png')
    expect(deps.renderImage).toHaveBeenCalledTimes(2)
  })

  test('renders the themed card when the banner fails to load', async () => {
    const { app, deps } = buildApp({
      loadBannerDataUri: vi.fn(async () => Promise.reject(new Error('db down'))),
      resolveChallenge: async () => resolvedChallenge({ banner_updated_at: '2026-10-01T08:00:00.000Z' }),
    })
    const res = await supertest(app).get('/u/fiddur/xyz/opengraph-image.png')
    expect(res.status).toBe(200)
    expect(deps.renderImage).toHaveBeenCalledWith(
      expect.objectContaining({ challenge: expect.objectContaining({ bannerDataUri: undefined }) }),
    )
  })

  test('redirects unlisted resources to the default image', async () => {
    const { app, deps } = buildApp({
      resolveDashboard: async () => ({
        is_public: false,
        name: 'Secret',
        updated_at: '2026-10-01T08:00:00.000Z',
      }),
    })
    const res = await supertest(app).get('/u/fiddur/abc/opengraph-image.png')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('https://aurboda.net/og-default.png')
    expect(res.headers['cache-control']).toBe('public, max-age=300')
    expect(deps.renderImage).not.toHaveBeenCalled()
    expect(deps.loadDashboardChart).not.toHaveBeenCalled()
  })

  test('redirects unknown resources to the default image', async () => {
    const res = await supertest(buildApp().app).get('/u/fiddur/nope/opengraph-image.png')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('https://aurboda.net/og-default.png')
  })

  test('renders a public shared exercise', async () => {
    const { app, deps } = buildApp({ resolveExercise: async () => resolvedExercise() })
    const res = await supertest(app).get('/u/fiddur/ex1/opengraph-image.png')
    expect(res.status).toBe(200)
    expect(res.type).toBe('image/png')
    expect(deps.loadExerciseCard).toHaveBeenCalledWith(
      'fiddur',
      expect.objectContaining({
        activity_type: 'strength_training',
        field: 'sets.exercise',
        value: 'Bench Press',
      }),
    )
    expect(deps.renderImage).toHaveBeenCalledWith(
      expect.objectContaining({
        exercise: expect.objectContaining({
          activityTypeName: 'Strength training',
          headline: { date: '21 Dec 2025', label: 'Best e1RM', value: '39.5 kg' },
          sessions: '43 sessions since Mar 2025',
        }),
        kind: 'exercise',
        title: 'Bench',
        username: 'fiddur',
      }),
    )
  })

  test('memoises an exercise card until a new session lands', async () => {
    let latest = '2026-11-04T08:00:00.000Z'
    const { app, deps } = buildApp({
      latestExerciseSession: vi.fn(async () => latest),
      resolveExercise: async () => resolvedExercise(),
    })
    await supertest(app).get('/u/fiddur/ex1/opengraph-image.png')
    await supertest(app).get('/u/fiddur/ex1/opengraph-image.png')
    expect(deps.loadExerciseCard).toHaveBeenCalledTimes(1)
    expect(deps.renderImage).toHaveBeenCalledTimes(1)
    latest = '2026-11-05T08:00:00.000Z'
    await supertest(app).get('/u/fiddur/ex1/opengraph-image.png')
    expect(deps.loadExerciseCard).toHaveBeenCalledTimes(2)
    expect(deps.renderImage).toHaveBeenCalledTimes(2)
  })

  test('redirects an unlisted shared exercise to the default image', async () => {
    const { app, deps } = buildApp({ resolveExercise: async () => resolvedExercise({ is_public: false }) })
    const res = await supertest(app).get('/u/fiddur/ex1/opengraph-image.png')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('https://aurboda.net/og-default.png')
    expect(deps.loadExerciseCard).not.toHaveBeenCalled()
    expect(deps.renderImage).not.toHaveBeenCalled()
  })

  test('a dashboard of the same slug wins over an exercise', async () => {
    const resolveExercise = vi.fn(async () => resolvedExercise())
    const { app, deps } = buildApp({
      resolveDashboard: async () => ({
        is_public: true,
        name: 'Training',
        updated_at: '2026-10-01T08:00:00.000Z',
      }),
      resolveExercise,
    })
    await supertest(app).get('/u/fiddur/ex1/opengraph-image.png')
    expect(resolveExercise).not.toHaveBeenCalled()
    expect(deps.renderImage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'dashboard' }))
  })

  test('degrades to the default image when the exercise data fails to load', async () => {
    const { app, deps } = buildApp({
      loadExerciseCard: vi.fn(async () => Promise.reject(new Error('db down'))),
      resolveExercise: async () => resolvedExercise(),
    })
    const res = await supertest(app).get('/u/fiddur/ex1/opengraph-image.png')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('https://aurboda.net/og-default.png')
    expect(deps.renderImage).not.toHaveBeenCalled()
  })

  test('memoises renders across identical requests', async () => {
    const { app, deps } = buildApp({
      resolveDashboard: async () => ({
        is_public: true,
        name: 'Training',
        updated_at: '2026-10-01T08:00:00.000Z',
      }),
    })
    await supertest(app).get('/u/fiddur/abc/opengraph-image.png')
    await supertest(app).get('/u/fiddur/abc/opengraph-image.png')
    expect(deps.renderImage).toHaveBeenCalledTimes(1)
  })

  test('still renders a public card when the avatar fails to load', async () => {
    const { app, deps } = buildApp({
      loadAvatarDataUri: vi.fn(async () => {
        throw new Error('avatar db blip')
      }),
      resolveDashboard: async () => ({
        is_public: true,
        name: 'Training',
        updated_at: '2026-10-01T08:00:00.000Z',
      }),
    })
    const res = await supertest(app).get('/u/fiddur/abc/opengraph-image.png')
    expect(res.status).toBe(200)
    expect(res.type).toBe('image/png')
    expect(deps.renderImage).toHaveBeenCalledWith(
      expect.objectContaining({ avatarDataUri: undefined, kind: 'dashboard' }),
    )
  })

  test('degrades to the default image when a render fails', async () => {
    const { app } = buildApp({
      renderImage: vi.fn(async () => {
        throw new Error('satori boom')
      }),
      resolveDashboard: async () => ({
        is_public: true,
        name: 'Training',
        updated_at: '2026-10-01T08:00:00.000Z',
      }),
    })
    const res = await supertest(app).get('/u/fiddur/abc/opengraph-image.png')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('https://aurboda.net/og-default.png')
  })

  test('collapses concurrent cold-cache misses into a single render', async () => {
    const renderImage = vi.fn(() => new Promise<Buffer>((resolve) => setTimeout(() => resolve(fakePng), 30)))
    const { app } = buildApp({
      renderImage,
      resolveDashboard: async () => ({
        is_public: true,
        name: 'Training',
        updated_at: '2026-10-01T08:00:00.000Z',
      }),
    })
    const responses = await Promise.all([
      supertest(app).get('/u/fiddur/abc/opengraph-image.png'),
      supertest(app).get('/u/fiddur/abc/opengraph-image.png'),
      supertest(app).get('/u/fiddur/abc/opengraph-image.png'),
    ])
    for (const res of responses) expect(res.status).toBe(200)
    expect(renderImage).toHaveBeenCalledTimes(1)
  })
})

describe('a dashboard card’s chart', () => {
  const path = '/u/fiddur/abc/opengraph-image.png'
  const trend = (last: number): PostChart => ({
    opts: { color: '#2b9ea7', label: 'Runs' },
    series: [
      [new Date('2026-10-01'), 2],
      [new Date('2026-10-02'), last],
    ],
    type: 'line',
  })
  const resolveDashboard = async () => ({
    is_public: true,
    name: 'Training',
    updated_at: '2026-10-01T08:00:00.000Z',
  })

  test('draws the chart of a dashboard with a trend widget', async () => {
    const loadDashboardChart = vi.fn(async () => trend(4))
    const { app, deps } = buildApp({ loadDashboardChart, resolveDashboard })
    const res = await supertest(app).get(path)
    expect(res.status).toBe(200)
    expect(loadDashboardChart).toHaveBeenCalledWith('fiddur', 'abc')
    expect(deps.renderImage).toHaveBeenCalledWith(
      expect.objectContaining({ chart: trend(4), kind: 'dashboard', title: 'Training' }),
    )
  })

  test('keeps the title card for a dashboard without a chartable widget', async () => {
    const { app, deps } = buildApp({ resolveDashboard })
    const res = await supertest(app).get(path)
    expect(res.status).toBe(200)
    expect(deps.loadDashboardChart).toHaveBeenCalledTimes(1)
    expect(vi.mocked(deps.renderImage).mock.calls[0][0]).not.toHaveProperty('chart')
    await supertest(app).get(path)
    expect(deps.renderImage).toHaveBeenCalledTimes(1)
  })

  test('serves a memoised card without loading any data', async () => {
    const loadDashboardChart = vi.fn(async () => trend(4))
    const { app, deps } = buildApp({ loadDashboardChart, resolveDashboard })
    await supertest(app).get(path)
    await supertest(app).get(path)
    await supertest(app).get(path)
    expect(loadDashboardChart).toHaveBeenCalledTimes(1)
    expect(deps.renderImage).toHaveBeenCalledTimes(1)
  })

  test('redraws in a new hour, and after an edit', async () => {
    let clock = new Date('2026-11-01T08:00:00.000Z')
    let last = 4
    let updatedAt = '2026-10-01T08:00:00.000Z'
    const loadDashboardChart = vi.fn(async () => trend(last))
    const { app, deps } = buildApp({
      loadDashboardChart,
      now: () => clock,
      resolveDashboard: async () => ({ is_public: true, name: 'Training', updated_at: updatedAt }),
    })
    await supertest(app).get(path)
    last = 5
    clock = new Date('2026-11-01T08:59:59.000Z')
    await supertest(app).get(path)
    expect(deps.renderImage).toHaveBeenCalledTimes(1)
    clock = new Date('2026-11-01T09:00:00.000Z')
    await supertest(app).get(path)
    expect(loadDashboardChart).toHaveBeenCalledTimes(2)
    expect(vi.mocked(deps.renderImage).mock.calls[1][0].chart).toEqual(trend(5))
    updatedAt = '2026-11-01T09:10:00.000Z'
    await supertest(app).get(path)
    expect(loadDashboardChart).toHaveBeenCalledTimes(3)
  })

  test('renders the card without a chart when loading it fails, and tries again next time', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const loadDashboardChart = vi
      .fn<OgImageDeps['loadDashboardChart']>()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(trend(4))
    const { app, deps } = buildApp({ loadDashboardChart, resolveDashboard })
    const res = await supertest(app).get(path)
    expect(res.status).toBe(200)
    expect(vi.mocked(deps.renderImage).mock.calls[0][0]).not.toHaveProperty('chart')
    await supertest(app).get(path)
    expect(loadDashboardChart).toHaveBeenCalledTimes(2)
    expect(vi.mocked(deps.renderImage).mock.calls[1][0].chart).toEqual(trend(4))
    error.mockRestore()
  })
})

describe('GET /u/:username/opengraph-image.png', () => {
  test('renders a profile card when the profile exists', async () => {
    const { app, deps } = buildApp({ profileExists: async () => true })
    const res = await supertest(app).get('/u/fiddur/opengraph-image.png')
    expect(res.status).toBe(200)
    expect(res.type).toBe('image/png')
    expect(deps.renderImage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'profile', title: 'fiddur' }),
    )
  })

  test('redirects to default when the profile is missing', async () => {
    const res = await supertest(buildApp().app).get('/u/ghost/opengraph-image.png')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('https://aurboda.net/og-default.png')
  })

  test('redirects to default for an invalid username', async () => {
    const { app, deps } = buildApp({ profileExists: async () => true })
    const res = await supertest(app).get('/u/Invalid..Name/opengraph-image.png')
    expect(res.status).toBe(302)
    expect(deps.renderImage).not.toHaveBeenCalled()
  })
})

describe('GET /u/:username/posts/:postId/opengraph-image.png', () => {
  const postId = '11111111-2222-4333-8444-555555555555'
  const path = `/u/fiddur/posts/${postId}/opengraph-image.png`
  const publicPost = (overrides: Partial<Extract<ResolvedPost, { is_public: true }>> = {}): ResolvedPost => ({
    created_at: '2026-11-01T07:30:00.000Z',
    description: 'Felt great today',
    is_public: true,
    kind: 'activity',
    title: 'Morning run',
    updated_at: '2026-11-01T08:00:00.000Z',
    ...overrides,
  })

  test('renders a post card for a public post', async () => {
    const { app, deps } = buildApp({ resolvePost: async () => publicPost() })
    const res = await supertest(app).get(path)
    expect(res.status).toBe(200)
    expect(res.type).toBe('image/png')
    expect(res.headers['cache-control']).toBe('public, max-age=3600')
    expect(deps.renderImage).toHaveBeenCalledWith({
      avatarDataUri: 'data:image/png;base64,AAAA',
      eyebrow: 'Activity',
      kind: 'post',
      subtitle: 'Felt great today',
      title: 'Morning run',
      username: 'fiddur',
    })
  })

  test('names a reply a post, clamps the subtitle to one line and leaves an empty one out', async () => {
    const long = 'word '.repeat(30)
    const { app, deps } = buildApp({
      resolvePost: async (_username, id) =>
        id === postId
          ? publicPost({ description: long, kind: 'reply', title: 'Nice run!' })
          : publicPost({ description: '', kind: 'article', title: 'Sleep' }),
    })
    await supertest(app).get(path)
    const card = vi.mocked(deps.renderImage).mock.calls[0][0]
    expect(card.eyebrow).toBe('Post')
    expect(card.subtitle?.endsWith('…')).toBe(true)
    expect(Array.from(card.subtitle ?? '').length).toBeLessThanOrEqual(70)

    await supertest(app).get('/u/fiddur/posts/22222222-2222-4333-8444-555555555555/opengraph-image.png')
    const article = vi.mocked(deps.renderImage).mock.calls[1][0]
    expect(article.eyebrow).toBe('Article')
    expect(article).not.toHaveProperty('subtitle')
  })

  test('re-renders the memoised card when the post is edited', async () => {
    let updated_at = '2026-11-01T08:00:00.000Z'
    const { app, deps } = buildApp({ resolvePost: async () => publicPost({ updated_at }) })
    await supertest(app).get(path)
    await supertest(app).get(path)
    expect(deps.renderImage).toHaveBeenCalledTimes(1)
    updated_at = '2026-11-02T08:00:00.000Z'
    await supertest(app).get(path)
    expect(deps.renderImage).toHaveBeenCalledTimes(2)
  })

  const heartRate = (peak: number): PostChart => ({
    series: [
      [new Date('2026-11-01T07:30:00.000Z'), 120],
      [new Date('2026-11-01T07:40:00.000Z'), peak],
    ],
    type: 'line',
  })

  test('passes a post’s chart to the card', async () => {
    const loadPostChart = vi.fn(async () => heartRate(150))
    const { app, deps } = buildApp({ loadPostChart, resolvePost: async () => publicPost() })
    const res = await supertest(app).get(path)
    expect(res.status).toBe(200)
    expect(loadPostChart).toHaveBeenCalledWith('fiddur', postId)
    expect(deps.renderImage).toHaveBeenCalledWith(
      expect.objectContaining({ chart: heartRate(150), kind: 'post' }),
    )
  })

  test('serves a memoised card without loading the chart again', async () => {
    const loadPostChart = vi.fn(async () => heartRate(150))
    const { app, deps } = buildApp({ loadPostChart, resolvePost: async () => publicPost() })
    await supertest(app).get(path)
    await supertest(app).get(path)
    expect(loadPostChart).toHaveBeenCalledTimes(1)
    expect(deps.renderImage).toHaveBeenCalledTimes(1)
  })

  test('redraws the chart in a new time bucket, though the post did not change', async () => {
    let clock = new Date('2026-11-01T08:00:00.000Z')
    let peak = 150
    const loadPostChart = vi.fn(async () => heartRate(peak))
    const { app, deps } = buildApp({
      loadPostChart,
      now: () => clock,
      resolvePost: async () => publicPost({ chart_bucket_ms: 300_000, kind: 'challenge' }),
    })
    await supertest(app).get(path)
    peak = 160
    clock = new Date('2026-11-01T08:04:59.000Z')
    await supertest(app).get(path)
    expect(deps.renderImage).toHaveBeenCalledTimes(1)
    clock = new Date('2026-11-01T08:05:00.000Z')
    await supertest(app).get(path)
    expect(loadPostChart).toHaveBeenCalledTimes(2)
    expect(vi.mocked(deps.renderImage).mock.calls[1][0].chart).toEqual(heartRate(160))
  })

  test('keeps a post without a bucket until it is edited, whatever the time', async () => {
    let clock = new Date('2026-11-01T08:00:00.000Z')
    const { app, deps } = buildApp({ now: () => clock, resolvePost: async () => publicPost() })
    await supertest(app).get(path)
    clock = new Date('2026-11-09T08:00:00.000Z')
    await supertest(app).get(path)
    expect(deps.renderImage).toHaveBeenCalledTimes(1)
  })

  test('renders the card without a chart when loading it fails, and tries again next time', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const loadPostChart = vi
      .fn<OgImageDeps['loadPostChart']>()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(heartRate(150))
    const { app, deps } = buildApp({ loadPostChart, resolvePost: async () => publicPost() })
    const res = await supertest(app).get(path)
    expect(res.status).toBe(200)
    expect(vi.mocked(deps.renderImage).mock.calls[0][0]).not.toHaveProperty('chart')
    await supertest(app).get(path)
    expect(loadPostChart).toHaveBeenCalledTimes(2)
    expect(vi.mocked(deps.renderImage).mock.calls[1][0].chart).toEqual(heartRate(150))
    error.mockRestore()
  })

  test('is not shadowed by the slug route', async () => {
    const resolveDashboard = vi.fn(async () => ({
      is_public: true,
      name: 'Posts',
      updated_at: '2026-10-01T08:00:00.000Z',
    }))
    const { app, deps } = buildApp({ resolveDashboard, resolvePost: async () => publicPost() })
    await supertest(app).get(path)
    expect(resolveDashboard).not.toHaveBeenCalled()
    expect(deps.renderImage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'post' }))
  })

  test('redirects a non-public or unknown post to the default image', async () => {
    for (const resolved of [{ is_public: false } as const, null]) {
      const { app, deps } = buildApp({ resolvePost: async () => resolved })
      const res = await supertest(app).get(path)
      expect(res.status).toBe(302)
      expect(res.headers.location).toBe('https://aurboda.net/og-default.png')
      expect(deps.renderImage).not.toHaveBeenCalled()
      expect(deps.loadPostChart).not.toHaveBeenCalled()
    }
  })

  test('redirects an invalid username or post id without resolving it', async () => {
    const resolvePost = vi.fn(async () => publicPost())
    const { app, deps } = buildApp({ resolvePost })
    for (const bad of [
      '/u/fiddur/posts/not-a-uuid/opengraph-image.png',
      `/u/Invalid..Name/posts/${postId}/opengraph-image.png`,
    ]) {
      const res = await supertest(app).get(bad)
      expect(res.status).toBe(302)
      expect(res.headers.location).toBe('https://aurboda.net/og-default.png')
    }
    expect(resolvePost).not.toHaveBeenCalled()
    expect(deps.renderImage).not.toHaveBeenCalled()
  })
})
