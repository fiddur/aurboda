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
  listUnenrichedAurbodaEntries,
  markEnrichTransientFailure,
  setTimelineEntryStructured,
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
    // `inserted` drives "ping live subscribers only for a genuinely new post": true
    // on the first insert, false on the re-delivery (the ON CONFLICT update path).
    const first = await upsertTimelineEntry(user, entry(1))
    expect(first.inserted).toBe(true)
    const edited = await upsertTimelineEntry(user, entry(1, { content: '<p>edited</p>' }))
    expect(edited.inserted).toBe(false)
    expect(edited.content).toBe('<p>edited</p>')
    expect(await listTimelineEntries(user, 10)).toHaveLength(1)
  })

  test('stores + reads back the structured payload (JSONB); plain posts are null', async () => {
    const user = getTestUser()
    const structured = {
      activity_type: 'exercise',
      duration_seconds: 1800,
      end_time: '2026-07-01T08:30:00.000Z',
      kind: 'activity' as const,
      metrics: [
        { key: 'heart_rate_avg', unit: 'bpm', value: 142 },
        { key: 'hr_zone_minutes', value: { z2: 22, z3: 8 } },
      ],
      series: [
        {
          bucket: '5s',
          metric: 'heart_rate',
          samples: [
            {
              avg: 140,
              count: 3,
              end: '2026-07-01T08:00:05.000Z',
              max: 145,
              min: 138,
              start: '2026-07-01T08:00:00.000Z',
            },
          ],
          unit: 'bpm',
        },
      ],
      start_time: '2026-07-01T08:00:00.000Z',
    }
    const rec = await upsertTimelineEntry(user, entry(1, { structured }))
    expect(rec.structured).toEqual(structured)
    expect((await listTimelineEntries(user, 10))[0].structured).toEqual(structured)

    // A post without structured data stores null (Mastodon / non-Aurboda).
    const plain = await upsertTimelineEntry(user, entry(2))
    expect(plain.structured).toBeNull()
  })

  test('stores + reads back image attachments (JSONB); plain posts are null', async () => {
    const user = getTestUser()
    const images = [
      {
        height: 420,
        media_type: 'image/png',
        name: 'Heart rate',
        url: 'https://aurboda.net/api/public/bob/feed/abc/chart.png?token=t',
        width: 1000,
      },
    ]
    const rec = await upsertTimelineEntry(user, entry(1, { images }))
    expect(rec.images).toEqual(images)
    expect((await listTimelineEntries(user, 10))[0].images).toEqual(images)

    const plain = await upsertTimelineEntry(user, entry(2))
    expect(plain.images).toBeNull()
  })

  test('a re-delivery without structured keeps the last-known structured (COALESCE)', async () => {
    const user = getTestUser()
    const structured = {
      activity_type: 'exercise',
      kind: 'activity' as const,
      metrics: [{ key: 'distance', unit: 'km', value: 5 }],
      series: [],
      start_time: '2026-07-01T08:00:00.000Z',
    }
    await upsertTimelineEntry(user, entry(1, { structured }))
    // An edit/redelivery whose enrichment failed (structured undefined) must not
    // wipe the working chart.
    const edited = await upsertTimelineEntry(user, entry(1, { content: '<p>edited</p>' }))
    expect(edited.content).toBe('<p>edited</p>')
    expect(edited.structured).toEqual(structured)
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

  test('stores in_reply_to_uri and filters replies-to-others per the reply filter (#1060)', async () => {
    const user = getTestUser()
    const ownPrefix = `https://aurboda.example/users/${user}/feed/`
    await upsertTimelineEntry(user, entry(1)) // top-level post
    await upsertTimelineEntry(user, entry(2, { in_reply_to_uri: 'https://mastodon.example/notes/1' }))
    const replyToMine = await upsertTimelineEntry(
      user,
      entry(3, { in_reply_to_uri: `${ownPrefix}11111111-1111-4111-8111-111111111111` }),
    )
    expect(replyToMine.in_reply_to_uri).toBe(`${ownPrefix}11111111-1111-4111-8111-111111111111`)

    // No filter (legacy callers): everything.
    expect(await listTimelineEntries(user, 10)).toHaveLength(3)
    // show_replies=false: top-level + the reply to the reader's own post only.
    const filtered = await listTimelineEntries(user, 10, undefined, {
      own_object_prefix: ownPrefix,
      show_replies: false,
    })
    expect(filtered.map((r) => r.object_uri)).toEqual([
      'https://mastodon.example/notes/3',
      'https://mastodon.example/notes/1',
    ])
    // show_replies=true: everything again.
    const all = await listTimelineEntries(user, 10, undefined, {
      own_object_prefix: ownPrefix,
      show_replies: true,
    })
    expect(all).toHaveLength(3)
  })

  test('deletes a single entry by object uri + authoring actor (inbound Delete)', async () => {
    const user = getTestUser()
    await upsertTimelineEntry(user, entry(1))
    await upsertTimelineEntry(user, entry(2))
    const alice = 'https://mastodon.example/users/alice'
    expect(await deleteTimelineEntryByUri(user, 'https://mastodon.example/notes/1', alice)).toBe(true)
    expect(await deleteTimelineEntryByUri(user, 'https://mastodon.example/notes/1', alice)).toBe(false)
    expect((await listTimelineEntries(user, 10)).map((e) => e.object_uri)).toEqual([
      'https://mastodon.example/notes/2',
    ])
  })

  test('does not delete an entry when the Delete is from a different actor (spoofed Delete)', async () => {
    const user = getTestUser()
    await upsertTimelineEntry(user, entry(1))
    // A signed Delete from some other actor must not evict alice's post.
    const attacker = 'https://evil.example/users/mallory'
    expect(await deleteTimelineEntryByUri(user, 'https://mastodon.example/notes/1', attacker)).toBe(false)
    expect((await listTimelineEntries(user, 10)).map((e) => e.object_uri)).toEqual([
      'https://mastodon.example/notes/1',
    ])
  })

  test('retro-enrichment: lists Aurboda-shaped unenriched entries, marks attempts (#996)', async () => {
    const user = getTestUser()
    const structured = {
      activity_type: 'exercise',
      kind: 'activity' as const,
      metrics: [{ key: 'distance', unit: 'km', value: 5 }],
      series: [],
      start_time: '2026-07-01T08:00:00.000Z',
    }
    const aurbodaUri = (n: number) =>
      `https://peer.example/users/bob/feed/00000000-0000-4000-8000-00000000000${n}`
    // 1: Aurboda-shaped, unenriched → candidate. 2: Mastodon → never a candidate.
    // 3: Aurboda-shaped but already enriched → not a candidate.
    const one = await upsertTimelineEntry(user, entry(1, { object_uri: aurbodaUri(1) }))
    await upsertTimelineEntry(user, entry(2))
    await upsertTimelineEntry(user, entry(3, { object_uri: aurbodaUri(3), structured }))

    const candidates = await listUnenrichedAurbodaEntries(user, 10)
    expect(candidates.map((c) => c.object_uri)).toEqual([aurbodaUri(1)])

    // A failed attempt (null) stamps the entry without inventing a payload…
    await setTimelineEntryStructured(user, one.id, null)
    expect(await listUnenrichedAurbodaEntries(user, 10)).toEqual([])
    expect((await listTimelineEntries(user, 10)).find((e) => e.id === one.id)?.structured).toBeNull()

    // …and a successful one stores it (visible on the next read).
    await setTimelineEntryStructured(user, one.id, structured)
    expect((await listTimelineEntries(user, 10)).find((e) => e.id === one.id)?.structured).toEqual(structured)
  })

  test('retro-enrichment: transient failures stay retryable until the attempt cap stamps them (#1014)', async () => {
    const user = getTestUser()
    const uri = 'https://dead.example/users/bob/feed/00000000-0000-4000-8000-000000000001'
    const rec = await upsertTimelineEntry(user, entry(1, { object_uri: uri }))

    // Two failures below the cap: still a candidate.
    await markEnrichTransientFailure(user, rec.id, 3)
    await markEnrichTransientFailure(user, rec.id, 3)
    expect((await listUnenrichedAurbodaEntries(user, 10)).map((c) => c.id)).toEqual([rec.id])

    // The third hits the cap: stamped out of the candidate set for good.
    await markEnrichTransientFailure(user, rec.id, 3)
    expect(await listUnenrichedAurbodaEntries(user, 10)).toEqual([])
  })

  test('retro-enrichment: setTimelineEntryStructured never wipes an existing payload with null', async () => {
    const user = getTestUser()
    const structured = {
      activity_type: 'exercise',
      kind: 'activity' as const,
      metrics: [],
      series: [],
      start_time: '2026-07-01T08:00:00.000Z',
    }
    const rec = await upsertTimelineEntry(user, entry(1, { structured }))
    await setTimelineEntryStructured(user, rec.id, null)
    expect((await listTimelineEntries(user, 10))[0].structured).toEqual(structured)
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
