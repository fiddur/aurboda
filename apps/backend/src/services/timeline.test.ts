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
  object_uri: 'https://remote.example/notes/1',
  published_at: new Date('2026-07-01T08:00:00.000Z'),
  received_at: new Date('2026-07-01T08:00:05.000Z'),
  url: 'https://remote.example/@alice/1',
  ...over,
})

describe('serializeTimelineEntry', () => {
  test('maps a stored record to the DTO with an ISO published_at and no received_at', () => {
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
      url: 'https://remote.example/@alice/1',
    })
    // Ingest-only bookkeeping is not exposed.
    expect(dto).not.toHaveProperty('received_at')
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
    await getTimelinePage('user', 20, undefined, async (_u, limit, cursor) => {
      calls.push({ cursor, limit })
      return []
    })
    expect(calls).toEqual([{ cursor: undefined, limit: 21 }])
  })

  test('returns no next_cursor when the fetch yields at most `limit` rows', async () => {
    const page = await getTimelinePage('user', 20, undefined, async () => rows(20))
    expect(page.entries).toHaveLength(20)
    expect(page.next_cursor).toBeNull()
  })

  test('trims the sentinel row and emits a next_cursor when there are more', async () => {
    const page = await getTimelinePage('user', 20, undefined, async () => rows(21))
    expect(page.entries).toHaveLength(20)
    expect(page.next_cursor).toEqual(expect.any(String))
  })

  test('a next_cursor round-trips back to the (published_at, id) of the last returned row', async () => {
    const first = await getTimelinePage('user', 2, undefined, async () => rows(3))
    const lastEntry = first.entries[first.entries.length - 1]

    let received: TimelineCursor | undefined
    await getTimelinePage('user', 2, first.next_cursor ?? undefined, async (_u, _l, cursor) => {
      received = cursor
      return []
    })
    expect(received?.id).toBe(lastEntry.id)
    expect(received?.published_at.toISOString()).toBe(lastEntry.published_at)
  })

  test('treats a malformed cursor as the first page (undefined) rather than throwing', async () => {
    let received: TimelineCursor | undefined = { id: 'sentinel', published_at: new Date(0) }
    await getTimelinePage('user', 20, 'not-a-valid-cursor!!', async (_u, _l, cursor) => {
      received = cursor
      return []
    })
    expect(received).toBeUndefined()
  })
})
