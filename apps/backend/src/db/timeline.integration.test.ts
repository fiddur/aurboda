import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

/**
 * Integration tests for the home-timeline store (posts received from followed
 * actors), including keyset pagination by (published_at DESC, id DESC).
 */
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  deleteTimelineEntriesByActor,
  deleteTimelineEntryByUri,
  listTimelineEntries,
  type TimelineEntryInput,
  upsertTimelineEntry,
} from './timeline.ts'

const CONTAINER_TIMEOUT = 120_000

const entry = (n: number, overrides: Partial<TimelineEntryInput> = {}): TimelineEntryInput => ({
  actor_uri: 'https://mastodon.example/users/alice',
  avatar_url: 'https://mastodon.example/avatars/alice.png',
  content: `<p>post ${n}</p>`,
  display_name: 'Alice',
  handle: '@alice@mastodon.example',
  object_uri: `https://mastodon.example/notes/${n}`,
  published_at: new Date(`2026-07-01T10:0${n}:00Z`),
  url: `https://mastodon.example/@alice/${n}`,
  ...overrides,
})

describe('Timeline store integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('stores a received post with its sanitised content + author snapshot', async () => {
    const user = getTestUser()
    const rec = await upsertTimelineEntry(user, entry(1))
    expect(rec.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(rec.object_uri).toBe('https://mastodon.example/notes/1')
    expect(rec.actor_uri).toBe('https://mastodon.example/users/alice')
    expect(rec.handle).toBe('@alice@mastodon.example')
    expect(rec.content).toBe('<p>post 1</p>')
    expect(rec.published_at.toISOString()).toBe('2026-07-01T10:01:00.000Z')
  })

  test('re-delivering the same object upserts in place (an edit replaces content)', async () => {
    const user = getTestUser()
    await upsertTimelineEntry(user, entry(1))
    const edited = await upsertTimelineEntry(user, entry(1, { content: '<p>edited</p>' }))
    expect(edited.content).toBe('<p>edited</p>')
    expect(await listTimelineEntries(user, 10)).toHaveLength(1)
  })

  test('lists newest-first and keyset-paginates by (published_at, id)', async () => {
    const user = getTestUser()
    for (const n of [1, 2, 3, 4, 5]) await upsertTimelineEntry(user, entry(n))

    const page1 = await listTimelineEntries(user, 2)
    expect(page1.map((e) => e.object_uri)).toEqual([
      'https://mastodon.example/notes/5',
      'https://mastodon.example/notes/4',
    ])

    const last = page1[page1.length - 1]
    const page2 = await listTimelineEntries(user, 2, { id: last.id, published_at: last.published_at })
    expect(page2.map((e) => e.object_uri)).toEqual([
      'https://mastodon.example/notes/3',
      'https://mastodon.example/notes/2',
    ])

    const last2 = page2[page2.length - 1]
    const page3 = await listTimelineEntries(user, 2, { id: last2.id, published_at: last2.published_at })
    expect(page3.map((e) => e.object_uri)).toEqual(['https://mastodon.example/notes/1'])
  })

  test('deletes a single entry by object uri (inbound Delete)', async () => {
    const user = getTestUser()
    await upsertTimelineEntry(user, entry(1))
    await upsertTimelineEntry(user, entry(2))
    expect(await deleteTimelineEntryByUri(user, 'https://mastodon.example/notes/1')).toBe(true)
    expect(await deleteTimelineEntryByUri(user, 'https://mastodon.example/notes/1')).toBe(false)
    expect((await listTimelineEntries(user, 10)).map((e) => e.object_uri)).toEqual([
      'https://mastodon.example/notes/2',
    ])
  })

  test('purges every entry from an actor (on unfollow)', async () => {
    const user = getTestUser()
    await upsertTimelineEntry(user, entry(1))
    await upsertTimelineEntry(user, entry(2))
    await upsertTimelineEntry(user, entry(3, { actor_uri: 'https://remote.example/users/bob' }))

    expect(await deleteTimelineEntriesByActor(user, 'https://mastodon.example/users/alice')).toBe(2)
    expect((await listTimelineEntries(user, 10)).map((e) => e.actor_uri)).toEqual([
      'https://remote.example/users/bob',
    ])
  })
})
