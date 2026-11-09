import express from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import type { ResolvedChallenge } from '../services/challenge-card.ts'

import { createShareHtmlRouter, HOME_PAGE_PATH, type ShareHtmlDeps } from './share-html-router.ts'

const template = `<!doctype html>
<html lang="en"><head><title>Aurboda</title></head><body><div id="app"></div></body></html>`

const buildApp = (overrides: Partial<ShareHtmlDeps> = {}) => {
  const deps: ShareHtmlDeps = {
    apiBaseUrl: 'https://aurboda.net/api',
    loadTemplate: async () => template,
    profileExists: async () => false,
    resolveArticle: async () => null,
    resolveChallenge: async () => null,
    resolveDashboard: async () => null,
    resolveExercise: async () => null,
    webHost: 'https://aurboda.net',
    ...overrides,
  }
  const app = express()
  app.use(createShareHtmlRouter(deps))
  return app
}

describe('GET /u/:username/:slug', () => {
  test('renders rich meta for a public dashboard', async () => {
    const app = buildApp({
      resolveDashboard: async () => ({ is_public: true, name: 'My Training' }),
    })
    const res = await supertest(app).get('/u/fiddur/abc123')
    expect(res.status).toBe(200)
    expect(res.type).toBe('text/html')
    expect(res.text).toContain('<title>My Training — Aurboda</title>')
    expect(res.text).toContain('property="og:title" content="My Training — Aurboda"')
    expect(res.headers['cache-control']).toBe('public, max-age=300')
  })

  test('names the period a visitor sees on a period dashboard', async () => {
    const app = buildApp({
      resolveDashboard: async () => ({
        is_public: true,
        name: 'Month in data',
        period_label: 'October 2026',
      }),
    })
    const res = await supertest(app).get('/u/fiddur/abc123')
    expect(res.text).toContain('<title>Month in data — October 2026 — Aurboda</title>')
    expect(res.text).toContain('content="Month in data — October 2026 — a public dashboard shared by fiddur')
  })

  test("uses the dashboard's author description in the meta when present", async () => {
    const app = buildApp({
      resolveDashboard: async () => ({
        description: 'Two years of training and its effect on sleep.',
        is_public: true,
        name: 'My Training',
      }),
    })
    const res = await supertest(app).get('/u/fiddur/abc123')
    expect(res.text).toContain(
      'property="og:description" content="Two years of training and its effect on sleep."',
    )
  })

  test('does not leak an unlisted (non-public) dashboard name', async () => {
    const app = buildApp({
      resolveDashboard: async () => ({ is_public: false, name: 'Secret Dashboard' }),
    })
    const res = await supertest(app).get('/u/fiddur/abc123')
    expect(res.status).toBe(200)
    expect(res.text).not.toContain('Secret Dashboard')
    expect(res.text).toContain('<title>Aurboda</title>')
    expect(res.headers['cache-control']).toBe('public, max-age=60')
  })

  const publicChallenge = (overrides: Partial<ResolvedChallenge> = {}): ResolvedChallenge => ({
    banner_updated_at: null,
    end_ts: '2999-02-01T00:00:00.000Z',
    id: 'c1',
    is_public: true,
    members: [{ cached_total: null, display_name: 'fiddur', is_host: true }],
    name: 'Step Count',
    spec: { pattern: 'steps', source_type: 'metric', unit: 'steps' },
    start_ts: '2999-01-01T00:00:00.000Z',
    timezone: 'UTC',
    ...overrides,
  })

  test('renders rich meta for a public challenge when no dashboard matches', async () => {
    const app = buildApp({ resolveChallenge: async () => publicChallenge() })
    const res = await supertest(app).get('/u/fiddur/xyz')
    expect(res.text).toContain('<title>Step Count — Aurboda</title>')
    expect(res.text).toMatch(/og:description" content="Steps challenge, [^"]*Be the first to join/)
  })

  test('counts who joined besides the host', async () => {
    const app = buildApp({
      resolveChallenge: async () =>
        publicChallenge({
          members: [
            { cached_total: null, display_name: 'fiddur', is_host: true },
            { cached_total: null, display_name: 'anna', is_host: false },
            { cached_total: null, display_name: 'bo', is_host: false },
          ],
        }),
    })
    const res = await supertest(app).get('/u/fiddur/xyz')
    expect(res.text).toMatch(/og:description" content="[^"]*· 2 joined\./)
  })

  test('an ended challenge says who took part and no longer invites to join', async () => {
    const app = buildApp({
      resolveChallenge: async () =>
        publicChallenge({ end_ts: '2000-02-01T00:00:00.000Z', start_ts: '2000-01-01T00:00:00.000Z' }),
    })
    const res = await supertest(app).get('/u/fiddur/xyz')
    const description = /og:description" content="([^"]*)"/.exec(res.text)?.[1]
    expect(description).toContain('· 1 took part.')
    expect(description).not.toMatch(/join/i)
  })

  const exercise = {
    activity_type: 'strength_training',
    activity_type_name: 'Strength training',
    field: 'sets.exercise',
    id: 'e1',
    is_public: true,
    name: 'Bench',
    value: 'Bench Press',
  }

  test('renders meta with the rendered image and oEmbed for a public exercise', async () => {
    const app = buildApp({ resolveExercise: async () => exercise })
    const res = await supertest(app).get('/u/fiddur/ex1')
    expect(res.text).toContain('<title>Bench — Aurboda</title>')
    expect(res.text).toContain(`property="og:description" content="Bench — fiddur's progress on Aurboda."`)
    expect(res.text).toContain(
      'property="og:image" content="https://aurboda.net/u/fiddur/ex1/opengraph-image.png"',
    )
    expect(res.text).toContain(
      'type="application/json+oembed" href="https://aurboda.net/oembed?url=https%3A%2F%2Faurboda.net%2Fu%2Ffiddur%2Fex1&amp;format=json"',
    )
    expect(res.headers['cache-control']).toBe('public, max-age=300')
  })

  test('does not leak an unlisted exercise name', async () => {
    const app = buildApp({ resolveExercise: async () => ({ ...exercise, is_public: false, name: 'Secret' }) })
    const res = await supertest(app).get('/u/fiddur/ex1')
    expect(res.text).not.toContain('Secret')
    expect(res.text).toContain('<title>Aurboda</title>')
    expect(res.text).not.toContain('oembed')
    expect(res.text).toContain('property="og:image" content="https://aurboda.net/og-default.png"')
  })

  test('does not look up an exercise when a dashboard holds the slug', async () => {
    let asked = false
    const app = buildApp({
      resolveDashboard: async () => ({ is_public: false, name: 'Hidden' }),
      resolveExercise: async () => {
        asked = true
        return exercise
      },
    })
    const res = await supertest(app).get('/u/fiddur/ex1')
    expect(asked).toBe(false)
    expect(res.text).toContain('<title>Aurboda</title>')
  })

  test('falls back to default meta for an unknown slug', async () => {
    const res = await supertest(buildApp()).get('/u/fiddur/nope')
    expect(res.text).toContain('<title>Aurboda</title>')
    expect(res.text).toContain('og:site_name')
  })

  test('uses default meta for an invalid username without touching resolvers', async () => {
    let called = false
    const app = buildApp({
      resolveDashboard: async () => {
        called = true
        return { is_public: true, name: 'x' }
      },
    })
    const res = await supertest(app).get('/u/Invalid..Name/abc')
    expect(called).toBe(false)
    expect(res.text).toContain('<title>Aurboda</title>')
  })

  test('serves a minimal document when the template is unavailable', async () => {
    const app = buildApp({
      loadTemplate: async () => null,
      resolveDashboard: async () => ({ is_public: true, name: 'My Training' }),
    })
    const res = await supertest(app).get('/u/fiddur/abc')
    expect(res.text).toContain('property="og:title" content="My Training — Aurboda"')
    expect(res.text).toContain('<a href="https://aurboda.net/u/fiddur/abc">')
  })
})

describe('/u/* fallback', () => {
  test('serves the SPA shell with generic meta for a deeper/unknown path', async () => {
    const res = await supertest(buildApp()).get('/u/fiddur/abc/extra')
    expect(res.status).toBe(200)
    expect(res.text).toContain('<title>Aurboda</title>')
    expect(res.text).toContain('<div id="app">')
  })

  test('handles a trailing-slash profile path without 404', async () => {
    const res = await supertest(buildApp()).get('/u/fiddur/')
    expect(res.status).toBe(200)
    expect(res.text).toContain('<div id="app">')
  })
})

describe('GET /u/:username', () => {
  test('renders profile meta when the profile exists', async () => {
    const app = buildApp({ profileExists: async () => true })
    const res = await supertest(app).get('/u/fiddur')
    expect(res.text).toContain('<title>fiddur — Aurboda</title>')
    expect(res.text).toContain('property="og:type" content="profile"')
    expect(res.headers['cache-control']).toBe('public, max-age=300')
  })

  test('renders default meta when the profile does not exist', async () => {
    const res = await supertest(buildApp()).get('/u/ghost')
    expect(res.text).toContain('<title>Aurboda</title>')
    expect(res.text).not.toContain('ghost — Aurboda')
    expect(res.headers['cache-control']).toBe('public, max-age=60')
  })
})

describe('GET the welcome page', () => {
  test('renders the site meta with an image, uncached so a deploy shows at once', async () => {
    const res = await supertest(buildApp()).get(HOME_PAGE_PATH)
    expect(res.status).toBe(200)
    expect(res.type).toBe('text/html')
    expect(res.text).toContain(
      '<title>Aurboda: see how your sleep, training and everyday life fit together</title>',
    )
    expect(res.text).toContain('<link rel="canonical" href="https://aurboda.net/">')
    expect(res.text).toContain('property="og:image" content="https://aurboda.net/og-default.png"')
    expect(res.text).toContain('name="twitter:card" content="summary_large_image"')
    expect(res.text).toContain('<div id="app"></div>')
    expect(res.headers['cache-control']).toBe('no-cache')
  })
})

describe('GET /blog', () => {
  test('renders the official feed meta with Atom discovery when it is on', async () => {
    const app = buildApp({
      readOfficialFeed: async () => ({ tags: ['aurboda', 'qs'], users: ['fiddur', 'alice'] }),
    })
    const res = await supertest(app).get('/blog')
    expect(res.text).toContain('<title>aurboda.net blog</title>')
    expect(res.text).toContain('<link rel="canonical" href="https://aurboda.net/blog">')
    expect(res.text).toContain('content="Posts from fiddur and alice tagged #aurboda or #qs."')
    expect(res.text).toContain(
      'type="application/atom+xml" title="aurboda.net blog" href="https://aurboda.net/api/public/official-feed.atom">',
    )
    expect(res.headers['cache-control']).toBe('public, max-age=300')
  })

  test('renders default meta when the official feed is off', async () => {
    for (const app of [buildApp(), buildApp({ readOfficialFeed: async () => ({ tags: [], users: [] }) })]) {
      const res = await supertest(app).get('/blog')
      expect(res.text).toContain('<title>Aurboda</title>')
      expect(res.text).not.toContain('application/atom+xml')
      expect(res.headers['cache-control']).toBe('public, max-age=60')
    }
  })
})

describe('GET /u/:username/articles', () => {
  test('renders blog meta with Atom discovery when the profile exists', async () => {
    const app = buildApp({ profileExists: async () => true, resolveDashboard: async () => null })
    const res = await supertest(app).get('/u/fiddur/articles')
    expect(res.text).toContain("<title>fiddur's blog — Aurboda</title>")
    expect(res.text).toContain('<link rel="canonical" href="https://aurboda.net/u/fiddur/articles">')
    expect(res.text).toContain(
      'type="application/atom+xml" title="fiddur\'s blog — Aurboda" href="https://aurboda.net/api/public/fiddur/articles.atom">',
    )
    expect(res.headers['cache-control']).toBe('public, max-age=300')
  })

  test('is not resolved as a dashboard slug', async () => {
    let looked = false
    const app = buildApp({
      profileExists: async () => true,
      resolveDashboard: async () => {
        looked = true
        return null
      },
    })
    await supertest(app).get('/u/fiddur/articles')
    expect(looked).toBe(false)
  })

  test('renders default meta for an unknown profile', async () => {
    const res = await supertest(buildApp()).get('/u/ghost/articles')
    expect(res.text).toContain('<title>Aurboda</title>')
    expect(res.text).not.toContain('application/atom+xml')
    expect(res.headers['cache-control']).toBe('public, max-age=60')
  })
})

describe('GET /u/:username/posts/:postId', () => {
  const postId = '11111111-2222-4333-8444-555555555555'

  test('renders article meta for a public article', async () => {
    const app = buildApp({
      resolveArticle: async () => ({
        excerpt: 'Two weeks of sleep data.',
        is_public: true,
        title: 'Sleep & HRV',
      }),
    })
    const res = await supertest(app).get(`/u/fiddur/posts/${postId}`)
    expect(res.text).toContain('<title>Sleep &amp; HRV — Aurboda</title>')
    expect(res.text).toContain('property="og:type" content="article"')
    expect(res.text).toContain('property="og:description" content="Two weeks of sleep data."')
    expect(res.text).toContain(`property="og:url" content="https://aurboda.net/u/fiddur/posts/${postId}"`)
    expect(res.text).toContain('href="https://aurboda.net/api/public/fiddur/articles.atom"')
    expect(res.headers['cache-control']).toBe('public, max-age=300')
  })

  test('does not describe an unlisted article', async () => {
    const app = buildApp({
      resolveArticle: async () => ({ excerpt: 'Secret words', is_public: false, title: 'Hidden title' }),
    })
    const res = await supertest(app).get(`/u/fiddur/posts/${postId}`)
    expect(res.text).not.toContain('Hidden title')
    expect(res.text).not.toContain('Secret words')
    expect(res.text).toContain('<title>Aurboda</title>')
  })

  test('falls back to default meta for a non-article post or a malformed id without resolving it', async () => {
    let calls = 0
    const app = buildApp({
      resolveArticle: async () => {
        calls++
        return null
      },
    })
    const res = await supertest(app).get(`/u/fiddur/posts/${postId}`)
    expect(res.text).toContain('<title>Aurboda</title>')
    await supertest(app).get('/u/fiddur/posts/not-a-uuid')
    await supertest(app).get(`/u/Invalid..Name/posts/${postId}`)
    expect(calls).toBe(1)
  })
})
