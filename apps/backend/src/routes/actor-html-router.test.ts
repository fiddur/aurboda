import express from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import { createActorAcceptNormalizer, createActorHtmlRouter, negotiateActor } from './actor-html-router.ts'

/** Mounts the router with a fallback 404 so `next()` fall-through is observable. */
const buildApp = (origin = 'https://aurboda.net', users = ['fiddur']) => {
  const app = express()
  app.use(createActorHtmlRouter({ origin, userExists: async (username) => users.includes(username) }))
  app.use((_req, res) => res.status(404).json({ fellThrough: true }))
  return app
}

const BROWSER = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'

describe('negotiateActor', () => {
  test('a browser navigation, or any request naming HTML first, gets HTML', () => {
    expect(negotiateActor(BROWSER)).toBe('html')
    expect(negotiateActor('text/html')).toBe('html')
    expect(negotiateActor('application/xhtml+xml')).toBe('html')
  })

  test('a wildcard or absent Accept accepts anything, so it gets the default actor document', () => {
    expect(negotiateActor('*/*')).toBe('activitypub')
    expect(negotiateActor(undefined)).toBe('activitypub')
    expect(negotiateActor('')).toBe('activitypub')
    expect(negotiateActor('application/*')).toBe('activitypub')
  })

  test('a type wildcard picks the representation in that family', () => {
    expect(negotiateActor('text/*')).toBe('html')
    expect(negotiateActor('text/*, */*;q=0.1')).toBe('html')
    expect(negotiateActor('application/*;q=0.5, text/*')).toBe('html')
  })

  test('an ActivityPub type that outranks HTML gets the actor document', () => {
    expect(negotiateActor('application/activity+json')).toBe('activitypub')
    expect(negotiateActor('application/activity+json, text/html;q=0.1')).toBe('activitypub')
    expect(negotiateActor('application/ld+json;profile="https://www.w3.org/ns/activitystreams"')).toBe(
      'activitypub',
    )
    expect(negotiateActor('text/html;q=0.5, */*')).toBe('activitypub')
    expect(negotiateActor('application/json')).toBe('activitypub')
  })

  test('on a tie a named HTML type wins over the default', () => {
    expect(negotiateActor('application/activity+json;q=0.5, text/html;q=0.5')).toBe('html')
    expect(negotiateActor('application/activity+json;q=0.5, text/html')).toBe('html')
    expect(negotiateActor('text/html, */*')).toBe('html')
  })

  test('nothing acceptable when every representation is excluded', () => {
    expect(negotiateActor('image/png')).toBe('none')
    expect(negotiateActor('text/html;q=0')).toBe('none')
    expect(negotiateActor('text/plain')).toBe('none')
  })
})

describe('createActorAcceptNormalizer', () => {
  const seenAccept = (accept?: string, path = '/users/fiddur', method: 'get' | 'post' = 'get') => {
    const app = express()
    app.use(createActorAcceptNormalizer())
    app.all('*splat', (req, res) => res.json({ accept: req.headers.accept ?? null }))
    const request = supertest(app)[method](path)
    return accept === undefined ? request : request.set('Accept', accept)
  }

  test('rewrites a wildcard or absent Accept on the actor URL to the actor type', async () => {
    for (const accept of ['*/*', 'application/*', undefined]) {
      const res = await seenAccept(accept)
      expect(res.body.accept).toBe('application/activity+json')
      expect(res.headers.vary).toBe('Accept')
    }
  })

  test('leaves an HTML preference and an unacceptable Accept for the HTML router', async () => {
    expect((await seenAccept(BROWSER)).body.accept).toBe(BROWSER)
    expect((await seenAccept('image/png')).body.accept).toBe('image/png')
  })

  test('touches neither sub-resources, nor other methods, nor malformed usernames', async () => {
    expect((await seenAccept('*/*', '/users/fiddur/outbox')).body.accept).toBe('*/*')
    expect((await seenAccept('*/*', '/users/fiddur', 'post')).body.accept).toBe('*/*')
    expect((await seenAccept('*/*', '/users/Invalid..Name')).body.accept).toBe('*/*')
  })
})

describe('GET /users/:username (browser HTML fallback)', () => {
  test('redirects a browser to the public profile page, varying on Accept', async () => {
    const res = await supertest(buildApp()).get('/users/fiddur').set('Accept', BROWSER)
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('https://aurboda.net/u/fiddur')
    expect(res.headers.vary).toBe('Accept')
  })

  test('falls through for an ActivityPub Accept header (no redirect to HTML)', async () => {
    const res = await supertest(buildApp()).get('/users/fiddur').set('Accept', 'application/activity+json')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ fellThrough: true })
  })

  test("falls through for a wildcard Accept: the actor document is Fedify's to serve", async () => {
    const res = await supertest(buildApp()).get('/users/fiddur').set('Accept', '*/*')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ fellThrough: true })
  })

  test('redirects a text/* request, whose only acceptable representation is HTML', async () => {
    const res = await supertest(buildApp()).get('/users/fiddur').set('Accept', 'text/*')
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('https://aurboda.net/u/fiddur')
  })

  test('answers 406 for an existing actor when nothing it serves is acceptable', async () => {
    const res = await supertest(buildApp()).get('/users/fiddur').set('Accept', 'image/png')
    expect(res.status).toBe(406)
    expect(res.headers.vary).toBe('Accept')
  })

  test('falls through to 404 for an unknown actor whatever the Accept', async () => {
    for (const accept of ['image/png', 'text/*']) {
      const res = await supertest(buildApp()).get('/users/nosuchuser').set('Accept', accept)
      expect(res.status).toBe(404)
    }
  })

  test('falls through for an unknown user, so a nonexistent actor never soft-404s as HTML', async () => {
    const res = await supertest(buildApp()).get('/users/nosuchuser').set('Accept', 'text/html')
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
