import express from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import { createShareHtmlRouter, type ShareHtmlDeps } from './share-html-router.ts'

const template = `<!doctype html>
<html lang="en"><head><title>Aurboda</title></head><body><div id="app"></div></body></html>`

const buildApp = (overrides: Partial<ShareHtmlDeps> = {}) => {
  const deps: ShareHtmlDeps = {
    loadTemplate: async () => template,
    profileExists: async () => false,
    resolveChallenge: async () => null,
    resolveDashboard: async () => null,
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

  test('renders rich meta for a public challenge when no dashboard matches', async () => {
    const app = buildApp({
      resolveChallenge: async () => ({ is_public: true, name: 'Step Count' }),
    })
    const res = await supertest(app).get('/u/fiddur/xyz')
    expect(res.text).toContain('<title>Step Count — Aurboda</title>')
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
