import express from 'express'
import supertest from 'supertest'
import { describe, expect, test } from 'vitest'

import {
  buildTombstoneJsonLd,
  createFeedTombstoneRouter,
  type FeedTombstoneDeps,
} from './feed-tombstone-router.ts'

const POST_ID = '11111111-1111-4111-8111-111111111111'
const DELETED_AT = new Date('2026-07-02T09:00:00.000Z')

/** Mounts the router with a fallback 404 so `next()` fall-through is observable. */
const buildApp = (overrides: Partial<FeedTombstoneDeps> = {}) => {
  const deps: FeedTombstoneDeps = {
    getTombstone: async () => ({ deleted_at: DELETED_AT }),
    origin: 'https://aurboda.net',
    ...overrides,
  }
  const app = express()
  app.use(createFeedTombstoneRouter(deps))
  app.use((_req, res) => res.status(404).json({ fellThrough: true }))
  return app
}

describe('buildTombstoneJsonLd', () => {
  test('is a canonical AS2 Tombstone with the note id and deleted time', () => {
    const id = 'https://aurboda.net/users/fiddur/feed/' + POST_ID
    expect(buildTombstoneJsonLd(id, DELETED_AT)).toEqual({
      '@context': 'https://www.w3.org/ns/activitystreams',
      deleted: '2026-07-02T09:00:00.000Z',
      formerType: 'Note',
      id,
      type: 'Tombstone',
    })
  })

  test('emits formerType Article when asked (deleted article id)', () => {
    const id = 'https://aurboda.net/users/fiddur/feed/' + POST_ID + '/article'
    expect(buildTombstoneJsonLd(id, DELETED_AT, 'Article')).toMatchObject({ formerType: 'Article', id })
  })
})

describe('GET /users/:username/feed/:postId (tombstone)', () => {
  test('serves 410 Gone with an AS2 Tombstone for a tombstoned post', async () => {
    const res = await supertest(buildApp()).get(`/users/fiddur/feed/${POST_ID}`)
    expect(res.status).toBe(410)
    expect(res.type).toBe('application/activity+json')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).toEqual({
      '@context': 'https://www.w3.org/ns/activitystreams',
      deleted: DELETED_AT.toISOString(),
      formerType: 'Note',
      id: `https://aurboda.net/users/fiddur/feed/${POST_ID}`,
      type: 'Tombstone',
    })
  })

  test('serves 410 with formerType Article at the article id for a tombstoned article', async () => {
    const res = await supertest(buildApp()).get(`/users/fiddur/feed/${POST_ID}/article`)
    expect(res.status).toBe(410)
    expect(res.body).toEqual({
      '@context': 'https://www.w3.org/ns/activitystreams',
      deleted: DELETED_AT.toISOString(),
      formerType: 'Article',
      id: `https://aurboda.net/users/fiddur/feed/${POST_ID}/article`,
      type: 'Tombstone',
    })
  })

  test('normalises a trailing slash on the origin so the id has no double slash', async () => {
    const res = await supertest(buildApp({ origin: 'https://aurboda.net/' })).get(
      `/users/fiddur/feed/${POST_ID}`,
    )
    expect(res.body.id).toBe(`https://aurboda.net/users/fiddur/feed/${POST_ID}`)
  })

  test('falls through (404) when there is no tombstone', async () => {
    const res = await supertest(buildApp({ getTombstone: async () => null })).get(
      `/users/fiddur/feed/${POST_ID}`,
    )
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ fellThrough: true })
  })

  test('falls through for an invalid username without consulting the store', async () => {
    let consulted = false
    const app = buildApp({
      getTombstone: async () => {
        consulted = true
        return { deleted_at: DELETED_AT }
      },
    })
    const res = await supertest(app).get(`/users/Invalid..Name/feed/${POST_ID}`)
    expect(res.status).toBe(404)
    expect(consulted).toBe(false)
  })

  test('falls through for a non-UUID post id without consulting the store', async () => {
    let consulted = false
    const app = buildApp({
      getTombstone: async () => {
        consulted = true
        return { deleted_at: DELETED_AT }
      },
    })
    const res = await supertest(app).get('/users/fiddur/feed/not-a-uuid')
    expect(res.status).toBe(404)
    expect(consulted).toBe(false)
  })
})
