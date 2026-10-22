import express from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import { createOEmbedRouter, type OEmbedDeps } from './oembed-router.ts'

const buildApp = (overrides: Partial<OEmbedDeps> = {}) => {
  const deps: OEmbedDeps = {
    profileExists: async () => false,
    resolveChallenge: async () => null,
    resolveDashboard: async () => null,
    webHost: 'https://aurboda.net',
    ...overrides,
  }
  const app = express()
  app.use(createOEmbedRouter(deps))
  return app
}

const get = (app: express.Express, url: string) =>
  supertest(app).get(`/oembed?url=${encodeURIComponent(url)}&format=json`)

describe('GET /oembed', () => {
  test('400 when url is missing', async () => {
    expect((await supertest(buildApp()).get('/oembed')).status).toBe(400)
  })

  test('501 for a non-json format', async () => {
    const res = await supertest(buildApp()).get(
      `/oembed?url=${encodeURIComponent('https://aurboda.net/u/fiddur/abc')}&format=xml`,
    )
    expect(res.status).toBe(501)
  })

  test('404 for a non-share URL', async () => {
    expect((await get(buildApp(), 'https://aurboda.net/dashboard')).status).toBe(404)
  })

  test('returns an oEmbed link for a public dashboard', async () => {
    const app = buildApp({ resolveDashboard: async () => ({ is_public: true, name: 'My Training' }) })
    const res = await get(app, 'https://aurboda.net/u/fiddur/abc')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      author_name: 'fiddur',
      author_url: 'https://aurboda.net/u/fiddur',
      provider_name: 'Aurboda',
      thumbnail_url: 'https://aurboda.net/u/fiddur/abc/opengraph-image.png',
      title: 'My Training',
      type: 'link',
    })
    expect(res.headers['cache-control']).toBe('public, max-age=300')
  })

  test('falls through to a public challenge', async () => {
    const app = buildApp({ resolveChallenge: async () => ({ is_public: true, name: 'Step count' }) })
    const res = await get(app, 'https://aurboda.net/u/fiddur/xyz')
    expect(res.status).toBe(200)
    expect(res.body.title).toBe('Step count')
  })

  test('404 for an unlisted (non-public) dashboard', async () => {
    const app = buildApp({ resolveDashboard: async () => ({ is_public: false, name: 'Secret' }) })
    const res = await get(app, 'https://aurboda.net/u/fiddur/abc')
    expect(res.status).toBe(404)
    expect(JSON.stringify(res.body)).not.toContain('Secret')
  })

  test('returns an oEmbed link for an existing profile', async () => {
    const app = buildApp({ profileExists: async () => true })
    const res = await get(app, 'https://aurboda.net/u/fiddur')
    expect(res.status).toBe(200)
    expect(res.body.title).toBe('fiddur — Aurboda')
    expect(res.body.thumbnail_url).toBe('https://aurboda.net/u/fiddur/opengraph-image.png')
  })

  test('404 for a missing profile', async () => {
    expect((await get(buildApp(), 'https://aurboda.net/u/ghost')).status).toBe(404)
  })
})
