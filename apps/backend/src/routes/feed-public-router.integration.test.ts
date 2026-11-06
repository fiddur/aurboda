import type { AddressInfo } from 'node:net'

import express from 'express'
import supertest from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

/**
 * Integration test for the public profile feed endpoint
 * (`GET /public/:username/posts`) against a live database. Covers the endpoint's
 * own contribution over the already-tested db/serializer layers: the
 * public/unlisted visibility filter, the response shape, and the 404 branches.
 */
import { insertActivity } from '../db/activities/index.ts'
import { createChallenge } from '../db/challenges.ts'
import { createArticlePost, createChallengePost, createFeedPost } from '../db/feed.ts'
import { insertTimeSeries } from '../db/time-series.ts'
import { configureStructuredChallenge } from '../services/feed-structured-challenge.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { createFeedPublicRouter } from './feed-public-router.ts'

const CONTAINER_TIMEOUT = 120_000
const START = new Date('2026-07-01T08:00:00Z')
const END = new Date('2026-07-01T08:40:00Z')

const startApp = () => {
  const app = express()
  app.use(createFeedPublicRouter({ apiBaseUrl: 'https://qs.example/api', webHost: 'https://qs.example' }))
  const server = app.listen(0)
  const port = (server.address() as AddressInfo).port
  const close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    })
  return { close, request: supertest(`http://127.0.0.1:${port}`) }
}

const seedPost = async (
  user: string,
  visibility: 'public' | 'unlisted' | 'followers',
  seriesMetrics: 'heart_rate'[] = [],
): Promise<string> => {
  const activityId = await insertActivity(user, {
    activity_type: 'exercise',
    end_time: END,
    source: 'garmin',
    start_time: START,
    title: 'Morning run',
  })
  const post = await createFeedPost(user, {
    activity_id: activityId,
    include_chart: false,
    include_map: false,
    included_metrics: ['duration'],
    series_metrics: seriesMetrics,
    visibility,
  })
  return post.id
}

describe('GET /public/:username/posts', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('serves public and unlisted posts but never followers-only', async () => {
    const user = getTestUser()
    const publicId = await seedPost(user, 'public')
    const unlistedId = await seedPost(user, 'unlisted')
    const followersId = await seedPost(user, 'followers')

    const { request, close } = startApp()
    try {
      const res = await request.get(`/public/${user}/posts`)
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      const ids = res.body.posts.map((p: { id: string }) => p.id)
      expect(ids).toContain(publicId)
      expect(ids).toContain(unlistedId)
      expect(ids).not.toContain(followersId)
      // Every returned post is serialized with its visibility.
      for (const post of res.body.posts) {
        expect(['public', 'unlisted']).toContain(post.visibility)
      }
    } finally {
      await close()
    }
  })

  test('attaches the structured payload so the profile page renders natively', async () => {
    const user = getTestUser()
    const id = await seedPost(user, 'public')
    const { request, close } = startApp()
    try {
      const res = await request.get(`/public/${user}/posts`)
      expect(res.status).toBe(200)
      const post = res.body.posts.find((p: { id: string }) => p.id === id)
      expect(post.structured).toMatchObject({
        activityType: 'exercise',
        kind: 'activity',
        metrics: [{ key: 'duration', unit: 'seconds', value: 2400 }],
        name: 'Morning run',
        series: [],
        startTime: START.toISOString(),
      })
    } finally {
      await close()
    }
  })

  test('attaches the resolved structured article so a visitor sees its charts (#1054)', async () => {
    const user = getTestUser()
    await insertTimeSeries(
      user,
      Array.from({ length: 4 }, (_, i) => ({
        metric: 'heart_rate' as const,
        source: 'garmin' as const,
        time: new Date(START.getTime() + i * 600_000),
        value: 60 + i,
      })),
    )
    const article = await createArticlePost(user, {
      article: {
        blocks: [
          { markdown: 'Intro', type: 'prose' },
          {
            bucket: '1h',
            end: END.toISOString(),
            metric: 'heart_rate',
            start: START.toISOString(),
            type: 'chart',
          },
        ],
        title: 'My resting HR',
      },
      visibility: 'public',
    })

    const { request, close } = startApp()
    try {
      const res = await request.get(`/public/${user}/posts`)
      expect(res.status).toBe(200)
      const post = res.body.posts.find((p: { id: string }) => p.id === article.id)
      expect(post.structured).toMatchObject({
        blocks: [
          { markdown: 'Intro', type: 'prose' },
          { bucket: '1h', metric: 'heart_rate', type: 'chart' },
        ],
        kind: 'article',
        title: 'My resting HR',
      })
      expect(post.structured.blocks[1].samples.length).toBeGreaterThan(0)
    } finally {
      await close()
    }
  })

  test('attaches the structured challenge so a visitor sees the standings (#994)', async () => {
    configureStructuredChallenge({ apiBaseUrl: 'https://qs.example/api', webHost: 'https://qs.example' })
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
    const share = await createChallengePost(user, {
      challenge: { name: 'June RHR', url: `https://qs.example/u/${user}/${challenge.slug}` },
      visibility: 'public',
    })

    const { request, close } = startApp()
    try {
      const res = await request.get(`/public/${user}/posts`)
      expect(res.status).toBe(200)
      const post = res.body.posts.find((p: { id: string }) => p.id === share.id)
      expect(post.structured).toMatchObject({
        challenge: { kind: 'challenge', name: 'June RHR' },
        kind: 'challenge',
        standings: { kind: 'standings', members: [] },
      })
    } finally {
      await close()
    }
  })

  test('pages past the fixed page size with next_cursor (#1055)', async () => {
    const user = getTestUser()
    // Prose-only articles: no activity anchor and no chart block, so each post's
    // structured resolution is a single settings read.
    const ids: string[] = []
    for (let i = 0; i < 21; i++) {
      const post = await createArticlePost(user, {
        article: { blocks: [{ markdown: `Body ${i}`, type: 'prose' }], title: `Post ${i}` },
        visibility: 'public',
      })
      ids.push(post.id)
    }

    const { request, close } = startApp()
    try {
      const page1 = await request.get(`/public/${user}/posts`)
      expect(page1.status).toBe(200)
      expect(page1.body.posts).toHaveLength(20)
      expect(page1.body.next_cursor).toEqual(expect.any(String))

      const page2 = await request
        .get(`/public/${user}/posts`)
        .query({ cursor: page1.body.next_cursor as string })
      expect(page2.status).toBe(200)
      // The 21st (oldest) post — unreachable before pagination existed.
      expect(page2.body.posts.map((p: { id: string }) => p.id)).toEqual([ids[0]])
      expect(page2.body.next_cursor).toBeNull()

      // Every post is seen exactly once across the walk.
      const walked = [...page1.body.posts, ...page2.body.posts].map((p: { id: string }) => p.id)
      expect(new Set(walked).size).toBe(21)
    } finally {
      await close()
    }
  })

  test('a malformed cursor falls back to the first page (never a 500)', async () => {
    const user = getTestUser()
    const id = await seedPost(user, 'public')
    const { request, close } = startApp()
    try {
      const outOfRange = Buffer.from('2026-13-45 99:99:99+00:11111111-2222-4333-8444-555555555555').toString(
        'base64url',
      )
      for (const cursor of ['garbage-cursor', outOfRange]) {
        const res = await request.get(`/public/${user}/posts`).query({ cursor })
        expect(res.status).toBe(200)
        expect(res.body.posts.map((p: { id: string }) => p.id)).toEqual([id])
      }
    } finally {
      await close()
    }
  })

  test('?kind=article lists only articles, for the blog view', async () => {
    const user = getTestUser()
    await seedPost(user, 'public')
    const article = await createArticlePost(user, {
      article: { blocks: [{ markdown: 'Hello', type: 'prose' }], title: 'First post' },
      visibility: 'public',
    })
    await createArticlePost(user, {
      article: { blocks: [{ markdown: 'Secret', type: 'prose' }], title: 'Followers only' },
      visibility: 'followers',
    })
    const { request, close } = startApp()
    try {
      const res = await request.get(`/public/${user}/posts`).query({ kind: 'article' })
      expect(res.status).toBe(200)
      expect(res.body.posts.map((p: { id: string }) => p.id)).toEqual([article.id])

      const invalid = await request.get(`/public/${user}/posts`).query({ kind: 'blog' })
      expect(invalid.status).toBe(400)
    } finally {
      await close()
    }
  })

  test('returns an empty list for a user with no public posts', async () => {
    const user = getTestUser()
    await seedPost(user, 'followers') // only a followers-only post exists
    const { request, close } = startApp()
    try {
      const res = await request.get(`/public/${user}/posts`)
      expect(res.status).toBe(200)
      expect(res.body.posts).toEqual([])
    } finally {
      await close()
    }
  })

  test('404s for a malformed username (never touches a database)', async () => {
    const { request, close } = startApp()
    try {
      const res = await request.get('/public/Invalid/posts')
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Not found', posts: [], success: false })
    } finally {
      await close()
    }
  })
})

describe('GET /public/:username/articles.atom', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('serves public and unlisted articles as Atom, never followers-only or other kinds', async () => {
    const user = getTestUser()
    await seedPost(user, 'public')
    const pub = await createArticlePost(user, {
      article: { blocks: [{ markdown: 'Hello **world** & more', type: 'prose' }], title: 'First <post>' },
      visibility: 'public',
    })
    const unlisted = await createArticlePost(user, {
      article: { blocks: [{ markdown: 'Unlisted body', type: 'prose' }], title: 'Second post' },
      visibility: 'unlisted',
    })
    await createArticlePost(user, {
      article: { blocks: [{ markdown: 'Secret', type: 'prose' }], title: 'Followers only' },
      visibility: 'followers',
    })

    const { request, close } = startApp()
    try {
      const res = await request.get(`/public/${user}/articles.atom`)
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('application/atom+xml; charset=utf-8')
      expect(res.headers['cache-control']).toBe('public, max-age=300')
      expect(res.text).toContain(`<id>https://qs.example/u/${user}/articles</id>`)
      expect(res.text).toContain(
        `<link rel="self" type="application/atom+xml" href="https://qs.example/api/public/${user}/articles.atom"/>`,
      )
      expect(res.text).toContain(`<id>https://qs.example/u/${user}/posts/${pub.id}</id>`)
      expect(res.text).toContain(`<id>https://qs.example/u/${user}/posts/${unlisted.id}</id>`)
      expect(res.text).toContain('<title type="text">First &lt;post&gt;</title>')
      expect(res.text).toContain('&lt;strong&gt;world&lt;/strong&gt; &amp;amp; more')
      expect(res.text).not.toContain('Followers only')
      expect(res.text).not.toContain('Secret')
      expect(res.text.indexOf(unlisted.id)).toBeLessThan(res.text.indexOf(pub.id))
    } finally {
      await close()
    }
  })

  test('404s for a malformed username (never touches a database)', async () => {
    const { request, close } = startApp()
    try {
      expect((await request.get('/public/Invalid/articles.atom')).status).toBe(404)
    } finally {
      await close()
    }
  })
})

describe('GET /public/:username/posts/:postId', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('serves a public post serialized like the listing, structured payload included', async () => {
    const user = getTestUser()
    const id = await seedPost(user, 'public')
    const { request, close } = startApp()
    try {
      const res = await request.get(`/public/${user}/posts/${id}`)
      expect(res.status).toBe(200)
      expect(res.headers['cache-control']).toBe('no-store')
      expect(res.body.success).toBe(true)
      expect(res.body.post).toMatchObject({ id, visibility: 'public' })
      expect(res.body.post.structured).toMatchObject({
        activityType: 'exercise',
        kind: 'activity',
        metrics: [{ key: 'duration', unit: 'seconds', value: 2400 }],
        name: 'Morning run',
      })

      const listed = await request.get(`/public/${user}/posts`)
      expect(listed.body.posts.find((p: { id: string }) => p.id === id)).toEqual(res.body.post)
    } finally {
      await close()
    }
  })

  test('serves an unlisted post', async () => {
    const user = getTestUser()
    const id = await seedPost(user, 'unlisted')
    const { request, close } = startApp()
    try {
      const res = await request.get(`/public/${user}/posts/${id}`)
      expect(res.status).toBe(200)
      expect(res.body.post).toMatchObject({ id, visibility: 'unlisted' })
    } finally {
      await close()
    }
  })

  test('404s for a followers-only post, an unknown id, a non-UUID id and a malformed username', async () => {
    const user = getTestUser()
    const followersId = await seedPost(user, 'followers')
    const { request, close } = startApp()
    try {
      for (const path of [
        `/public/${user}/posts/${followersId}`,
        `/public/${user}/posts/33333333-3333-4333-8333-333333333333`,
        `/public/${user}/posts/not-a-uuid`,
        `/public/Invalid/posts/${followersId}`,
      ]) {
        const res = await request.get(path)
        expect(res.status).toBe(404)
        expect(res.body).toEqual({ error: 'Not found', success: false })
      }
    } finally {
      await close()
    }
  })
})

describe('GET /public/:username/series (QuantPub 0.2)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  const seedSharedHeartRate = async (user: string): Promise<void> => {
    await seedPost(user, 'public', ['heart_rate'])
    await insertTimeSeries(
      user,
      Array.from({ length: 60 }, (_, i) => ({
        metric: 'heart_rate' as const,
        source: 'garmin' as const,
        time: new Date(START.getTime() + i * 5_000),
        value: 150,
      })),
    )
  }

  const window = { bucket: '5s', end: END.toISOString(), start: START.toISOString() }

  test.each(['heartRate', 'heart_rate'])('accepts metric=%s and echoes the camelCase key', async (metric) => {
    const user = getTestUser()
    await seedSharedHeartRate(user)
    const { request, close } = startApp()
    try {
      const res = await request.get(`/public/${user}/series`).query({ ...window, metric })
      expect(res.status).toBe(200)
      expect(res.body.metric).toBe('heartRate')
      expect(res.body.samples.length).toBeGreaterThan(0)
    } finally {
      await close()
    }
  })

  test('an unknown metric key is a plain 404', async () => {
    const user = getTestUser()
    await seedSharedHeartRate(user)
    const { request, close } = startApp()
    try {
      const res = await request.get(`/public/${user}/series`).query({ ...window, metric: 'heartRateAvg' })
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Not found', success: false })
    } finally {
      await close()
    }
  })
})
