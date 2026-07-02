import express from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import { createOgImageRouter, type OgImageDeps } from './og-image-router.ts'

const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const buildApp = (overrides: Partial<OgImageDeps> = {}) => {
  const deps: OgImageDeps = {
    profileExists: async () => false,
    renderImage: vi.fn(async () => fakePng),
    resolveChallenge: async () => null,
    resolveDashboard: async () => null,
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
      resolveDashboard: async () => ({ is_public: true, name: 'Training' }),
    })
    const res = await supertest(app).get('/u/fiddur/abc/opengraph-image.png')
    expect(res.status).toBe(200)
    expect(res.type).toBe('image/png')
    expect(res.headers['cache-control']).toBe('public, max-age=3600')
    expect(deps.renderImage).toHaveBeenCalledWith({ kind: 'dashboard', title: 'Training' })
  })

  test('renders a challenge card when no dashboard matches', async () => {
    const { app, deps } = buildApp({
      resolveChallenge: async () => ({ is_public: true, name: 'Step count' }),
    })
    const res = await supertest(app).get('/u/fiddur/xyz/opengraph-image.png')
    expect(res.status).toBe(200)
    expect(deps.renderImage).toHaveBeenCalledWith({ kind: 'challenge', title: 'Step count' })
  })

  test('redirects unlisted resources to the default image', async () => {
    const { app, deps } = buildApp({
      resolveDashboard: async () => ({ is_public: false, name: 'Secret' }),
    })
    const res = await supertest(app).get('/u/fiddur/abc/opengraph-image.png')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('https://aurboda.net/og-default.png')
    expect(deps.renderImage).not.toHaveBeenCalled()
  })

  test('redirects unknown resources to the default image', async () => {
    const res = await supertest(buildApp().app).get('/u/fiddur/nope/opengraph-image.png')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('https://aurboda.net/og-default.png')
  })

  test('memoises renders across identical requests', async () => {
    const { app, deps } = buildApp({
      resolveDashboard: async () => ({ is_public: true, name: 'Training' }),
    })
    await supertest(app).get('/u/fiddur/abc/opengraph-image.png')
    await supertest(app).get('/u/fiddur/abc/opengraph-image.png')
    expect(deps.renderImage).toHaveBeenCalledTimes(1)
  })
})

describe('GET /u/:username/opengraph-image.png', () => {
  test('renders a profile card when the profile exists', async () => {
    const { app, deps } = buildApp({ profileExists: async () => true })
    const res = await supertest(app).get('/u/fiddur/opengraph-image.png')
    expect(res.status).toBe(200)
    expect(res.type).toBe('image/png')
    expect(deps.renderImage).toHaveBeenCalledWith({ kind: 'profile', title: 'fiddur' })
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
