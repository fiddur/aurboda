import { MAX_FEED_IMAGE_BYTES, MAX_FEED_IMAGES_PER_ACCOUNT } from '@aurboda/api-spec'
import express from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import type { FeedImageRecord } from '../db/index.ts'

import { createFeedImagesRouter, type FeedImagesRouterDeps } from './feed-images-router.ts'

const API = 'https://aurboda.test/api'

const record: FeedImageRecord = {
  byte_size: 1234,
  content_type: 'image/webp',
  created_at: new Date('2026-11-01T08:00:00Z'),
  height: 600,
  id: '1b4e28ba-2fa1-41d2-883f-0016d3cca427',
  width: 800,
}

const serialized = {
  byte_size: 1234,
  created_at: '2026-11-01T08:00:00.000Z',
  height: 600,
  id: record.id,
  url: `${API}/public/alice/images/${record.id}.webp`,
  width: 800,
}

const buildApp = (overrides: Partial<FeedImagesRouterDeps> = {}) => {
  const deps: FeedImagesRouterDeps = {
    addFeedImage: vi.fn(async () => ({ image: record, ok: true as const })),
    deleteFeedImage: vi.fn(async () => true),
    listFeedImages: vi.fn(async () => [record]),
    ...overrides,
  }
  const auth: express.RequestHandler = (req, res, next) => {
    if (req.headers.authorization !== 'Bearer ok') {
      res.status(401).json({ error: 'Unauthorized', success: false })
      return
    }
    req.user = 'alice'
    next()
  }
  const app = express()
  app.use('/feed/images', createFeedImagesRouter(auth, API, deps))
  return { app, deps }
}

const post = (app: express.Express) => supertest(app).post('/feed/images').set('Authorization', 'Bearer ok')

describe('POST /feed/images', () => {
  test('stores the picture and answers 201 with it', async () => {
    const { app, deps } = buildApp()
    const res = await post(app).attach('image', Buffer.from('png-bytes'), {
      contentType: 'image/png',
      filename: 'coffee.png',
    })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ image: serialized, success: true })
    expect(deps.addFeedImage).toHaveBeenCalledWith('alice', Buffer.from('png-bytes'))
  })

  test('400 without a file', async () => {
    const { app } = buildApp()
    const res = await post(app)
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'No file uploaded', success: false })
  })

  test('415 for a claimed type outside the allowed ones, without storing', async () => {
    const { app, deps } = buildApp()
    const res = await post(app).attach('image', Buffer.from('<svg/>'), {
      contentType: 'image/svg+xml',
      filename: 'yoga.svg',
    })
    expect(res.status).toBe(415)
    expect(res.body.error).toBe('That is not a picture Aurboda can use. PNG, JPEG, WebP or GIF works.')
    expect(deps.addFeedImage).not.toHaveBeenCalled()
  })

  test('415 when the bytes are refused', async () => {
    const { app } = buildApp({
      addFeedImage: vi.fn(async () => ({ ok: false as const, reason: 'unsupported' as const })),
    })
    const res = await post(app).attach('image', Buffer.from('<svg/>'), {
      contentType: 'image/png',
      filename: 'yoga.png',
    })
    expect(res.status).toBe(415)
    expect(res.body.error).toBe('That is not a picture Aurboda can use. PNG, JPEG, WebP or GIF works.')
  })

  test('409 at the cap', async () => {
    const { app } = buildApp({
      addFeedImage: vi.fn(async () => ({ ok: false as const, reason: 'limit' as const })),
    })
    const res = await post(app).attach('image', Buffer.from('png-bytes'), {
      contentType: 'image/png',
      filename: 'running.png',
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe(
      `You have stored as many pictures as one account may hold (${MAX_FEED_IMAGES_PER_ACCOUNT}). Delete some first.`,
    )
  })

  test('413 over the size limit', async () => {
    const { app, deps } = buildApp()
    const res = await post(app).attach('image', Buffer.alloc(MAX_FEED_IMAGE_BYTES + 1), {
      contentType: 'image/png',
      filename: 'meditation.png',
    })
    expect(res.status).toBe(413)
    expect(res.body).toEqual({ error: 'That picture is too large to send.', success: false })
    expect(deps.addFeedImage).not.toHaveBeenCalled()
  })

  test('401 without authentication', async () => {
    const { app, deps } = buildApp()
    const res = await supertest(app)
      .post('/feed/images')
      .attach('image', Buffer.from('png-bytes'), { contentType: 'image/png', filename: 'coffee.png' })
    expect(res.status).toBe(401)
    expect(deps.addFeedImage).not.toHaveBeenCalled()
  })
})

describe('GET /feed/images', () => {
  test('lists the pictures with the cap', async () => {
    const { app } = buildApp()
    const res = await supertest(app).get('/feed/images').set('Authorization', 'Bearer ok')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ images: [serialized], limit: MAX_FEED_IMAGES_PER_ACCOUNT, success: true })
  })

  test('401 without authentication', async () => {
    const { app } = buildApp()
    expect((await supertest(app).get('/feed/images')).status).toBe(401)
  })
})

describe('DELETE /feed/images/:id', () => {
  test('deletes the picture', async () => {
    const { app, deps } = buildApp()
    const res = await supertest(app).delete(`/feed/images/${record.id}`).set('Authorization', 'Bearer ok')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(deps.deleteFeedImage).toHaveBeenCalledWith('alice', record.id)
  })

  test('404 for a missing picture', async () => {
    const { app } = buildApp({ deleteFeedImage: vi.fn(async () => false) })
    const res = await supertest(app).delete(`/feed/images/${record.id}`).set('Authorization', 'Bearer ok')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Picture not found', success: false })
  })

  test('401 without authentication', async () => {
    const { app } = buildApp()
    expect((await supertest(app).delete(`/feed/images/${record.id}`)).status).toBe(401)
  })
})
