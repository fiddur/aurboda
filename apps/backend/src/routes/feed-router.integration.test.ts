import type { RequestHandler } from 'express'
import type { AddressInfo } from 'node:net'

import express from 'express'
import supertest from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import type { ArticlePreviewer } from '../services/article-preview.ts'

/**
 * Integration test for the owner-facing article routes on the feed router
 * (`POST /feed/articles`, `PATCH /feed/articles/:postId`) against a live
 * database — the route + `buildArticleContent`/`mergeArticleContent` service +
 * serializer composition over the already-unit-tested pieces. A fake `deliver`
 * spy covers the article fan-out branches (including `kind === 'article'` on the
 * generic `PATCH /:postId`); the actual AS2 delivery is unit-tested in `deliver`.
 */
import { insertActivity } from '../db/activities/index.ts'
import { createChallenge, createChallengeParticipation, deleteChallenge } from '../db/challenges.ts'
import { listFeedQuoteAuthorizations, upsertFeedQuoteAuthorization } from '../db/feed-quotes.ts'
import { upsertFeedPostReaction } from '../db/feed-reactions.ts'
import { createFeedPost } from '../db/feed.ts'
import { createSharedDashboard } from '../db/shared-dashboards.ts'
import { createSharedExercise } from '../db/shared-exercises.ts'
import { insertTimeSeries } from '../db/time-series.ts'
import { upsertTimelineEntry } from '../db/timeline.ts'
import { createArticlePreviewer } from '../services/article-preview.ts'
import { configureStructuredChallenge } from '../services/feed-structured-challenge.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { type FeedDeliver, createFeedRouter } from './feed-router.ts'

const CONTAINER_TIMEOUT = 120_000

const auth: RequestHandler = (req, _res, next) => {
  req.user = getTestUser()
  next()
}

const startApp = (
  deliver?: FeedDeliver,
  apiBaseUrl?: string,
  webHost?: string,
  previewArticle?: ArticlePreviewer,
) => {
  const app = express()
  app.use(express.json())
  app.use(
    '/feed',
    createFeedRouter(auth, deliver, undefined, apiBaseUrl, undefined, webHost, undefined, previewArticle),
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

const articleBody = () => ({
  blocks: [
    { markdown: '# Sleep vs HRV\n\nA look at the week.', type: 'prose' },
    { caption: 'Resting HR', metric: 'heart_rate', type: 'chart' }, // inherits the default window
  ],
  default_end: '2026-07-07T00:00:00.000Z',
  default_start: '2026-07-01T00:00:00.000Z',
  title: 'A week of sleep and HRV',
  visibility: 'public',
})

describe('Article feed routes (integration)', () => {
  let app: ReturnType<typeof startApp>

  beforeAll(async () => {
    await startTestDb()
    app = startApp()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await app.close()
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('POST /feed/articles creates an article and returns the serialized post', async () => {
    const res = await app.request.post('/feed/articles').send(articleBody())
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.post.kind).toBe('article')
    expect(res.body.post.activity_id).toBeNull()
    expect(res.body.post.article.title).toBe('A week of sleep and HRV')
    expect(res.body.post.article.blocks).toHaveLength(2)
    expect(res.body.post.visibility).toBe('public')
  })

  test('POST /feed/articles rejects a chart block with no resolvable window (400)', async () => {
    const res = await app.request.post('/feed/articles').send({
      // No default window and the chart block has none either.
      blocks: [{ metric: 'heart_rate', type: 'chart' }],
      title: 'Broken',
      visibility: 'public',
    })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.error).toContain('no time window')
  })

  test('POST /feed/articles stores an impact block and reads it back', async () => {
    const impact = {
      activity: 'meditation',
      activity_type: 'activity_type',
      caption: 'Evening meditation',
      type: 'impact',
      window_minutes: 120,
    }
    const res = await app.request
      .post('/feed/articles')
      .send({ ...articleBody(), blocks: [...articleBody().blocks, impact] })
    expect(res.status).toBe(200)
    expect(res.body.post.article.blocks[2]).toEqual(impact)
    const list = await app.request.get('/feed')
    const stored = list.body.posts.find((p: { id: string }) => p.id === res.body.post.id)
    expect(stored.article.blocks[2]).toEqual(impact)
  })

  test('POST /feed/articles rejects an impact block with no window or a bad window_minutes (400)', async () => {
    const noWindow = await app.request.post('/feed/articles').send({
      blocks: [{ activity: 'meditation', activity_type: 'activity_type', type: 'impact' }],
      title: 'Broken',
      visibility: 'public',
    })
    expect(noWindow.status).toBe(400)
    expect(noWindow.body.error).toContain('Impact block 1 (meditation) has no time window')
    const shortWindow = await app.request.post('/feed/articles').send({
      ...articleBody(),
      blocks: [{ activity: 'meditation', activity_type: 'activity_type', type: 'impact', window_minutes: 5 }],
    })
    expect(shortWindow.status).toBe(400)
  })

  test('PATCH /feed/articles/:postId replaces provided fields', async () => {
    const created = await app.request.post('/feed/articles').send(articleBody())
    const id = created.body.post.id

    const res = await app.request
      .patch(`/feed/articles/${id}`)
      .send({ blocks: [{ markdown: 'Rewritten.', type: 'prose' }], title: 'Revised', visibility: 'unlisted' })
    expect(res.status).toBe(200)
    expect(res.body.post.article.title).toBe('Revised')
    expect(res.body.post.article.blocks).toEqual([{ markdown: 'Rewritten.', type: 'prose' }])
    expect(res.body.post.visibility).toBe('unlisted')
    // The default window was not part of the patch, so it is preserved.
    expect(res.body.post.article.default_start).toBe('2026-07-01T00:00:00.000Z')
  })

  test('PATCH /feed/articles/:postId 404s for an unknown id', async () => {
    const res = await app.request
      .patch('/feed/articles/00000000-0000-0000-0000-000000000000')
      .send({ title: 'x' })
    expect(res.status).toBe(404)
  })

  test('PATCH /feed/articles/:postId 404s for a non-article (activity) post', async () => {
    const activityPost = await createFeedPost(getTestUser(), {
      activity_id: null,
      include_chart: false,
      include_map: false,
      included_metrics: [],
      series_metrics: [],
      visibility: 'public',
    })
    const res = await app.request.patch(`/feed/articles/${activityPost.id}`).send({ title: 'nope' })
    expect(res.status).toBe(404)
  })

  test('DELETE /feed/:postId removes an article', async () => {
    const created = await app.request.post('/feed/articles').send(articleBody())
    const del = await app.request.delete(`/feed/${created.body.post.id}`)
    expect(del.status).toBe(200)
    const list = await app.request.get('/feed')
    expect(list.body.posts.map((p: { id: string }) => p.id)).not.toContain(created.body.post.id)
  })

  test('DELETE /feed/:postId hands the post’s quote stamps to the Delete fan-out', async () => {
    const deliver: FeedDeliver = {
      created: vi.fn(),
      createdArticle: vi.fn(),
      createdChallenge: vi.fn(),
      createdDashboard: vi.fn(),
      createdExercise: vi.fn(),
      createdReply: vi.fn(),
      deleted: vi.fn(),
      updated: vi.fn(),
      updatedArticle: vi.fn(),
      updatedChallenge: vi.fn(),
      updatedDashboard: vi.fn(),
      updatedExercise: vi.fn(),
      updatedReply: vi.fn(),
    }
    const spied = startApp(deliver)
    try {
      const user = getTestUser()
      const created = await spied.request.post('/feed/articles').send(articleBody())
      const postId = created.body.post.id as string
      const stamp = await upsertFeedQuoteAuthorization(user, {
        actor_uri: 'https://mastodon.example/users/alice',
        post_id: postId,
        quote_uri: 'https://mastodon.example/users/alice/statuses/1',
        request_uri: null,
      })
      expect((await spied.request.delete(`/feed/${postId}`)).status).toBe(200)
      expect(deliver.deleted).toHaveBeenCalledWith(user, expect.objectContaining({ id: postId }), [stamp])
      expect(await listFeedQuoteAuthorizations(user, postId)).toEqual([])
    } finally {
      await spied.close()
    }
  })

  test('article fan-out: create → createdArticle; generic PATCH /:postId → updatedArticle (not updated)', async () => {
    const deliver: FeedDeliver = {
      created: vi.fn(),
      createdArticle: vi.fn(),
      createdReply: vi.fn(),
      deleted: vi.fn(),
      updated: vi.fn(),
      updatedReply: vi.fn(),
      createdChallenge: vi.fn(),
      updatedArticle: vi.fn(),
      updatedChallenge: vi.fn(),
      createdDashboard: vi.fn(),
      createdExercise: vi.fn(),
      updatedDashboard: vi.fn(),
      updatedExercise: vi.fn(),
    }
    const spied = startApp(deliver)
    try {
      const created = await spied.request.post('/feed/articles').send(articleBody())
      expect(created.status).toBe(200)
      expect(deliver.createdArticle).toHaveBeenCalledTimes(1)

      // The GENERIC patch (not /feed/articles/:postId) on an article must route
      // through `updatedArticle` — `updated` no-ops for a post with no activity.
      const patched = await spied.request
        .patch(`/feed/${created.body.post.id}`)
        .send({ visibility: 'followers' })
      expect(patched.status).toBe(200)
      expect(deliver.updatedArticle).toHaveBeenCalledTimes(1)
      expect(deliver.updated).not.toHaveBeenCalled()
    } finally {
      await spied.close()
    }
  })
})

describe('GET /feed/articles/:postId/export (Reddit/markdown export, C4)', () => {
  let withBase: ReturnType<typeof startApp>
  let noBase: ReturnType<typeof startApp>

  beforeAll(async () => {
    await startTestDb()
    withBase = startApp(undefined, 'https://aurboda.example/api')
    noBase = startApp()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await withBase.close()
    await noBase.close()
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('returns paste-ready markdown linking each block whose image renders (#974)', async () => {
    // Give the chart block real data — the export only links blocks whose image
    // endpoint would actually render (≥ 2 points in the window).
    await insertTimeSeries(getTestUser(), [
      { metric: 'heart_rate', source: 'garmin', time: new Date('2026-07-02T08:00:00Z'), value: 62 },
      { metric: 'heart_rate', source: 'garmin', time: new Date('2026-07-03T08:00:00Z'), value: 58 },
      { metric: 'heart_rate', source: 'garmin', time: new Date('2026-07-04T08:00:00Z'), value: 60 },
    ])
    const created = await withBase.request.post('/feed/articles').send(articleBody())
    const postId = created.body.post.id
    const res = await withBase.request.get(`/feed/articles/${postId}/export`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.markdown).toContain('# A week of sleep and HRV')
    expect(res.body.markdown).toContain('A look at the week.')
    expect(res.body.markdown).toContain(
      `https://aurboda.example/api/public/${getTestUser()}/feed/${postId}/blocks/1/image.png`,
    )
  })

  test('a block whose image would 404 (no data) gets a note instead of a dead link (#974)', async () => {
    const created = await withBase.request.post('/feed/articles').send(articleBody())
    const postId = created.body.post.id
    // Clean DB: the heart_rate window has no samples, so the image endpoint 404s.
    const res = await withBase.request.get(`/feed/articles/${postId}/export`)
    expect(res.status).toBe(200)
    expect(res.body.markdown).not.toContain('image.png')
    expect(res.body.markdown).toContain('*Resting HR — not enough data in this window.*')
  })

  test('links an impact block whose window has a session, and notes one without (#1604)', async () => {
    const user = getTestUser()
    const sessionStart = new Date('2026-07-02T18:00:00Z')
    await insertActivity(user, {
      activity_type: 'meditation',
      end_time: new Date(sessionStart.getTime() + 20 * 60_000),
      source: 'manual',
      start_time: sessionStart,
    })
    await insertTimeSeries(
      user,
      Array.from({ length: 16 }, (_, i) => ({
        metric: 'heart_rate' as const,
        source: 'garmin' as const,
        time: new Date(sessionStart.getTime() + (i * 5 - 30) * 60_000),
        value: 60 + i,
      })),
    )
    const created = await withBase.request.post('/feed/articles').send({
      ...articleBody(),
      blocks: [
        { activity: 'meditation', activity_type: 'activity_type', type: 'impact' },
        { activity: 'yoga', activity_type: 'activity_type', type: 'impact' },
      ],
    })
    const postId = created.body.post.id
    const res = await withBase.request.get(`/feed/articles/${postId}/export`)
    expect(res.status).toBe(200)
    expect(res.body.markdown).toContain(
      `![Impact of meditation](https://aurboda.example/api/public/${user}/feed/${postId}/blocks/0/image.png`,
    )
    expect(res.body.markdown).toContain('*Impact of yoga — not enough data in this window.*')
  })

  test('404s for a non-article post', async () => {
    const activityPost = await createFeedPost(getTestUser(), {
      activity_id: null,
      include_chart: false,
      include_map: false,
      included_metrics: [],
      series_metrics: [],
      visibility: 'public',
    })
    const res = await withBase.request.get(`/feed/articles/${activityPost.id}/export`)
    expect(res.status).toBe(404)
  })

  test('503s when the server has no apiBaseUrl configured', async () => {
    const created = await noBase.request.post('/feed/articles').send(articleBody())
    const res = await noBase.request.get(`/feed/articles/${created.body.post.id}/export`)
    expect(res.status).toBe(503)
  })

  test('400s for a followers-only article (its images need a private token)', async () => {
    const created = await withBase.request
      .post('/feed/articles')
      .send({ ...articleBody(), visibility: 'followers' })
    const res = await withBase.request.get(`/feed/articles/${created.body.post.id}/export`)
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('followers-only')
  })
})

describe('POST /feed/activities/:id/preview (live share preview — #902)', () => {
  let app: ReturnType<typeof startApp>

  beforeAll(async () => {
    await startTestDb()
    app = startApp()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await app.close()
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('returns the EXACT content a share of the same selection would federate', async () => {
    const user = getTestUser()
    const activityId = await insertActivity(user, {
      activity_type: 'running',
      end_time: new Date('2026-08-01T08:30:00Z'),
      source: 'garmin',
      start_time: new Date('2026-08-01T08:00:00Z'),
      title: 'Morning run',
    })
    const selection = { included_metrics: ['duration'], message: 'So good!', visibility: 'public' }

    const preview = await app.request.post(`/feed/activities/${activityId}/preview`).send(selection)
    expect(preview.status).toBe(200)
    expect(preview.body.content).toContain('<strong>Morning run</strong>')
    expect(preview.body.content).toContain('<p>So good!</p>')
    expect(preview.body.metrics).toEqual([expect.objectContaining({ key: 'duration', value: 1800 })])

    // Nothing was created…
    const listBefore = await app.request.get('/feed')
    expect(listBefore.body.posts).toEqual([])

    // …and an actual share of the same selection federates the same content.
    const shared = await app.request.post(`/feed/activities/${activityId}/share`).send(selection)
    expect(shared.status).toBe(200)
    expect(shared.body.post.content).toBe(preview.body.content)
  })

  test('answers 404 for an activity id that is not a uuid (#1536)', async () => {
    const selection = { included_metrics: ['duration'], visibility: 'public' }
    for (const path of ['/feed/activities/null/share', '/feed/activities/null/preview']) {
      const res = await app.request.post(path).send(selection)
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Activity not found', success: false })
    }
  })

  test('404s for an unknown activity', async () => {
    const res = await app.request
      .post('/feed/activities/11111111-2222-4333-8444-555555555555/preview')
      .send({ included_metrics: ['duration'] })
    expect(res.status).toBe(404)
  })
})

describe('POST /feed/challenges (share a challenge — #994)', () => {
  let app: ReturnType<typeof startApp>
  let deliver: FeedDeliver

  beforeAll(async () => {
    await startTestDb()
    deliver = {
      created: vi.fn(),
      createdArticle: vi.fn(),
      createdChallenge: vi.fn(),
      createdReply: vi.fn(),
      deleted: vi.fn(),
      updated: vi.fn(),
      updatedArticle: vi.fn(),
      updatedChallenge: vi.fn(),
      createdDashboard: vi.fn(),
      createdExercise: vi.fn(),
      updatedDashboard: vi.fn(),
      updatedExercise: vi.fn(),
      updatedReply: vi.fn(),
    }
    app = startApp(deliver, undefined, 'https://aurboda.example')
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await app.close()
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    vi.clearAllMocks()
  })

  const spec = {
    activity_type_id: null,
    aggregation: 'sum' as const,
    bucket_size: '1d' as const,
    filter_field: null,
    filter_value: null,
    measure: null,
    pattern: 'steps',
    source_type: 'metric' as const,
    unit: 'steps',
  }

  test('shares one of my own challenges: resolves name + canonical share URL server-side', async () => {
    const user = getTestUser()
    const challenge = await createChallenge(user, {
      announce_winner: true,
      end_ts: new Date('2026-08-31T00:00:00Z'),
      is_public: true,
      name: 'August 10k',
      spec,
      start_ts: new Date('2026-08-01T00:00:00Z'),
      timezone: 'Europe/Stockholm',
    })

    const res = await app.request
      .post('/feed/challenges')
      .send({ challenge_id: challenge.id, message: 'Join me — **daily**!', visibility: 'public' })
    expect(res.status).toBe(200)
    expect(res.body.post.kind).toBe('challenge')
    expect(res.body.post.challenge).toEqual({
      name: 'August 10k',
      url: `https://aurboda.example/u/${user}/${challenge.slug}`,
    })
    expect(res.body.post.message).toBe('Join me — **daily**!')
    expect(deliver.createdChallenge).toHaveBeenCalledTimes(1)
  })

  test('shares a joined (remote) challenge from its stored participation', async () => {
    const user = getTestUser()
    const participation = await createChallengeParticipation(user, {
      challenge_url: 'https://peer.example/u/bob/spring-run',
      end_ts: new Date('2026-08-31T00:00:00Z'),
      host_identity: '@bob@peer.example',
      name: 'Spring run',
      spec,
      start_ts: new Date('2026-08-01T00:00:00Z'),
      timezone: 'UTC',
    })

    const res = await app.request
      .post('/feed/challenges')
      .send({ participation_id: participation.id, visibility: 'followers' })
    expect(res.status).toBe(200)
    expect(res.body.post.challenge).toEqual({
      host_identity: '@bob@peer.example',
      name: 'Spring run',
      url: 'https://peer.example/u/bob/spring-run',
    })
    expect(res.body.post.visibility).toBe('followers')
  })

  test('400s unless exactly one of challenge_id/participation_id is given', async () => {
    const both = await app.request.post('/feed/challenges').send({
      challenge_id: '11111111-2222-4333-8444-555555555555',
      participation_id: '11111111-2222-4333-8444-555555555556',
    })
    expect(both.status).toBe(400)
    const neither = await app.request.post('/feed/challenges').send({})
    expect(neither.status).toBe(400)
  })

  test('404s for an unknown challenge or participation', async () => {
    const c = await app.request
      .post('/feed/challenges')
      .send({ challenge_id: '11111111-2222-4333-8444-555555555555' })
    expect(c.status).toBe(404)
    const p = await app.request
      .post('/feed/challenges')
      .send({ participation_id: '11111111-2222-4333-8444-555555555555' })
    expect(p.status).toBe(404)
  })

  test('a visibility flip via the generic PATCH federates through the challenge path', async () => {
    const user = getTestUser()
    const challenge = await createChallenge(user, {
      announce_winner: true,
      end_ts: new Date('2026-08-31T00:00:00Z'),
      is_public: true,
      name: 'August 10k',
      spec,
      start_ts: new Date('2026-08-01T00:00:00Z'),
      timezone: 'UTC',
    })
    const created = await app.request.post('/feed/challenges').send({ challenge_id: challenge.id })
    const patched = await app.request.patch(`/feed/${created.body.post.id}`).send({ visibility: 'unlisted' })
    expect(patched.status).toBe(200)
    expect(deliver.updatedChallenge).toHaveBeenCalledTimes(1)
    expect(deliver.updated).not.toHaveBeenCalled()
    expect(deliver.updatedArticle).not.toHaveBeenCalled()
  })
})

describe('POST /feed/exercises (share an exercise — #1398)', () => {
  let app: ReturnType<typeof startApp>
  let deliver: FeedDeliver

  beforeAll(async () => {
    await startTestDb()
    deliver = {
      created: vi.fn(),
      createdArticle: vi.fn(),
      createdChallenge: vi.fn(),
      createdDashboard: vi.fn(),
      createdExercise: vi.fn(),
      createdReply: vi.fn(),
      deleted: vi.fn(),
      updated: vi.fn(),
      updatedArticle: vi.fn(),
      updatedChallenge: vi.fn(),
      updatedDashboard: vi.fn(),
      updatedExercise: vi.fn(),
      updatedReply: vi.fn(),
    }
    app = startApp(deliver, undefined, 'https://aurboda.example')
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await app.close()
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    vi.clearAllMocks()
  })

  const insertSessions = async (user: string) => {
    for (const [day, weight] of [
      [1, 60],
      [8, 70],
    ] as const) {
      await insertActivity(user, {
        activity_type: 'strength_training',
        data: { sets: [{ exercise: 'Bench Press', reps: 8, weight }] },
        end_time: new Date(`2026-07-0${day}T09:00:00Z`),
        source: 'gravl',
        start_time: new Date(`2026-07-0${day}T08:00:00Z`),
        title: 'Push day',
      })
    }
  }

  const body = (over: Record<string, unknown> = {}) => ({
    activity_type: 'strength_training',
    field: 'sets.exercise',
    value: 'Bench Press',
    ...over,
  })

  test('shares an unpublished exercise: a snapshot without a link, resolved at read time', async () => {
    const user = getTestUser()
    await insertSessions(user)

    const res = await app.request.post('/feed/exercises').send(body({ message: 'Getting **stronger**' }))
    expect(res.status).toBe(200)
    expect(res.body.post.kind).toBe('exercise')
    expect(res.body.post.exercise).toEqual({
      activity_type: 'strength_training',
      field: 'sets.exercise',
      include_records: true,
      include_sessions: false,
      name: 'Bench Press',
      value: 'Bench Press',
    })
    expect(res.body.post.include_chart).toBe(true)
    expect(res.body.post.visibility).toBe('public')
    expect(res.body.post.content).toContain('<strong>Bench Press</strong>')
    expect(res.body.post.content).toContain('Max weight 70 kg')
    expect(res.body.post.content).toContain('2 sessions since 1 Jul 2026')
    // No link to an exercise page — only the hashtag links.
    expect(res.body.post.content.replaceAll(/<a [^>]*class="mention hashtag"[^>]*>/g, '')).not.toContain(
      '<a ',
    )
    expect(res.body.post.structured).toMatchObject({ kind: 'exercise', name: 'Bench Press' })
    expect(res.body.post.structured.data.done.count).toBe(2)
    expect(res.body.post.structured.data.history).toEqual([])
    expect(deliver.createdExercise).toHaveBeenCalledTimes(1)
  })

  test("links a published exercise's public page under its name, unless the link is declined", async () => {
    const user = getTestUser()
    await insertSessions(user)
    const shared = await createSharedExercise(user, {
      activity_type: 'strength_training',
      field: 'sets.exercise',
      is_public: true,
      name: 'Bench',
      value: 'Bench Press',
    })

    const linked = await app.request.post('/feed/exercises').send(body({ include_sessions: true }))
    expect(linked.status).toBe(200)
    expect(linked.body.post.exercise.name).toBe('Bench')
    expect(linked.body.post.exercise.url).toBe(`https://aurboda.example/u/${user}/${shared.slug}`)
    expect(linked.body.post.content).toContain(`https://aurboda.example/u/${user}/${shared.slug}`)
    expect(linked.body.post.structured.data.history).toHaveLength(2)

    const unlinked = await app.request.post('/feed/exercises').send(body({ include_link: false }))
    expect(unlinked.body.post.exercise.name).toBe('Bench')
    expect(unlinked.body.post.exercise).not.toHaveProperty('url')
  })

  test('400 for a non-categorical item path, 404 for an exercise without sessions', async () => {
    const user = getTestUser()
    await insertSessions(user)
    expect((await app.request.post('/feed/exercises').send(body({ field: 'sets.reps' }))).status).toBe(400)
    const none = await app.request.post('/feed/exercises').send(body({ value: 'Squat' }))
    expect(none.status).toBe(404)
    expect(none.body.error).toBe('No sessions with that exercise')
    expect(deliver.createdExercise).not.toHaveBeenCalled()
  })

  test('the preview returns the Note HTML and structured payload and creates nothing', async () => {
    const user = getTestUser()
    await insertSessions(user)
    const res = await app.request
      .post('/feed/exercises/preview')
      .send(body({ include_chart: false, include_records: false, message: 'Hi' }))
    expect(res.status).toBe(200)
    expect(res.body.content).toContain('<p>Hi</p>')
    expect(res.body.content).not.toContain('Max weight')
    expect(res.body.structured).toMatchObject({ kind: 'exercise', message: 'Hi' })
    expect(res.body.structured.data.records).toEqual([])
    expect(res.body.structured.data.trend).toBeNull()
    expect(res.body.tags).toEqual(['aurboda', 'benchpress'])
    expect(res.body.content).toContain('?tag=benchpress')
    expect((await app.request.get('/feed')).body.posts).toEqual([])

    expect((await app.request.post('/feed/exercises/preview').send(body({ value: 'Squat' }))).status).toBe(
      404,
    )
  })

  test('a visibility flip via the generic PATCH federates through the exercise path', async () => {
    const user = getTestUser()
    await insertSessions(user)
    const created = await app.request.post('/feed/exercises').send(body())
    const patched = await app.request.patch(`/feed/${created.body.post.id}`).send({ visibility: 'unlisted' })
    expect(patched.status).toBe(200)
    expect(patched.body.post.visibility).toBe('unlisted')
    expect(deliver.updatedExercise).toHaveBeenCalledTimes(1)
    expect(deliver.updated).not.toHaveBeenCalled()
  })
})

describe('POST /feed/dashboards (share a dashboard period — #1505)', () => {
  let app: ReturnType<typeof startApp>
  let deliver: FeedDeliver

  beforeAll(async () => {
    await startTestDb()
    deliver = {
      created: vi.fn(),
      createdArticle: vi.fn(),
      createdChallenge: vi.fn(),
      createdDashboard: vi.fn(),
      createdExercise: vi.fn(),
      createdReply: vi.fn(),
      deleted: vi.fn(),
      updated: vi.fn(),
      updatedArticle: vi.fn(),
      updatedChallenge: vi.fn(),
      updatedDashboard: vi.fn(),
      updatedExercise: vi.fn(),
      updatedReply: vi.fn(),
    }
    app = startApp(deliver, undefined, 'https://aurboda.example')
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await app.close()
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    vi.clearAllMocks()
  })

  const periodConfig = {
    period: { granularity: 'month' as const },
    sections: [
      {
        id: 's1',
        title: 'Month',
        type: 'metrics' as const,
        widgets: [
          { config: { metric: 'steps', title: 'Steps' }, id: 'w1', type: 'metric_card' as const },
          { config: { href: '/settings', label: 'Settings' }, id: 'w2', type: 'quick_link' as const },
        ],
      },
    ],
    version: 1 as const,
  }

  const share = (isPrivate = false) =>
    createSharedDashboard(getTestUser(), {
      config: periodConfig,
      is_private: isPrivate,
      is_public: false,
      name: 'Month in data',
    })

  test('shares a finished period: the config snapshot, the link, and the period resolved at read time', async () => {
    const user = getTestUser()
    const dashboard = await share()
    const res = await app.request
      .post('/feed/dashboards')
      .send({ dashboard_id: dashboard.id, message: 'A **good** month', period: '2026-10' })
    expect(res.status).toBe(200)
    expect(res.body.post.kind).toBe('dashboard')
    expect(res.body.post.dashboard).toMatchObject({
      dashboard_id: dashboard.id,
      include_link: true,
      name: 'Month in data',
      period: '2026-10',
      url: `https://aurboda.example/u/${user}/${dashboard.slug}`,
    })
    expect(res.body.post.dashboard.config.sections[0].widgets[1].config.href).toBe('#')
    expect(res.body.post.include_chart).toBe(false)
    expect(res.body.post.tags).toEqual(['aurboda', 'monthindata'])
    expect(res.body.post.content).toContain('<strong>Month in data</strong> · October 2026')
    expect(res.body.post.content).toContain('<strong>good</strong>')
    expect(res.body.post.content).toContain(`https://aurboda.example/u/${user}/${dashboard.slug}`)
    expect(res.body.post.structured).toMatchObject({
      kind: 'dashboard',
      message: 'A **good** month',
      name: 'Month in data',
      period: '2026-10',
      window: { end: '2026-11-01T00:00:00.000Z', start: '2026-10-01T00:00:00.000Z' },
    })
    expect(Object.keys(res.body.post.structured.widget_data).sort()).toEqual(['w1', 'w2'])
    expect(deliver.createdDashboard).toHaveBeenCalledTimes(1)
  })

  test('a private dashboard or a declined link carries no url', async () => {
    const privateDashboard = await share(true)
    const unpublished = await app.request
      .post('/feed/dashboards')
      .send({ dashboard_id: privateDashboard.id, period: '2026-10' })
    expect(unpublished.status).toBe(200)
    expect(unpublished.body.post.dashboard).not.toHaveProperty('url')

    const published = await share()
    const declined = await app.request
      .post('/feed/dashboards')
      .send({ dashboard_id: published.id, include_link: false, period: '2026-10' })
    expect(declined.body.post.dashboard).not.toHaveProperty('url')
  })

  test('404 for an unknown dashboard; 400 for a rolling home dashboard, another granularity or an unfinished period', async () => {
    const missing = await app.request
      .post('/feed/dashboards')
      .send({ dashboard_id: '00000000-0000-4000-8000-000000000000', period: '2026-10' })
    expect(missing.status).toBe(404)
    expect(missing.body.error).toBe('Dashboard not found')

    const home = await app.request.post('/feed/dashboards').send({ period: '2026-10' })
    expect(home.status).toBe(400)
    expect(home.body.error).toBe('Not a period dashboard')

    const dashboard = await share()
    const week = await app.request
      .post('/feed/dashboards')
      .send({ dashboard_id: dashboard.id, period: '2026-W44' })
    expect(week.status).toBe(400)
    const future = await app.request
      .post('/feed/dashboards')
      .send({ dashboard_id: dashboard.id, period: '2099-01' })
    expect(future.status).toBe(400)
    expect(future.body.error).toBe('The period is not finished yet')

    expect((await app.request.post('/feed/dashboards').send({ period: 'October' })).status).toBe(400)
    expect(deliver.createdDashboard).not.toHaveBeenCalled()
  })

  test('the preview returns the Note HTML, structured payload and tags and creates nothing', async () => {
    const dashboard = await share()
    const res = await app.request
      .post('/feed/dashboards/preview')
      .send({ dashboard_id: dashboard.id, message: 'Hi', period: '2026-10' })
    expect(res.status).toBe(200)
    expect(res.body.content).toContain('<p>Hi</p>')
    expect(res.body.structured).toMatchObject({ kind: 'dashboard', message: 'Hi', period: '2026-10' })
    expect(res.body.tags).toEqual(['aurboda', 'monthindata'])
    expect((await app.request.get('/feed')).body.posts).toEqual([])
    expect(
      (
        await app.request
          .post('/feed/dashboards/preview')
          .send({ dashboard_id: dashboard.id, period: '2099-01' })
      ).status,
    ).toBe(400)
  })

  test('a visibility flip via the generic PATCH federates through the dashboard path', async () => {
    const dashboard = await share()
    const created = await app.request
      .post('/feed/dashboards')
      .send({ dashboard_id: dashboard.id, period: '2026-10' })
    const patched = await app.request.patch(`/feed/${created.body.post.id}`).send({ visibility: 'unlisted' })
    expect(patched.status).toBe(200)
    expect(patched.body.post.visibility).toBe('unlisted')
    expect(deliver.updatedDashboard).toHaveBeenCalledTimes(1)
    expect(deliver.updated).not.toHaveBeenCalled()
  })
})

describe('Feed post reactions (integration)', () => {
  let app: ReturnType<typeof startApp>

  const post = () =>
    createFeedPost(getTestUser(), {
      activity_id: null,
      include_chart: false,
      include_map: false,
      included_metrics: [],
      series_metrics: [],
      visibility: 'public',
    })

  beforeAll(async () => {
    await startTestDb()
    app = startApp()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await app.close()
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('GET /feed/:postId/reactions lists who liked and boosted, newest first', async () => {
    const user = getTestUser()
    const created = await post()
    await upsertFeedPostReaction(user, {
      actor_uri: 'https://mastodon.example/users/alice',
      display_name: 'Alice',
      handle: '@alice@mastodon.example',
      kind: 'like',
      post_id: created.id,
    })
    await upsertFeedPostReaction(user, {
      actor_uri: 'https://remote.example/users/bob',
      handle: '@bob@remote.example',
      kind: 'announce',
      post_id: created.id,
    })

    const res = await app.request.get(`/feed/${created.id}/reactions`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.reactions).toHaveLength(2)
    expect(res.body.reactions.map((r: { kind: string }) => r.kind).sort()).toEqual(['announce', 'like'])
    // Internal bookkeeping never reaches the wire.
    expect(res.body.reactions[0]).not.toHaveProperty('post_id')
  })

  test('GET /feed/:postId/reactions lists an approved quote as kind `quote` with the quoting post url', async () => {
    const user = getTestUser()
    const created = await post()
    await upsertFeedPostReaction(user, {
      actor_uri: 'https://mastodon.example/users/alice',
      handle: '@alice@mastodon.example',
      kind: 'like',
      post_id: created.id,
    })
    await upsertFeedQuoteAuthorization(user, {
      actor_uri: 'https://mastodon.example/users/alice',
      post_id: created.id,
      quote_uri: 'https://mastodon.example/users/alice/statuses/7',
      request_uri: null,
    })

    const res = await app.request.get(`/feed/${created.id}/reactions`)
    expect(res.status).toBe(200)
    expect(res.body.reactions[0]).toMatchObject({
      actor_uri: 'https://mastodon.example/users/alice',
      handle: '@alice@mastodon.example',
      kind: 'quote',
      url: 'https://mastodon.example/users/alice/statuses/7',
    })
    expect(res.body.reactions[1]).toMatchObject({ kind: 'like' })
    expect(res.body.reactions[1]).not.toHaveProperty('url')
  })

  test('GET /feed/:postId/reactions 404s an unknown or non-UUID post id', async () => {
    expect((await app.request.get('/feed/00000000-0000-0000-0000-000000000000/reactions')).status).toBe(404)
    expect((await app.request.get('/feed/not-a-uuid/reactions')).status).toBe(404)
  })

  test('GET /feed attaches like_count / boost_count / quote_count to the listing', async () => {
    const user = getTestUser()
    const counted = await post()
    const uncounted = await post()
    await upsertFeedPostReaction(user, {
      actor_uri: 'https://mastodon.example/users/alice',
      kind: 'like',
      post_id: counted.id,
    })
    await upsertFeedPostReaction(user, {
      actor_uri: 'https://remote.example/users/bob',
      kind: 'like',
      post_id: counted.id,
    })
    await upsertFeedQuoteAuthorization(user, {
      actor_uri: 'https://remote.example/users/bob',
      post_id: counted.id,
      quote_uri: 'https://remote.example/users/bob/statuses/1',
      request_uri: null,
    })

    const res = await app.request.get('/feed')
    const byId = Object.fromEntries(
      res.body.posts.map(
        (p: { id: string; like_count: number; boost_count: number; quote_count: number }) => [
          p.id,
          { boost: p.boost_count, like: p.like_count, quote: p.quote_count },
        ],
      ),
    )
    expect(byId[counted.id]).toEqual({ boost: 0, like: 2, quote: 1 })
    expect(byId[uncounted.id]).toEqual({ boost: 0, like: 0, quote: 0 })
  })
})

describe('Own-post comments (GET /feed/:postId/replies + reply_count)', () => {
  const WEB_HOST = 'https://aurboda.example'
  let app: ReturnType<typeof startApp>

  beforeAll(async () => {
    await startTestDb()
    app = startApp(undefined, undefined, WEB_HOST)
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await app.close()
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  const ownPost = async () => {
    const user = getTestUser()
    const post = await createFeedPost(user, {
      activity_id: null,
      include_chart: false,
      include_map: false,
      included_metrics: [],
      series_metrics: [],
      visibility: 'public',
    })
    return { objectUri: `${WEB_HOST}/users/${user}/feed/${post.id}`, post, user }
  }

  const comment = (objectUri: string, n: number) =>
    upsertTimelineEntry(getTestUser(), {
      actor_uri: 'https://mastodon.example/users/alice',
      content: `<p>comment ${n}</p>`,
      display_name: 'Alice',
      handle: '@alice@mastodon.example',
      in_reply_to_uri: objectUri,
      object_uri: `https://mastodon.example/notes/c${n}`,
      published_at: new Date(`2026-07-0${n}T10:00:00Z`),
    })

  test('lists the received comments oldest-first as full timeline entries', async () => {
    const { objectUri, post } = await ownPost()
    await comment(objectUri, 2)
    await comment(objectUri, 1)
    // A reply to somebody ELSE's post must never appear here.
    await comment('https://mastodon.example/notes/other', 3)

    const res = await app.request.get(`/feed/${post.id}/replies`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.replies.map((r: { content: string }) => r.content)).toEqual([
      '<p>comment 1</p>',
      '<p>comment 2</p>',
    ])
    // Full entries: repliable by their own local id, and marked as replies to us.
    expect(res.body.replies[0].id).toEqual(expect.any(String))
    expect(res.body.replies[0].in_reply_to_mine).toBe(true)
  })

  test('is an empty list for a post nobody commented on', async () => {
    const { post } = await ownPost()
    const res = await app.request.get(`/feed/${post.id}/replies`)
    expect(res.status).toBe(200)
    expect(res.body.replies).toEqual([])
  })

  test('404s an unknown or non-UUID post id', async () => {
    expect((await app.request.get('/feed/not-a-uuid/replies')).status).toBe(404)
    expect((await app.request.get('/feed/00000000-0000-4000-8000-000000000000/replies')).status).toBe(404)
  })

  test('GET /feed attaches reply_count per post', async () => {
    const first = await ownPost()
    const second = await ownPost()
    await comment(first.objectUri, 1)
    await comment(first.objectUri, 2)

    const res = await app.request.get('/feed')
    expect(res.status).toBe(200)
    const counts = new Map(
      res.body.posts.map((p: { id: string; reply_count: number }) => [p.id, p.reply_count]),
    )
    expect(counts.get(first.post.id)).toBe(2)
    expect(counts.get(second.post.id)).toBe(0)
  })
})

describe('Article drafts (/feed/article-drafts)', () => {
  const MISSING = '00000000-0000-0000-0000-000000000000'
  const spyDeliver = (): FeedDeliver => ({
    created: vi.fn(),
    createdArticle: vi.fn(),
    createdChallenge: vi.fn(),
    createdDashboard: vi.fn(),
    createdExercise: vi.fn(),
    createdReply: vi.fn(),
    deleted: vi.fn(),
    updated: vi.fn(),
    updatedArticle: vi.fn(),
    updatedChallenge: vi.fn(),
    updatedDashboard: vi.fn(),
    updatedExercise: vi.fn(),
    updatedReply: vi.fn(),
  })
  const draftArticle = () => ({
    blocks: [
      { markdown: 'Work in progress', type: 'prose' },
      { metric: 'heart_rate', type: 'chart' },
    ],
    default_end: '2026-07-07T00:00:00.000Z',
    default_start: '2026-07-01T00:00:00.000Z',
    title: 'Draft title',
  })

  let deliver: FeedDeliver
  let app: ReturnType<typeof startApp>

  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    deliver = spyDeliver()
    app = startApp(deliver)
  })

  afterEach(async () => {
    await app.close()
  })

  test('POST with no body starts an empty, untitled public draft', async () => {
    const res = await app.request.post('/feed/article-drafts').send({})
    expect(res.status).toBe(200)
    expect(res.body.draft.article).toEqual({ blocks: [], title: '' })
    expect(res.body.draft.visibility).toBe('public')
    expect(res.body.draft.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('saves an incomplete draft (no title, chart without metric, half a correlation)', async () => {
    const article = {
      blocks: [{ type: 'chart' }, { outcome: { kind: 'metric', metric: 'hrv' }, type: 'correlation' }],
      title: '',
    }
    const res = await app.request.post('/feed/article-drafts').send({ article, visibility: 'followers' })
    expect(res.status).toBe(200)
    expect(res.body.draft.article).toEqual(article)

    const fetched = await app.request.get(`/feed/article-drafts/${res.body.draft.id}`)
    expect(fetched.status).toBe(200)
    expect(fetched.body.draft).toEqual(res.body.draft)
  })

  test('lists drafts most recently saved first', async () => {
    const first = await app.request
      .post('/feed/article-drafts')
      .send({ article: { ...draftArticle(), title: 'A' } })
    const second = await app.request
      .post('/feed/article-drafts')
      .send({ article: { ...draftArticle(), title: 'B' } })
    await app.request.patch(`/feed/article-drafts/${first.body.draft.id}`).send({ title: 'A2' })

    const res = await app.request.get('/feed/article-drafts')
    expect(res.status).toBe(200)
    expect(res.body.drafts.map((d: { id: string }) => d.id)).toEqual([
      first.body.draft.id,
      second.body.draft.id,
    ])
  })

  test('PATCH replaces only the provided fields', async () => {
    const created = await app.request.post('/feed/article-drafts').send({ article: draftArticle() })
    const res = await app.request
      .patch(`/feed/article-drafts/${created.body.draft.id}`)
      .send({ blocks: [{ markdown: 'Rewritten', type: 'prose' }], visibility: 'unlisted' })
    expect(res.status).toBe(200)
    expect(res.body.draft.article).toEqual({
      ...draftArticle(),
      blocks: [{ markdown: 'Rewritten', type: 'prose' }],
    })
    expect(res.body.draft.visibility).toBe('unlisted')
  })

  test('PATCH with a null default window bound clears it; an omitted one is kept', async () => {
    const created = await app.request.post('/feed/article-drafts').send({ article: draftArticle() })
    const id = created.body.draft.id

    const cleared = await app.request.patch(`/feed/article-drafts/${id}`).send({ default_start: null })
    expect(cleared.status).toBe(200)
    expect(cleared.body.draft.article).not.toHaveProperty('default_start')
    expect(cleared.body.draft.article.default_end).toBe('2026-07-07T00:00:00.000Z')

    const fetched = await app.request.get(`/feed/article-drafts/${id}`)
    expect(fetched.body.draft.article).not.toHaveProperty('default_start')
  })

  test('GET, PATCH, DELETE and publish 404 an unknown or non-UUID id', async () => {
    for (const id of [MISSING, 'not-a-uuid']) {
      expect((await app.request.get(`/feed/article-drafts/${id}`)).status).toBe(404)
      expect((await app.request.patch(`/feed/article-drafts/${id}`).send({ title: 'x' })).status).toBe(404)
      expect((await app.request.delete(`/feed/article-drafts/${id}`)).status).toBe(404)
      expect((await app.request.post(`/feed/article-drafts/${id}/publish`).send({})).status).toBe(404)
    }
  })

  test('DELETE removes the draft', async () => {
    const created = await app.request.post('/feed/article-drafts').send({ article: draftArticle() })
    const del = await app.request.delete(`/feed/article-drafts/${created.body.draft.id}`)
    expect(del.status).toBe(200)
    expect(del.body.success).toBe(true)
    expect((await app.request.get('/feed/article-drafts')).body.drafts).toEqual([])
  })

  test('a draft never appears in the feed listing and is never delivered', async () => {
    await app.request.post('/feed/article-drafts').send({ article: draftArticle() })
    const feed = await app.request.get('/feed')
    expect(feed.body.posts).toEqual([])
    expect(deliver.createdArticle).not.toHaveBeenCalled()
  })

  test('publish creates the article post, federates it and deletes the draft', async () => {
    const created = await app.request
      .post('/feed/article-drafts')
      .send({ article: draftArticle(), visibility: 'followers' })
    const res = await app.request.post(`/feed/article-drafts/${created.body.draft.id}/publish`).send({})
    expect(res.status).toBe(200)
    expect(res.body.post.kind).toBe('article')
    expect(res.body.post.article.title).toBe('Draft title')
    expect(res.body.post.visibility).toBe('followers')
    expect(deliver.createdArticle).toHaveBeenCalledTimes(1)

    expect((await app.request.get(`/feed/article-drafts/${created.body.draft.id}`)).status).toBe(404)
    const feed = await app.request.get('/feed')
    expect(feed.body.posts.map((p: { id: string }) => p.id)).toEqual([res.body.post.id])
  })

  test('publish takes a visibility override', async () => {
    const created = await app.request.post('/feed/article-drafts').send({ article: draftArticle() })
    const res = await app.request
      .post(`/feed/article-drafts/${created.body.draft.id}/publish`)
      .send({ visibility: 'unlisted' })
    expect(res.body.post.visibility).toBe('unlisted')
  })

  test('publishing a draft whose impact block has no activity is a 400', async () => {
    const created = await app.request.post('/feed/article-drafts').send({
      article: { ...draftArticle(), blocks: [{ activity_type: 'activity_type', type: 'impact' }] },
    })
    expect(created.status).toBe(200)
    const res = await app.request.post(`/feed/article-drafts/${created.body.draft.id}/publish`).send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Impact block 1 has no activity — pick one before publishing.')
  })

  test('publishing an incomplete draft is a 400 and keeps the draft', async () => {
    const created = await app.request
      .post('/feed/article-drafts')
      .send({ article: { ...draftArticle(), default_end: undefined, default_start: undefined } })
    const res = await app.request.post(`/feed/article-drafts/${created.body.draft.id}/publish`).send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('no time window')
    expect(deliver.createdArticle).not.toHaveBeenCalled()
    expect((await app.request.get(`/feed/article-drafts/${created.body.draft.id}`)).status).toBe(200)
    expect((await app.request.get('/feed')).body.posts).toEqual([])
  })
})

describe('Hashtags on feed posts', () => {
  const WEB = 'https://aurboda.example'
  let app: ReturnType<typeof startApp>

  beforeAll(async () => {
    await startTestDb()
    app = startApp(undefined, undefined, WEB)
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await app.close()
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  const insertRun = (user: string) =>
    insertActivity(user, {
      activity_type: 'running',
      end_time: new Date('2026-08-01T08:30:00Z'),
      source: 'garmin',
      start_time: new Date('2026-08-01T08:00:00Z'),
      title: 'Morning run',
    })

  test('an activity share gets #aurboda, its type and typed tags; the preview says the same', async () => {
    const user = getTestUser()
    const activityId = await insertRun(user)
    const selection = { included_metrics: ['duration'], message: 'Easy #Zone2', visibility: 'public' }

    const preview = await app.request.post(`/feed/activities/${activityId}/preview`).send(selection)
    expect(preview.body.tags).toEqual(['aurboda', 'running', 'zone2'])
    expect(preview.body.content).toContain(
      `<a href="${WEB}/u/${user}?tag=zone2" class="mention hashtag" rel="tag">#<span>Zone2</span></a>`,
    )

    const shared = await app.request.post(`/feed/activities/${activityId}/share`).send(selection)
    expect(shared.body.post.tags).toEqual(['aurboda', 'running', 'zone2'])
    expect(shared.body.post.content).toBe(preview.body.content)
  })

  test('explicit tags replace the automatic ones; edits keep or swap them', async () => {
    const user = getTestUser()
    const activityId = await insertRun(user)
    const shared = await app.request
      .post(`/feed/activities/${activityId}/share`)
      .send({ message: 'with #friends', tags: ['#Mine'], visibility: 'public' })
    expect(shared.status).toBe(200)
    const id = shared.body.post.id
    expect(shared.body.post.tags).toEqual(['mine', 'friends'])

    const visibilityOnly = await app.request.patch(`/feed/${id}`).send({ visibility: 'unlisted' })
    expect(visibilityOnly.body.post.tags).toEqual(['mine', 'friends'])

    const newMessage = await app.request.patch(`/feed/${id}`).send({ message: 'solo #longrun' })
    expect(newMessage.body.post.tags).toEqual(['mine', 'longrun'])

    const retagged = await app.request.patch(`/feed/${id}`).send({ tags: ['aurboda'] })
    expect(retagged.body.post.tags).toEqual(['aurboda', 'longrun'])
  })

  test('rejects an invalid tag', async () => {
    const activityId = await insertRun(getTestUser())
    const res = await app.request
      .post(`/feed/activities/${activityId}/share`)
      .send({ tags: ['not a tag'], visibility: 'public' })
    expect(res.status).toBe(400)
  })

  test('an article gets the default tags plus those typed in its title and prose', async () => {
    const created = await app.request.post('/feed/articles').send({ ...articleBody(), title: 'Week #QS' })
    expect(created.body.post.tags).toEqual(['aurboda', 'qs'])
    const edited = await app.request
      .patch(`/feed/articles/${created.body.post.id}`)
      .send({ title: 'Week #sleep' })
    expect(edited.body.post.tags).toEqual(['aurboda', 'sleep'])
  })

  test('a draft keeps its tags and its published article gets them', async () => {
    const created = await app.request
      .post('/feed/article-drafts')
      .send({ article: { ...articleBody(), tags: ['#Sleep'] } })
    expect(created.body.draft.article.tags).toEqual(['sleep'])
    const id = created.body.draft.id
    const kept = await app.request.patch(`/feed/article-drafts/${id}`).send({ title: 'New title #hrv' })
    expect(kept.body.draft.article.tags).toEqual(['sleep'])
    const published = await app.request.post(`/feed/article-drafts/${id}/publish`).send({})
    expect(published.body.post.tags).toEqual(['sleep', 'hrv'])

    const other = await app.request
      .post('/feed/article-drafts')
      .send({ article: { ...articleBody(), tags: ['x'] } })
    const cleared = await app.request
      .patch(`/feed/article-drafts/${other.body.draft.id}`)
      .send({ tags: null })
    expect(cleared.body.draft.article.tags).toBeUndefined()
  })

  test('a challenge share gets #challenge', async () => {
    const user = getTestUser()
    const participation = await createChallengeParticipation(user, {
      challenge_url: 'https://peer.example/u/bob/spring-run',
      end_ts: new Date('2026-08-31T00:00:00Z'),
      host_identity: '@bob@peer.example',
      name: 'Spring run',
      spec: {
        activity_type_id: null,
        aggregation: 'sum',
        bucket_size: '1d',
        filter_field: null,
        filter_value: null,
        measure: null,
        pattern: 'steps',
        source_type: 'metric',
        unit: 'steps',
      },
      start_ts: new Date('2026-08-01T00:00:00Z'),
      timezone: 'UTC',
    })
    const res = await app.request.post('/feed/challenges').send({ participation_id: participation.id })
    expect(res.body.post.tags).toEqual(['aurboda', 'challenge'])
  })
})

describe('Article challenge blocks (#1484)', () => {
  const WEB = 'https://aurboda.example'
  let app: ReturnType<typeof startApp>

  beforeAll(async () => {
    await startTestDb()
    configureStructuredChallenge({ apiBaseUrl: `${WEB}/api`, webHost: WEB })
    app = startApp(undefined, undefined, WEB)
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await app.close()
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  const ownChallenge = async () => {
    const user = getTestUser()
    const challenge = await createChallenge(user, {
      announce_winner: true,
      end_ts: new Date('2026-08-31T00:00:00Z'),
      is_public: true,
      name: 'August 10k',
      spec: {
        activity_type_id: null,
        aggregation: 'sum',
        bucket_size: '1d',
        filter_field: null,
        filter_value: null,
        measure: null,
        pattern: 'steps',
        source_type: 'metric',
        unit: 'steps',
      },
      start_ts: new Date('2026-08-01T00:00:00Z'),
      timezone: 'UTC',
    })
    return { challenge, url: `${WEB}/u/${user}/${challenge.slug}` }
  }

  const challengeArticle = (challenge_url: string) => ({
    blocks: [{ challenge_url, type: 'challenge' }],
    title: 'Join me',
    visibility: 'public',
  })

  test('stores the challenge URL canonically, on articles and drafts', async () => {
    const { url } = await ownChallenge()

    const created = await app.request.post('/feed/articles').send(challengeArticle(`${url}?ref=x#frag`))
    expect(created.status).toBe(200)
    expect(created.body.post.article.blocks).toEqual([{ challenge_url: url, type: 'challenge' }])

    const draft = await app.request
      .post('/feed/article-drafts')
      .send({ article: { blocks: [{ challenge_url: `${url}/?ref=x`, type: 'challenge' }], title: '' } })
    expect(draft.body.draft.article.blocks).toEqual([{ challenge_url: url, type: 'challenge' }])
  })

  test('an article whose challenge was deleted can still be edited', async () => {
    const user = getTestUser()
    const { challenge, url } = await ownChallenge()
    const created = await app.request.post('/feed/articles').send(challengeArticle(url))
    expect(created.status).toBe(200)
    expect(await deleteChallenge(user, challenge.id)).toBe(true)

    const res = await app.request
      .patch(`/feed/articles/${created.body.post.id}`)
      .send({ title: 'Typo fixed' })
    expect(res.status).toBe(200)
    expect(res.body.post.article.title).toBe('Typo fixed')
  })

  test('adding a block with an unknown local challenge still fails', async () => {
    const user = getTestUser()
    const { url } = await ownChallenge()
    const created = await app.request.post('/feed/articles').send(challengeArticle(url))

    const res = await app.request.patch(`/feed/articles/${created.body.post.id}`).send({
      blocks: [
        { challenge_url: url, type: 'challenge' },
        { challenge_url: `${WEB}/u/${user}/no-such-challenge`, type: 'challenge' },
      ],
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Block 2: challenge not found.')
  })
})

describe('Article preview (POST /feed/articles/preview)', () => {
  const WEB_HOST = 'https://aurboda.example'
  const chartDeps = {
    getArticleChartSeries: async () => [],
    getArticleImpact: vi.fn(),
    getChallengeRaceByUrl: async () => null,
    getCorrelationScatter: async () => null,
  }
  let app: ReturnType<typeof startApp>

  beforeAll(async () => {
    await startTestDb()
    app = startApp(undefined, undefined, WEB_HOST, createArticlePreviewer({ chartDeps, webHost: WEB_HOST }))
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await app.close()
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('previews a simple draft and creates no post and no draft', async () => {
    const res = await app.request.post('/feed/articles/preview').send({
      article: {
        blocks: [
          { markdown: 'Morning coffee, then #yoga.', type: 'prose' },
          { metric: 'heart_rate', type: 'chart' },
        ],
        title: 'Coffee and yoga',
      },
    })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.name).toBe('Coffee and yoga')
    expect(res.body.content).toContain('<p><strong>Coffee and yoga</strong></p>')
    expect(res.body.content).toContain('Morning coffee')
    expect(res.body.tags).toContain('yoga')
    expect(res.body.attachments).toEqual([])
    expect(res.body.publish_error).toMatch(/^Chart block 2 /)
    expect(res.body.mastodon.content).toContain('#<span>yoga</span>')

    expect((await app.request.get('/feed')).body.posts).toEqual([])
    expect((await app.request.get('/feed/article-drafts')).body.drafts).toEqual([])
  })

  test('rejects a body without an article', async () => {
    expect((await app.request.post('/feed/articles/preview').send({})).status).toBe(400)
  })

  test('requires authentication', async () => {
    const unauthenticated = express()
    unauthenticated.use(express.json())
    const deny: RequestHandler = (_req, res) => {
      res.status(401).json({ error: 'Unauthorized', success: false })
    }
    unauthenticated.use('/feed', createFeedRouter(deny))
    const res = await supertest(unauthenticated)
      .post('/feed/articles/preview')
      .send({ article: { blocks: [], title: 'x' } })
    expect(res.status).toBe(401)
  })
})
