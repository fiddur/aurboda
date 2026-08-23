import { describe, expect, test } from 'vitest'

import type { TimelineCursor, TimelineEntryRecord } from '../db/index.ts'

import { getTimelinePage, serializeTimelineEntry } from './timeline.ts'

const record = (over: Partial<TimelineEntryRecord> = {}): TimelineEntryRecord => ({
  actor_uri: 'https://remote.example/users/alice',
  avatar_url: 'https://remote.example/avatars/alice.png',
  content: '<p>Ran a 5k</p>',
  display_name: 'Alice',
  handle: '@alice@remote.example',
  id: '00000000-0000-0000-0000-000000000001',
  images: null,
  in_reply_to_uri: null,
  object_uri: 'https://remote.example/notes/1',
  published_at: new Date('2026-07-01T08:00:00.000Z'),
  received_at: new Date('2026-07-01T08:00:05.000Z'),
  structured: null,
  url: 'https://remote.example/@alice/1',
  ...over,
})

describe('serializeTimelineEntry', () => {
  test('maps a stored record to the DTO with ISO timestamps', () => {
    const dto = serializeTimelineEntry(record())
    expect(dto).toEqual({
      actor_uri: 'https://remote.example/users/alice',
      avatar_url: 'https://remote.example/avatars/alice.png',
      content: '<p>Ran a 5k</p>',
      display_name: 'Alice',
      handle: '@alice@remote.example',
      id: '00000000-0000-0000-0000-000000000001',
      object_uri: 'https://remote.example/notes/1',
      published_at: '2026-07-01T08:00:00.000Z',
      received_at: '2026-07-01T08:00:05.000Z',
      url: 'https://remote.example/@alice/1',
    })
    // A top-level post carries no reply fields at all.
    expect(dto).not.toHaveProperty('in_reply_to_uri')
  })

  test('marks a reply to the reader’s own post when given the own-object prefix', () => {
    const reply = record({ in_reply_to_uri: 'https://aurboda.example/users/me/feed/abc' })
    const mine = serializeTimelineEntry(reply, 'https://aurboda.example/users/me/feed/')
    expect(mine.in_reply_to_uri).toBe('https://aurboda.example/users/me/feed/abc')
    expect(mine.in_reply_to_mine).toBe(true)

    const other = serializeTimelineEntry(
      record({ in_reply_to_uri: 'https://remote.example/notes/9' }),
      'https://aurboda.example/users/me/feed/',
    )
    expect(other.in_reply_to_mine).toBe(false)
  })
})

describe('getTimelinePage', () => {
  const rows = (n: number): TimelineEntryRecord[] =>
    Array.from({ length: n }, (_, i) =>
      record({
        id: `00000000-0000-0000-0000-00000000000${i}`,
        object_uri: `https://remote.example/notes/${i}`,
        published_at: new Date(Date.UTC(2026, 6, 1, 8, 0, n - i)), // newest first
      }),
    )

  test('requests limit + 1 rows and passes a decoded cursor of undefined on the first page', async () => {
    const calls: { limit: number; cursor?: TimelineCursor }[] = []
    await getTimelinePage('user', 20, undefined, {
      fetchEntries: async (_u, limit, cursor) => {
        calls.push({ cursor, limit })
        return []
      },
    })
    expect(calls).toEqual([{ cursor: undefined, limit: 21 }])
  })

  test('threads the reply filter from settings + origin down to the fetcher', async () => {
    let seen: unknown
    await getTimelinePage('freja', 20, undefined, {
      fetchEntries: async (_u, _l, _c, replies) => {
        seen = replies
        return []
      },
      loadSettings: async () => ({ timeline_show_replies: false }),
      origin: 'https://aurboda.example/',
    })
    expect(seen).toEqual({
      own_object_prefix: 'https://aurboda.example/users/freja/feed/',
      show_replies: false,
    })
  })

  test('returns no next_cursor when the fetch yields at most `limit` rows', async () => {
    const page = await getTimelinePage('user', 20, undefined, { fetchEntries: async () => rows(20) })
    expect(page.entries).toHaveLength(20)
    expect(page.next_cursor).toBeNull()
  })

  test('trims the sentinel row and emits a next_cursor when there are more', async () => {
    const page = await getTimelinePage('user', 20, undefined, { fetchEntries: async () => rows(21) })
    expect(page.entries).toHaveLength(20)
    expect(page.next_cursor).toEqual(expect.any(String))
  })

  test('a next_cursor round-trips back to the (published_at, id) of the last returned row', async () => {
    const first = await getTimelinePage('user', 2, undefined, { fetchEntries: async () => rows(3) })
    const lastEntry = first.entries[first.entries.length - 1]

    let received: TimelineCursor | undefined
    await getTimelinePage('user', 2, first.next_cursor ?? undefined, {
      fetchEntries: async (_u, _l, cursor) => {
        received = cursor
        return []
      },
    })
    expect(received?.id).toBe(lastEntry.id)
    expect(received?.published_at.toISOString()).toBe(lastEntry.published_at)
  })

  test('treats a malformed cursor as the first page (undefined) rather than throwing', async () => {
    let received: TimelineCursor | undefined = { id: 'sentinel', published_at: new Date(0) }
    await getTimelinePage('user', 20, 'not-a-valid-cursor!!', {
      fetchEntries: async (_u, _l, cursor) => {
        received = cursor
        return []
      },
    })
    expect(received).toBeUndefined()
  })

  test('rejects a structurally-valid cursor whose id is not a UUID (avoids a $::uuid 500)', async () => {
    // `12345:not-a-uuid` base64url-decodes with a safe-integer ms but a non-UUID id;
    // it must decode to undefined (first page) rather than reaching the uuid cast.
    const crafted = Buffer.from('12345:not-a-uuid').toString('base64url')
    let received: TimelineCursor | undefined = { id: 'sentinel', published_at: new Date(0) }
    await getTimelinePage('user', 20, crafted, {
      fetchEntries: async (_u, _l, cursor) => {
        received = cursor
        return []
      },
    })
    expect(received).toBeUndefined()
  })
})
