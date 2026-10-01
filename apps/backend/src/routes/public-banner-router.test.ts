import express from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import { createPublicBannerRouter, type PublicBannerDeps } from './public-banner-router.ts'

const storedBanner = {
  content_type: 'image/webp',
  data: Buffer.from('webp-bytes'),
  updated_at: new Date('2026-10-01T00:00:00Z'),
}

const buildApp = (overrides: Partial<PublicBannerDeps> = {}) => {
  const deps = {
    getBanner: vi.fn(async () => storedBanner),
    getChallengeIdBySlug: vi.fn(async (_username: string, slug: string) => (slug === 'abc' ? 'c1' : null)),
    ...overrides,
  }
  const app = express()
  app.use(createPublicBannerRouter(deps))
  return { app, deps }
}

describe('GET /u/:username/:slug/banner.webp', () => {
  test('serves the stored banner with an immutable cache when versioned', async () => {
    const { app, deps } = buildApp()
    const res = await supertest(app).get('/u/fiddur/abc/banner.webp?v=123')
    expect(res.status).toBe(200)
    expect(res.type).toBe('image/webp')
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(deps.getBanner).toHaveBeenCalledWith('fiddur', 'c1')
  })

  test('caches briefly when the request is not versioned', async () => {
    const { app } = buildApp()
    const res = await supertest(app).get('/u/fiddur/abc/banner.webp')
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('public, max-age=300')
  })

  test('404 for an unknown slug', async () => {
    const { app, deps } = buildApp()
    const res = await supertest(app).get('/u/fiddur/nope/banner.webp')
    expect(res.status).toBe(404)
    expect(deps.getBanner).not.toHaveBeenCalled()
  })

  test('404 when the challenge has no banner', async () => {
    const { app } = buildApp({ getBanner: vi.fn(async () => undefined) })
    const res = await supertest(app).get('/u/fiddur/abc/banner.webp')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Not found', success: false })
  })

  test('404 for an invalid username without touching the database', async () => {
    const { app, deps } = buildApp()
    const res = await supertest(app).get('/u/Invalid..Name/abc/banner.webp')
    expect(res.status).toBe(404)
    expect(deps.getChallengeIdBySlug).not.toHaveBeenCalled()
  })

  test('404 when the user database does not exist', async () => {
    const missing = Object.assign(new Error('no db'), { code: '3D000' })
    const { app } = buildApp({ getChallengeIdBySlug: vi.fn(async () => Promise.reject(missing)) })
    const res = await supertest(app).get('/u/ghost/abc/banner.webp')
    expect(res.status).toBe(404)
  })
})
