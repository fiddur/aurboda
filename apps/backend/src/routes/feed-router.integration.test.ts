import type { RequestHandler } from 'express'
import type { AddressInfo } from 'node:net'

import express from 'express'
import supertest from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

/**
 * Integration test for the owner-facing article routes on the feed router
 * (`POST /feed/articles`, `PATCH /feed/articles/:postId`) against a live
 * database — the route + `buildArticleContent`/`mergeArticleContent` service +
 * serializer composition over the already-unit-tested pieces. Federation is a
 * later slice, so no `deliver` is wired here.
 */
import { createFeedPost } from '../db/feed.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { createFeedRouter } from './feed-router.ts'

const CONTAINER_TIMEOUT = 120_000

const auth: RequestHandler = (req, _res, next) => {
  req.user = getTestUser()
  next()
}

const startApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/feed', createFeedRouter(auth))
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
})
