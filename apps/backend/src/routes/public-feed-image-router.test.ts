import express from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import { createPublicFeedImageRouter, type PublicFeedImageDeps } from './public-feed-image-router.ts'

const ID = '1b4e28ba-2fa1-41d2-883f-0016d3cca427'
const stored = { content_type: 'image/webp', data: Buffer.from('webp-bytes') }

const buildApp = (getImage: PublicFeedImageDeps['getImage'] = vi.fn(async () => stored)) => {
  const app = express()
  app.use(createPublicFeedImageRouter({ getImage }))
  return { app, getImage }
}

describe('GET /public/:username/images/:id.webp', () => {
  test('serves the stored picture with its type, nosniff and an immutable cache', async () => {
    const { app, getImage } = buildApp()
    const res = await supertest(app).get(`/public/alice/images/${ID}.webp`)
    expect(res.status).toBe(200)
    expect(res.type).toBe('image/webp')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(Buffer.from(res.body).toString()).toBe('webp-bytes')
    expect(getImage).toHaveBeenCalledWith('alice', ID)
  })

  test('404 for an invalid username, without reading', async () => {
    const { app, getImage } = buildApp()
    expect((await supertest(app).get(`/public/Not%20Valid!/images/${ID}.webp`)).status).toBe(404)
    expect(getImage).not.toHaveBeenCalled()
  })

  test('404 for an id that is not a UUID, without reading', async () => {
    const { app, getImage } = buildApp()
    expect((await supertest(app).get('/public/alice/images/coffee.webp')).status).toBe(404)
    expect(getImage).not.toHaveBeenCalled()
  })

  test('404 when the user has no database', async () => {
    const missing = Object.assign(new Error('no db'), { code: '3D000' })
    const { app } = buildApp(vi.fn(async () => Promise.reject(missing)))
    expect((await supertest(app).get(`/public/nobody/images/${ID}.webp`)).status).toBe(404)
  })

  test('404 for a missing picture', async () => {
    const { app } = buildApp(vi.fn(async () => undefined))
    expect((await supertest(app).get(`/public/alice/images/${ID}.webp`)).status).toBe(404)
  })
})
