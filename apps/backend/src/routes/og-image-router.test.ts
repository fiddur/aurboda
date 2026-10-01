import express from 'express'
import supertest from 'supertest'
import { describe, expect, test, vi } from 'vitest'

import type { ResolvedChallenge } from '../services/challenge-card.ts'

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

const buildApp = (overrides: Partial<OgImageDeps> = {}) => {
  const deps: OgImageDeps = {
    loadAvatarDataUri: async () => 'data:image/png;base64,AAAA',
    loadBannerDataUri: vi.fn(async () => 'data:image/jpeg;base64,BBBB'),
    now: () => new Date('2026-10-01T12:00:00Z'),
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
    expect(deps.renderImage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'dashboard', title: 'Training', username: 'fiddur' }),
    )
  })

  test('renders a challenge card when no dashboard matches', async () => {
    const { app, deps } = buildApp({
      resolveChallenge: async () =>
        resolvedChallenge({
          members: [
            { cached_total: null, display_name: 'Anna' },
            { cached_total: 900, display_name: 'Bo' },
          ],
        }),
    })
    const res = await supertest(app).get('/u/fiddur/xyz/opengraph-image.png')
    expect(res.status).toBe(200)
    expect(deps.renderImage).toHaveBeenCalledWith(
      expect.objectContaining({
        challenge: expect.objectContaining({
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
        resolvedChallenge({ members: [{ cached_total: total, display_name: 'Bo' }] }),
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
      resolveDashboard: async () => ({ is_public: false, name: 'Secret' }),
    })
    const res = await supertest(app).get('/u/fiddur/abc/opengraph-image.png')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('https://aurboda.net/og-default.png')
    expect(res.headers['cache-control']).toBe('public, max-age=300')
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

  test('still renders a public card when the avatar fails to load', async () => {
    const { app, deps } = buildApp({
      loadAvatarDataUri: vi.fn(async () => {
        throw new Error('avatar db blip')
      }),
      resolveDashboard: async () => ({ is_public: true, name: 'Training' }),
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
      resolveDashboard: async () => ({ is_public: true, name: 'Training' }),
    })
    const res = await supertest(app).get('/u/fiddur/abc/opengraph-image.png')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('https://aurboda.net/og-default.png')
  })

  test('collapses concurrent cold-cache misses into a single render', async () => {
    const renderImage = vi.fn(() => new Promise<Buffer>((resolve) => setTimeout(() => resolve(fakePng), 30)))
    const { app } = buildApp({
      renderImage,
      resolveDashboard: async () => ({ is_public: true, name: 'Training' }),
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
