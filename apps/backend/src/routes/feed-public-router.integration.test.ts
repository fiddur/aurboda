import type { AddressInfo } from 'node:net'

import express from 'express'
import supertest from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { PublicTagPostRecord } from '../services/central-public-tags.ts'

/**
 * Integration test for the public profile feed endpoint
 * (`GET /public/:username/posts`) against a live database. Covers the endpoint's
 * own contribution over the already-tested db/serializer layers: the
 * public/unlisted visibility filter, the response shape, and the 404 branches.
 */
import { insertActivity } from '../db/activities/index.ts'
import { createArticleDraft } from '../db/article-drafts.ts'
import { createChallenge } from '../db/challenges.ts'
import {
  createArticlePost,
  createChallengePost,
  createFeedPost,
  createReplyPost,
  type FeedPostInput,
  updateFeedPost,
} from '../db/feed.ts'
import { _setDbForUser } from '../db/index.ts'
import { createRolePool, type UserDb } from '../db/pool.ts'
import { insertTimeSeries } from '../db/time-series.ts'
import { configureStructuredChallenge } from '../services/feed-structured-challenge.ts'
import {
  cleanTestDb,
  createTestDatabase,
  getTestUser,
  startTestDb,
  stopTestDb,
  type TestDatabase,
} from '../test/db-test-helper.ts'
import { createFeedPublicRouter, type FeedPublicRouterDeps } from './feed-public-router.ts'

const CONTAINER_TIMEOUT = 120_000
const START = new Date('2026-07-01T08:00:00Z')
const END = new Date('2026-07-01T08:40:00Z')

const startApp = (
  deps: Pick<FeedPublicRouterDeps, 'listOfficialRemotePosts' | 'readOfficialFeed' | 'renderableBlocks'> = {},
) => {
  const app = express()
  app.use(
    createFeedPublicRouter({ apiBaseUrl: 'https://qs.example/api', webHost: 'https://qs.example', ...deps }),
  )
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

  test('never serves an article draft, whatever its visibility', async () => {
    const user = getTestUser()
    await createArticleDraft(user, {
      article: { blocks: [{ markdown: 'Not ready', type: 'prose' }], title: 'Unpublished' },
      visibility: 'public',
    })

    const { request, close } = startApp()
    try {
      const res = await request.get(`/public/${user}/posts`)
      expect(res.status).toBe(200)
      expect(res.body.posts).toEqual([])
      const articles = await request.get(`/public/${user}/posts?kind=article`)
      expect(articles.body.posts).toEqual([])
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

  test('?tag= lists only posts carrying the hashtag, each with its tags', async () => {
    const user = getTestUser()
    await seedPost(user, 'public')
    const tagged = await createArticlePost(user, {
      article: { blocks: [{ markdown: 'Hello', type: 'prose' }], title: 'Runs' },
      tags: ['aurboda', 'running'],
      visibility: 'public',
    })
    const { request, close } = startApp()
    try {
      for (const tag of ['running', '#Running']) {
        const res = await request.get(`/public/${user}/posts`).query({ tag })
        expect(res.status).toBe(200)
        expect(res.body.posts.map((p: { id: string }) => p.id)).toEqual([tagged.id])
        expect(res.body.posts[0].tags).toEqual(['aurboda', 'running'])
      }
      expect((await request.get(`/public/${user}/posts`).query({ tag: 'nope' })).body.posts).toEqual([])
      expect((await request.get(`/public/${user}/posts`).query({ tag: 'not a tag' })).status).toBe(400)
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

  test('serves public articles as Atom, never unlisted, followers-only or other kinds', async () => {
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
      expect(res.text).not.toContain(unlisted.id)
      expect(res.text).not.toContain('Unlisted body')
      expect(res.text).toContain('<title type="text">First &lt;post&gt;</title>')
      expect(res.text).toContain('&lt;strong&gt;world&lt;/strong&gt; &amp;amp; more')
      expect(res.text).not.toContain('Followers only')
      expect(res.text).not.toContain('Secret')
    } finally {
      await close()
    }
  })

  test('renders once until an article changes', async () => {
    const user = getTestUser()
    const post = await createArticlePost(user, {
      article: { blocks: [{ markdown: 'Body', type: 'prose' }], title: 'Cached' },
      visibility: 'public',
    })
    const rendered: string[] = []
    const { request, close } = startApp({
      renderableBlocks: async (_user, postId) => {
        rendered.push(postId)
        return new Set()
      },
    })
    try {
      const first = await request.get(`/public/${user}/articles.atom`)
      const second = await request.get(`/public/${user}/articles.atom`)
      expect(second.text).toBe(first.text)
      expect(rendered).toEqual([post.id])

      await updateFeedPost(user, post.id, {
        article: { blocks: [{ markdown: 'Body', type: 'prose' }], title: 'Edited' },
      })
      const third = await request.get(`/public/${user}/articles.atom`)
      expect(third.text).toContain('<title type="text">Edited</title>')
      expect(rendered).toEqual([post.id, post.id])
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

describe('GET /public/official-feed', () => {
  const second = 'seconduser'
  let secondDb: TestDatabase
  let secondPool: UserDb

  beforeAll(async () => {
    await startTestDb()
    secondDb = await createTestDatabase()
    secondPool = createRolePool({ connectionString: secondDb.uri, max: 2 })
    _setDbForUser(second, secondPool)
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await secondPool.end()
    await secondDb.drop()
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    await secondPool.query('TRUNCATE feed_posts CASCADE')
  })

  const note = (overrides: Partial<FeedPostInput> = {}): FeedPostInput => ({
    activity_id: null,
    include_chart: false,
    include_map: false,
    included_metrics: [],
    message: 'A note',
    series_metrics: [],
    visibility: 'public',
    ...overrides,
  })

  const feedOf = (users: string[], tags: string[] = []) => ({
    readOfficialFeed: async () => ({ remote_authors: [], tags, users }),
  })

  test('404s when the official feed is off', async () => {
    for (const deps of [{}, feedOf([])]) {
      const { request, close } = startApp(deps)
      try {
        const res = await request.get('/public/official-feed')
        expect(res.status).toBe(404)
        expect((await request.get('/public/official-feed.atom')).status).toBe(404)
      } finally {
        await close()
      }
    }
  })

  test('merges the users’ public tagged posts newest first, each with its author', async () => {
    const first = getTestUser()
    const a1 = await createFeedPost(first, note({ tags: ['aurboda'] }))
    const b1 = await createFeedPost(second, note({ tags: ['qs', 'running'] }))
    await createFeedPost(second, note({ tags: ['other'] }))
    await createFeedPost(first, note({ tags: ['aurboda'], visibility: 'unlisted' }))
    await createFeedPost(first, note({ tags: ['aurboda'], visibility: 'followers' }))
    await createReplyPost(first, {
      in_reply_to_actor_uri: 'https://mastodon.example/users/alice',
      in_reply_to_uri: 'https://mastodon.example/statuses/1',
      message: 'Nice! #aurboda',
      tags: ['aurboda'],
      visibility: 'public',
    })
    const activityPost = await seedPost(first, 'public')
    await updateFeedPost(first, activityPost, { tags: ['qs'] })

    const { request, close } = startApp(feedOf([first, second], ['aurboda', 'qs']))
    try {
      const res = await request.get('/public/official-feed')
      expect(res.status).toBe(200)
      expect(res.headers['cache-control']).toBe('no-store')
      expect(
        res.body.posts.map((p: { id: string; author_username: string }) => [p.id, p.author_username]),
      ).toEqual([
        [activityPost, first],
        [b1.id, second],
        [a1.id, first],
      ])
      expect(res.body.next_cursor).toBeNull()
      expect(res.body.users).toEqual([first, second])
      expect(res.body.tags).toEqual(['aurboda', 'qs'])
      expect(res.body.posts.map((p: { origin: string }) => p.origin)).toEqual(['local', 'local', 'local'])
      expect(res.body.posts[0].structured).toMatchObject({ kind: 'activity', name: 'Morning run' })
    } finally {
      await close()
    }
  })

  test('lists every public post of the users when no tags are set', async () => {
    const first = getTestUser()
    await createFeedPost(first, note())
    await createFeedPost(second, note({ tags: ['anything'] }))
    const { request, close } = startApp(feedOf([first, second]))
    try {
      const res = await request.get('/public/official-feed')
      expect(res.body.posts).toHaveLength(2)
    } finally {
      await close()
    }
  })

  test('pages across users with the cursor, never repeating or skipping a post', async () => {
    const first = getTestUser()
    const created: string[] = []
    for (let i = 0; i < 23; i += 1) {
      created.push((await createFeedPost(i % 3 === 0 ? second : first, note({ message: `post ${i}` }))).id)
    }
    const { request, close } = startApp(feedOf([first, second]))
    try {
      const page1 = await request.get('/public/official-feed')
      expect(page1.body.posts).toHaveLength(20)
      expect(page1.body.next_cursor).toEqual(expect.any(String))
      const page2 = await request.get('/public/official-feed').query({ cursor: page1.body.next_cursor })
      expect(page2.body.posts).toHaveLength(3)
      expect(page2.body.next_cursor).toBeNull()
      const ids = [...page1.body.posts, ...page2.body.posts].map((p: { id: string }) => p.id)
      expect(ids).toEqual(created.toReversed())
    } finally {
      await close()
    }
  })

  test('serves the newest posts as Atom, each entry with its author and a title', async () => {
    const first = getTestUser()
    const article = await createArticlePost(first, {
      article: { blocks: [{ markdown: 'Hello **world**', type: 'prose' }], title: 'An <article>' },
      tags: ['aurboda'],
      visibility: 'public',
    })
    await createFeedPost(second, note({ message: 'Ran far today #aurboda', tags: ['aurboda'] }))
    await createFeedPost(second, note({ message: 'Hidden', tags: ['aurboda'], visibility: 'unlisted' }))

    const { request, close } = startApp(feedOf([first, second], ['aurboda']))
    try {
      const res = await request.get('/public/official-feed.atom')
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('application/atom+xml; charset=utf-8')
      expect(res.headers['cache-control']).toBe('public, max-age=300')
      expect(res.text).toContain('<id>https://qs.example/blog</id>')
      expect(res.text).toContain(`<id>https://qs.example/u/${first}/posts/${article.id}</id>`)
      expect(res.text).toContain('<title type="text">An &lt;article&gt;</title>')
      expect(res.text).toContain('&lt;strong&gt;world&lt;/strong&gt;')
      expect(res.text).toContain(`<author><name>${second}</name>`)
      expect(res.text).toContain('<title type="text">Ran far today #aurboda</title>')
      expect(res.text).not.toContain('Hidden')
    } finally {
      await close()
    }
  })

  test('merges remote authors’ posts with the users’ by time, paging across both', async () => {
    const first = getTestUser()
    const local = [
      await createFeedPost(first, note({ message: 'local 1', tags: ['aurbodablog'] })),
      await createFeedPost(first, note({ message: 'local 2', tags: ['aurbodablog'] })),
    ]
    const at = (post: { created_at: Date }, deltaMs: number) => new Date(post.created_at.getTime() + deltaMs)
    const remoteRecord = (n: number, published_at: Date): PublicTagPostRecord => ({
      actor_uri: 'https://aurboda.net/users/fiddur',
      announce_uris: [],
      avatar_url: null,
      content: `<p>remote ${n}</p>`,
      created_at: published_at,
      cursor_ts: published_at.toISOString(),
      display_name: 'Fredrik',
      handle: '@fiddur@aurboda.net',
      id: `00000000-0000-4000-8000-00000000000${n}`,
      images: [],
      local_user: null,
      note_uri: `https://aurboda.net/notes/${n}`,
      published_at,
      tags: ['aurbodablog'],
      updated_at: published_at,
      url: `https://aurboda.net/u/fiddur/posts/${n}`,
    })
    const remote = [remoteRecord(2, at(local[1], 1000)), remoteRecord(1, at(local[0], -1000))]
    const calls: unknown[] = []
    const listOfficialRemotePosts: NonNullable<FeedPublicRouterDeps['listOfficialRemotePosts']> = async (
      handles,
      tags,
      limit,
      before,
    ) => {
      calls.push([handles, tags, limit])
      const after = before ? remote.filter((r) => r.published_at < new Date(before.ts)) : remote
      return after.slice(0, limit)
    }
    const { request, close } = startApp({
      listOfficialRemotePosts,
      readOfficialFeed: async () => ({
        remote_authors: ['fiddur@aurboda.net'],
        tags: ['aurbodablog'],
        users: [first],
      }),
    })
    try {
      const res = await request.get('/public/official-feed')
      expect(res.status).toBe(200)
      expect(res.body.remote_authors).toEqual(['fiddur@aurboda.net'])
      expect(res.body.posts.map((p: { origin: string; id: string }) => [p.origin, p.id])).toEqual([
        ['remote', remote[0].id],
        ['local', local[1].id],
        ['local', local[0].id],
        ['remote', remote[1].id],
      ])
      expect(res.body.posts[0]).toMatchObject({ handle: '@fiddur@aurboda.net', origin: 'remote' })
      expect(res.body.posts[1]).toMatchObject({ author_username: first, origin: 'local' })
      expect(calls[0]).toEqual([['@fiddur@aurboda.net'], ['aurbodablog'], 21])

      const atom = await request.get('/public/official-feed.atom')
      expect(atom.text).toContain('<id>https://aurboda.net/notes/2</id>')
      expect(atom.text).toContain(`<id>https://qs.example/u/${first}/posts/${local[1].id}</id>`)
      expect(atom.text).toContain('<title type="text">remote 2</title>')
    } finally {
      await close()
    }
  })
})
