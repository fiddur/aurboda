/**
 * Integration tests for the Fedify actor + WebFinger surface, exercised through
 * `federation.fetch` against a real per-user database (no Express/nginx needed).
 */
import { integrateFederation } from '@fedify/express'
import { Note } from '@fedify/fedify/vocab'
import express from 'express'
import supertest from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { insertActivity } from '../../db/activities/index.ts'
import { upsertFeedFollower } from '../../db/feed-follower.ts'
import { createFeedPost, deleteFeedPost, type FeedPostInput, getFeedTombstone } from '../../db/feed.ts'
import { createFeedTombstoneRouter } from '../../routes/feed-tombstone-router.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../../test/db-test-helper.ts'
import { buildFeedUpdate } from './deliver.ts'
import { createFeedFederation } from './federation.ts'

const CONTAINER_TIMEOUT = 120_000
const ORIGIN = 'https://aurboda.example'

const insertExercise = (user: string): Promise<string> =>
  insertActivity(user, {
    activity_type: 'exercise',
    end_time: new Date('2026-07-01T07:11:00Z'),
    source: 'garmin',
    start_time: new Date('2026-07-01T06:30:00Z'),
    title: 'Morning run',
  })

const sharePost = (user: string, activityId: string, overrides: Partial<FeedPostInput> = {}) =>
  createFeedPost(user, {
    activity_id: activityId,
    include_chart: false,
    include_map: false,
    included_metrics: ['duration'],
    series_metrics: [],
    visibility: 'public',
    ...overrides,
  })

const notFound = () => new Response('nope', { status: 404 })
const fed = createFeedFederation(ORIGIN, `${ORIGIN}/api`)

const fetchAs2 = (path: string) =>
  fed.fetch(new Request(`${ORIGIN}${path}`, { headers: { Accept: 'application/activity+json' } }), {
    contextData: undefined,
    onNotFound: notFound,
    onNotAcceptable: notFound,
  })

describe('Feed federation actor + WebFinger', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('serves an actor document with a published RSA public key', async () => {
    const user = getTestUser()
    const res = await fetchAs2(`/users/${user}`)
    expect(res.status).toBe(200)
    const doc = (await res.json()) as Record<string, unknown>

    expect(doc.type).toBe('Person')
    expect(doc.id).toBe(`${ORIGIN}/users/${user}`)
    expect(doc.preferredUsername).toBe(user)
    expect(doc.inbox).toBe(`${ORIGIN}/users/${user}/inbox`)
    expect(doc.outbox).toBe(`${ORIGIN}/users/${user}/outbox`)
    expect(doc.publicKey).toBeDefined()
    // The published key is a PEM-encoded RSA public key.
    const publicKey = doc.publicKey as { owner?: string; publicKeyPem?: string }
    expect(publicKey.owner).toBe(`${ORIGIN}/users/${user}`)
    expect(publicKey.publicKeyPem).toContain('BEGIN PUBLIC KEY')
  })

  test('builds https URLs from the canonical origin even when the request arrives over http', async () => {
    // Simulates a request reaching the backend over loopback http behind a
    // TLS-terminating proxy; the pinned origin must still yield https URLs
    // (Mastodon rejects http actors).
    const user = getTestUser()
    const res = await fed.fetch(
      new Request(`http://aurboda.example/users/${user}`, {
        headers: { Accept: 'application/activity+json' },
      }),
      { contextData: undefined, onNotAcceptable: notFound, onNotFound: notFound },
    )
    expect(res.status).toBe(200)
    const doc = (await res.json()) as Record<string, unknown>
    expect(doc.id).toBe(`https://aurboda.example/users/${user}`)
    expect(doc.inbox).toBe(`https://aurboda.example/users/${user}/inbox`)
  })

  test('resolves the actor via WebFinger by acct handle', async () => {
    const user = getTestUser()
    const res = await fed.fetch(
      new Request(`${ORIGIN}/.well-known/webfinger?resource=acct:${user}@aurboda.example`),
      { contextData: undefined, onNotFound: notFound, onNotAcceptable: notFound },
    )
    expect(res.status).toBe(200)
    const jrd = (await res.json()) as { subject: string; links: { rel: string; href?: string }[] }
    expect(jrd.subject).toBe(`acct:${user}@aurboda.example`)
    const self = jrd.links.find((l) => l.rel === 'self')
    expect(self?.href).toBe(`${ORIGIN}/users/${user}`)
  })

  test('404s the actor for an invalid username (never touches the database)', async () => {
    const res = await fetchAs2('/users/Invalid..Name')
    expect(res.status).toBe(404)
  })

  test('serves the followers collection from feed_follower', async () => {
    const user = getTestUser()
    await upsertFeedFollower(user, {
      actor_uri: 'https://mastodon.example/users/alice',
      inbox_uri: 'https://mastodon.example/users/alice/inbox',
      shared_inbox_uri: 'https://mastodon.example/inbox',
    })
    const res = await fetchAs2(`/users/${user}/followers`)
    expect(res.status).toBe(200)
    const doc = (await res.json()) as { totalItems?: number; orderedItems?: string[] }
    expect(doc.totalItems).toBe(1)
    expect(doc.orderedItems).toContain('https://mastodon.example/users/alice')
  })

  test('serves a paginated outbox: root has totalItems + first page link, page has the Create', async () => {
    const user = getTestUser()
    const activityId = await insertExercise(user)
    const post = await sharePost(user, activityId)

    // Root collection: totalItems + a `first` page link (items live on the page).
    const root = (await (await fetchAs2(`/users/${user}/outbox`)).json()) as {
      totalItems?: number
      first?: string
      orderedItems?: unknown[]
    }
    expect(root.totalItems).toBe(1)
    expect(root.first).toBe(`${ORIGIN}/users/${user}/outbox?cursor=0`)
    expect(root.orderedItems).toBeUndefined()

    // First page: the Create for the shared post.
    const page = (await (await fetchAs2(`/users/${user}/outbox?cursor=0`)).json()) as {
      orderedItems?: unknown[]
    }
    const items = page.orderedItems ?? []
    expect(items).toHaveLength(1)
    const create = items[0] as { type: string; object: string | { id: string; type: string } }
    expect(create.type).toBe('Create')
    const object = typeof create.object === 'string' ? { id: create.object, type: 'Note' } : create.object
    expect(object.id).toBe(`${ORIGIN}/users/${user}/feed/${post.id}`)
  })

  test('serves an individual public post object as a Note at its canonical id', async () => {
    const user = getTestUser()
    const activityId = await insertExercise(user)
    const post = await sharePost(user, activityId)

    const res = await fetchAs2(`/users/${user}/feed/${post.id}`)
    expect(res.status).toBe(200)
    const doc = (await res.json()) as {
      type: string
      id: string
      attributedTo?: string
      published?: string
    }
    expect(doc.type).toBe('Note')
    expect(doc.id).toBe(`${ORIGIN}/users/${user}/feed/${post.id}`)
    expect(doc.attributedTo).toBe(`${ORIGIN}/users/${user}`)
    // `published` is the post's share time (created_at), not the fetch time, so
    // remote servers order it correctly.
    expect(doc.published).toBeDefined()
    expect(new Date(doc.published ?? '').getTime()).toBe(post.created_at.getTime())
  })

  test('serves the merged-span duration for a shared merged activity (#881)', async () => {
    const user = getTestUser()
    // Anchor 08:00–08:40 (40m) overlaps a second 08:20–09:00 → merged span is 1h.
    const anchorId = await insertActivity(user, {
      activity_type: 'exercise',
      end_time: new Date('2026-07-01T08:40:00Z'),
      source: 'garmin',
      start_time: new Date('2026-07-01T08:00:00Z'),
      title: 'Merged run',
    })
    await insertActivity(user, {
      activity_type: 'exercise',
      end_time: new Date('2026-07-01T09:00:00Z'),
      source: 'strava',
      start_time: new Date('2026-07-01T08:20:00Z'),
      title: 'Second half',
    })
    const post = await sharePost(user, anchorId) // included_metrics: ['duration']

    const doc = (await (await fetchAs2(`/users/${user}/feed/${post.id}`)).json()) as { content: string }
    // The served Note reports the merged span the user saw, not the 40m anchor slice.
    expect(doc.content).toContain('Duration 1h')
    expect(doc.content).not.toContain('40m')
  })

  test('excludes followers-only posts from the outbox and 404s their object', async () => {
    const user = getTestUser()
    const activityId = await insertExercise(user)
    const post = await sharePost(user, activityId, { visibility: 'followers' })

    const outbox = (await (await fetchAs2(`/users/${user}/outbox`)).json()) as { totalItems?: number }
    expect(outbox.totalItems).toBe(0)
    const page = (await (await fetchAs2(`/users/${user}/outbox?cursor=0`)).json()) as {
      orderedItems?: unknown[]
    }
    expect(page.orderedItems ?? []).toHaveLength(0)

    const object = await fetchAs2(`/users/${user}/feed/${post.id}`)
    expect(object.status).toBe(404)
  })

  test('paginates the outbox past the page size', async () => {
    const user = getTestUser()
    const activityId = await insertExercise(user)
    for (let i = 0; i < 21; i++) await sharePost(user, activityId)

    const page1 = (await (await fetchAs2(`/users/${user}/outbox?cursor=0`)).json()) as {
      orderedItems?: unknown[]
      next?: string
    }
    expect((page1.orderedItems ?? []).length).toBe(20)
    expect(page1.next).toBe(`${ORIGIN}/users/${user}/outbox?cursor=20`)

    const page2 = (await (await fetchAs2(`/users/${user}/outbox?cursor=20`)).json()) as {
      orderedItems?: unknown[]
      next?: string
    }
    expect((page2.orderedItems ?? []).length).toBe(1)
    expect(page2.next).toBeUndefined()
  })

  test('404s an outbox page with an out-of-range cursor (no DB error)', async () => {
    const user = getTestUser()
    const res = await fetchAs2(`/users/${user}/outbox?cursor=99999999999999999999`)
    expect(res.status).toBe(404)
  })

  test('404s a post object for a non-UUID id without touching the database', async () => {
    const user = getTestUser()
    const res = await fetchAs2(`/users/${user}/feed/not-a-uuid`)
    expect(res.status).toBe(404)
  })

  // The 410-Tombstone slice lives in an Express router mounted after the Fedify
  // integration; exercise the two together so the "dispatcher returns null →
  // @fedify/express next() → tombstone router" fall-through is covered.
  const buildFederatedApp = () => {
    const app = express()
    app.set('trust proxy', 'loopback')
    app.use(integrateFederation(fed, () => undefined))
    app.use(createFeedTombstoneRouter({ getTombstone: getFeedTombstone, origin: ORIGIN }))
    return app
  }

  const getObject = (app: express.Express, path: string) =>
    supertest(app).get(path).set('Accept', 'application/activity+json')

  test('serves a 410 Tombstone after a public post is deleted (Fedify falls through)', async () => {
    const user = getTestUser()
    const activityId = await insertExercise(user)
    const post = await sharePost(user, activityId)
    const app = buildFederatedApp()

    // Live: the object dispatcher serves the Note (200).
    const live = await getObject(app, `/users/${user}/feed/${post.id}`)
    expect(live.status).toBe(200)

    // Unshare, then the same id returns 410 Gone with a Tombstone at the same id.
    await deleteFeedPost(user, post.id)
    const gone = await getObject(app, `/users/${user}/feed/${post.id}`)
    expect(gone.status).toBe(410)
    expect(gone.type).toBe('application/activity+json')
    expect(gone.body.type).toBe('Tombstone')
    expect(gone.body.id).toBe(`${ORIGIN}/users/${user}/feed/${post.id}`)
  })

  test('a deleted followers-only object stays 404 (no public tombstone)', async () => {
    const user = getTestUser()
    const activityId = await insertExercise(user)
    const post = await sharePost(user, activityId, { visibility: 'followers' })
    const app = buildFederatedApp()

    await deleteFeedPost(user, post.id)
    expect(await getFeedTombstone(user, post.id)).toBeNull()
    const res = await getObject(app, `/users/${user}/feed/${post.id}`)
    expect(res.status).toBe(404)
  })

  test('buildFeedUpdate wraps the post Note in an Update at the canonical object id', async () => {
    const user = getTestUser()
    const activityId = await insertExercise(user)
    const post = await sharePost(user, activityId)

    const ctx = await fed.createContext(new URL(ORIGIN))
    const update = await buildFeedUpdate(
      ctx,
      user,
      post,
      {
        activity_type: 'exercise',
        end_time: new Date('2026-07-01T07:11:00Z'),
        start_time: new Date('2026-07-01T06:30:00Z'),
        title: 'Morning run',
      },
      `${ORIGIN}/api`,
    )

    const noteId = `${ORIGIN}/users/${user}/feed/${post.id}`
    expect(update.id?.href).toBe(`${noteId}#update-${post.updated_at.getTime()}`)
    const object = await update.getObject()
    expect(object).toBeInstanceOf(Note)
    expect(object?.id?.href).toBe(noteId)
  })
})
