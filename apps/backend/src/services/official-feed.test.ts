import { describe, expect, test } from 'vitest'

import type { ServerSettings } from './central-db.ts'

import {
  mergeOfficialFeedPage,
  normalizeOfficialFeedSetting,
  type OfficialFeedRow,
  readOfficialFeedSetting,
  withoutOfficialFeedUser,
  writeOfficialFeedSetting,
} from './official-feed.ts'

const settingsDb = (initial: Partial<ServerSettings>) => {
  const values: Partial<ServerSettings> = { ...initial }
  return {
    getServerSetting: async <K extends keyof ServerSettings>(key: K) => values[key] ?? null,
    setServerSetting: async <K extends keyof ServerSettings>(key: K, value: ServerSettings[K]) => {
      values[key] = value
    },
    values,
  }
}

describe('readOfficialFeedSetting', () => {
  test('is off when nothing is set', async () => {
    expect(await readOfficialFeedSetting(settingsDb({}))).toEqual({ tags: [], users: [] })
  })

  test('reads the legacy blog_username as a one-user feed without a tag filter', async () => {
    expect(await readOfficialFeedSetting(settingsDb({ blog_username: 'fiddur' }))).toEqual({
      tags: [],
      users: ['fiddur'],
    })
  })

  test('prefers the stored setting, even an empty one, over the legacy name', async () => {
    const db = settingsDb({ blog_username: 'fiddur', official_feed: { tags: ['aurboda'], users: ['alice'] } })
    expect(await readOfficialFeedSetting(db)).toEqual({ tags: ['aurboda'], users: ['alice'] })
    db.values.official_feed = { tags: [], users: [] }
    expect(await readOfficialFeedSetting(db)).toEqual({ tags: [], users: [] })
  })
})

describe('writeOfficialFeedSetting', () => {
  test('stores the setting and clears the legacy blog_username', async () => {
    const db = settingsDb({ blog_username: 'fiddur' })
    await writeOfficialFeedSetting(db, { tags: ['aurboda'], users: ['fiddur', 'alice'] })
    expect(db.values.official_feed).toEqual({ tags: ['aurboda'], users: ['fiddur', 'alice'] })
    expect(db.values.blog_username).toBe('')
    expect(await readOfficialFeedSetting(db)).toEqual({ tags: ['aurboda'], users: ['fiddur', 'alice'] })
  })
})

describe('normalizeOfficialFeedSetting', () => {
  test('stores tags lowercase without # and dedupes users and tags in first-seen order', () => {
    expect(
      normalizeOfficialFeedSetting({
        tags: ['#Aurboda', 'running', 'aurboda', '#Löpning'],
        users: [' fiddur', 'alice', 'fiddur'],
      }),
    ).toEqual({ tags: ['aurboda', 'running', 'löpning'], users: ['fiddur', 'alice'] })
  })

  test('keeps up to 20 tags, more than a single post may carry', () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag${i}`)
    expect(normalizeOfficialFeedSetting({ tags, users: [] }).tags).toEqual(tags)
  })
})

describe('withoutOfficialFeedUser', () => {
  test('drops a listed user and is null for one not listed', () => {
    const setting = { tags: ['qs'], users: ['alice', 'bob'] }
    expect(withoutOfficialFeedUser(setting, 'alice')).toEqual({ tags: ['qs'], users: ['bob'] })
    expect(withoutOfficialFeedUser(setting, 'carol')).toBeNull()
  })
})

interface Row extends OfficialFeedRow {
  label: string
}

const row = (label: string, cursor_ts: string, id: string): Row => ({ cursor_ts, id, label })

const missingDatabase = () =>
  Object.assign(new Error('database "aurboda_ghost" does not exist'), { code: '3D000' })

describe('mergeOfficialFeedPage', () => {
  const alice = [
    row('a3', '2026-07-03 10:00:00.000002+00', '00000000-0000-4000-8000-00000000000a'),
    row('a2', '2026-07-02 10:00:00+00', '00000000-0000-4000-8000-00000000000b'),
    row('a1', '2026-07-01 10:00:00+00', '00000000-0000-4000-8000-00000000000c'),
  ]
  const bob = [
    // Same millisecond as a3, one microsecond earlier.
    row('b3', '2026-07-03 12:00:00.000001+02', '00000000-0000-4000-8000-0000000000ff'),
    // Same instant as a2: the larger id sorts first, as in Postgres.
    row('b2', '2026-07-02 10:00:00+00', '00000000-0000-4000-8000-0000000000aa'),
  ]
  const fetchFrom = (rows: Record<string, Row[]>, calls: [string, number][] = []) => ({
    calls,
    fetchUser: async (username: string, limit: number) => {
      calls.push([username, limit])
      if (!(username in rows)) throw missingDatabase()
      return rows[username].slice(0, limit)
    },
  })

  test('merges users newest first by (created_at, id) at µs precision', async () => {
    const { calls, fetchUser } = fetchFrom({ alice, bob })
    const page = await mergeOfficialFeedPage({ fetchUser, limit: 10, users: ['alice', 'bob'] })
    expect(page.rows.map((r) => `${r.username}:${r.row.label}`)).toEqual([
      'alice:a3',
      'bob:b3',
      'bob:b2',
      'alice:a2',
      'alice:a1',
    ])
    expect(page.next).toBeNull()
    expect(calls).toEqual([
      ['alice', 11],
      ['bob', 11],
    ])
  })

  test('takes the page size and points the cursor at the last row taken', async () => {
    const { fetchUser } = fetchFrom({ alice, bob })
    const page = await mergeOfficialFeedPage({ fetchUser, limit: 3, users: ['alice', 'bob'] })
    expect(page.rows.map((r) => r.row.label)).toEqual(['a3', 'b3', 'b2'])
    expect(page.next?.label).toBe('b2')
  })

  test('has no next page when exactly the page size is left', async () => {
    const { fetchUser } = fetchFrom({ alice, bob })
    const page = await mergeOfficialFeedPage({ fetchUser, limit: 5, users: ['alice', 'bob'] })
    expect(page.rows).toHaveLength(5)
    expect(page.next).toBeNull()
  })

  test('skips a user whose database is missing, and reports it', async () => {
    const { fetchUser } = fetchFrom({ alice })
    const missing: string[] = []
    const page = await mergeOfficialFeedPage({
      fetchUser,
      limit: 10,
      onMissingUser: (username) => missing.push(username),
      users: ['ghost', 'alice'],
    })
    expect(page.rows.map((r) => r.row.label)).toEqual(['a3', 'a2', 'a1'])
    expect(missing).toEqual(['ghost'])
  })

  test('lets any other error through', async () => {
    const fetchUser = async () => {
      throw new Error('connection refused')
    }
    await expect(mergeOfficialFeedPage({ fetchUser, limit: 10, users: ['alice'] })).rejects.toThrow(
      'connection refused',
    )
  })
})
