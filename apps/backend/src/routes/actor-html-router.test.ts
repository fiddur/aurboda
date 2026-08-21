import express from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import { createActorHtmlRouter } from './actor-html-router.ts'

/** Mounts the router with a fallback 404 so `next()` fall-through is observable. */
const buildApp = (origin = 'https://aurboda.net') => {
  const app = express()
  app.use(createActorHtmlRouter({ origin }))
  app.use((_req, res) => res.status(404).json({ fellThrough: true }))
  return app
}

describe('GET /users/:username (browser HTML fallback)', () => {
  test('redirects a browser to the public profile page', async () => {
    const res = await supertest(buildApp())
      .get('/users/fiddur')
      .set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('https://aurboda.net/u/fiddur')
  })

  test('falls through for an ActivityPub Accept header (no redirect to HTML)', async () => {
    const res = await supertest(buildApp()).get('/users/fiddur').set('Accept', 'application/activity+json')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ fellThrough: true })
  })

  test('falls through for a malformed username', async () => {
    const res = await supertest(buildApp()).get('/users/Invalid..Name').set('Accept', 'text/html')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ fellThrough: true })
  })

  test('does not claim actor sub-resources like the outbox', async () => {
    const res = await supertest(buildApp()).get('/users/fiddur/outbox').set('Accept', 'text/html')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ fellThrough: true })
  })
})
