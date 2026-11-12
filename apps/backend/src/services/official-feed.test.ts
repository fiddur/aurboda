import { describe, expect, test } from 'vitest'

import type { ServerSettings } from './central-db.ts'

import {
  DEFAULT_OFFICIAL_FEED,
  ensureDefaultOfficialFeed,
  isOfficialFeedOn,
  mergeOfficialFeedPage,
  normalizeOfficialFeedSetting,
  type OfficialFeedEntryRow,
  type OfficialFeedRow,
  officialRemoteHandles,
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
    expect(await readOfficialFeedSetting(settingsDb({}))).toEqual({ remote_authors: [], tags: [], users: [] })
  })

  test('reads the legacy blog_username as a one-user feed without a tag filter', async () => {
    expect(await readOfficialFeedSetting(settingsDb({ blog_username: 'fiddur' }))).toEqual({
      remote_authors: [],
      tags: [],
      users: ['fiddur'],
    })
  })

  test('prefers the stored setting, even an empty one, over the legacy name', async () => {
    const feed = { remote_authors: ['bob@peer.example'], tags: ['aurboda'], users: ['alice'] }
    const db = settingsDb({ blog_username: 'fiddur', official_feed: feed })
    expect(await readOfficialFeedSetting(db)).toEqual(feed)
    db.values.official_feed = { remote_authors: [], tags: [], users: [] }
    expect(await readOfficialFeedSetting(db)).toEqual({ remote_authors: [], tags: [], users: [] })
  })

  test('reads a setting stored before remote authors existed as having none', async () => {
    const db = settingsDb({ official_feed: { tags: ['qs'], users: ['alice'] } as never })
    expect(await readOfficialFeedSetting(db)).toEqual({ remote_authors: [], tags: ['qs'], users: ['alice'] })
  })
})

describe('ensureDefaultOfficialFeed', () => {
  const countUsers = (n: number) => async () => n

  test('stores the Aurboda blog on a fresh installation', async () => {
    const db = settingsDb({})
    expect(await ensureDefaultOfficialFeed({ centralDb: db, countUsers: countUsers(0) })).toBe(true)
    expect(db.values.official_feed).toEqual({
      remote_authors: ['fiddur@aurboda.net'],
      tags: ['aurbodablog'],
      users: [],
    })
    expect(isOfficialFeedOn(await readOfficialFeedSetting(db))).toBe(true)
  })

  test('leaves an installation that has users alone', async () => {
    const db = settingsDb({})
    expect(await ensureDefaultOfficialFeed({ centralDb: db, countUsers: countUsers(1) })).toBe(false)
    expect(db.values.official_feed).toBeUndefined()
  })

  test('leaves a stored setting alone, even an empty one', async () => {
    const db = settingsDb({ official_feed: { remote_authors: [], tags: [], users: [] } })
    expect(await ensureDefaultOfficialFeed({ centralDb: db, countUsers: countUsers(0) })).toBe(false)
    expect(db.values.official_feed).toEqual({ remote_authors: [], tags: [], users: [] })
  })

  test('leaves a legacy blog user alone', async () => {
    const db = settingsDb({ blog_username: 'fiddur' })
    expect(await ensureDefaultOfficialFeed({ centralDb: db, countUsers: countUsers(0) })).toBe(false)
    expect(db.values.official_feed).toBeUndefined()
  })

  test('does not count users when the setting decides', async () => {
    const db = settingsDb({ blog_username: 'fiddur' })
    const count = async () => {
      throw new Error('should not be called')
    }
    expect(await ensureDefaultOfficialFeed({ centralDb: db, countUsers: count })).toBe(false)
  })
})

describe('isOfficialFeedOn and officialRemoteHandles', () => {
  test('is on with local users or remote authors', () => {
    expect(isOfficialFeedOn({ remote_authors: [], tags: [], users: [] })).toBe(false)
    expect(isOfficialFeedOn({ remote_authors: [], tags: [], users: ['alice'] })).toBe(true)
    expect(isOfficialFeedOn(DEFAULT_OFFICIAL_FEED)).toBe(true)
  })

  test('maps remote authors to the stored handle form, lowercased', () => {
    expect(officialRemoteHandles({ remote_authors: ['Fiddur@aurboda.net', 'bob@peer.example'] })).toEqual([
      '@fiddur@aurboda.net',
      '@bob@peer.example',
    ])
  })
})

describe('writeOfficialFeedSetting', () => {
  test('stores the setting and clears the legacy blog_username', async () => {
    const db = settingsDb({ blog_username: 'fiddur' })
    const feed = { remote_authors: [], tags: ['aurboda'], users: ['fiddur', 'alice'] }
    await writeOfficialFeedSetting(db, feed)
    expect(db.values.official_feed).toEqual(feed)
    expect(db.values.blog_username).toBe('')
    expect(await readOfficialFeedSetting(db)).toEqual(feed)
  })
})

describe('normalizeOfficialFeedSetting', () => {
  test('stores tags lowercase without # and dedupes users and tags in first-seen order', () => {
    expect(
      normalizeOfficialFeedSetting({
        tags: ['#Aurboda', 'running', 'aurboda', '#Löpning'],
        users: [' fiddur', 'alice', 'fiddur'],
      }),
    ).toEqual({ remote_authors: [], tags: ['aurboda', 'running', 'löpning'], users: ['fiddur', 'alice'] })
  })

  test('stores remote authors as user@host, deduplicated ignoring case, and moves this server’s to users', () => {
    expect(
      normalizeOfficialFeedSetting(
        {
          remote_authors: [
            '@fiddur@Aurboda.net',
            'Fiddur@aurboda.net',
            ' bob@peer.example ',
            '@alice@QS.example',
          ],
          tags: ['qs'],
          users: ['alice', 'carol'],
        },
        'https://qs.example',
      ),
    ).toEqual({
      remote_authors: ['fiddur@aurboda.net', 'bob@peer.example'],
      tags: ['qs'],
      users: ['alice', 'carol'],
    })
  })

  test('keeps every remote author when this server’s origin is unknown', () => {
    expect(
      normalizeOfficialFeedSetting({ remote_authors: ['alice@qs.example'], tags: [], users: [] })
        .remote_authors,
    ).toEqual(['alice@qs.example'])
  })

  test('keeps up to 20 tags, more than a single post may carry', () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag${i}`)
    expect(normalizeOfficialFeedSetting({ remote_authors: [], tags, users: [] }).tags).toEqual(tags)
  })
})

describe('withoutOfficialFeedUser', () => {
  test('drops a listed user and is null for one not listed', () => {
    const setting = { remote_authors: ['bob@peer.example'], tags: ['qs'], users: ['alice', 'bob'] }
    expect(withoutOfficialFeedUser(setting, 'alice')).toEqual({
      remote_authors: ['bob@peer.example'],
      tags: ['qs'],
      users: ['bob'],
    })
    expect(withoutOfficialFeedUser(setting, 'carol')).toBeNull()
  })
})

interface Row extends OfficialFeedRow {
  label: string
}

const row = (label: string, cursor_ts: string, id: string): Row => ({ cursor_ts, id, label })

const describeEntry = (entry: OfficialFeedEntryRow<Row, Row>): string =>
  entry.origin === 'local' ? `${entry.username}:${entry.row.label}` : `remote:${entry.row.label}`

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
    expect(page.rows.map(describeEntry)).toEqual(['alice:a3', 'bob:b3', 'bob:b2', 'alice:a2', 'alice:a1'])
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

  const remote = [
    row('r2', '2026-07-03 09:30:00+00', '00000000-0000-4000-8000-000000000001'),
    // Same instant as a2 with a smaller id: sorts after it.
    row('r1', '2026-07-02 10:00:00+00', '00000000-0000-4000-8000-000000000001'),
  ]

  test('merges the remote source with the users by the same key', async () => {
    const { fetchUser } = fetchFrom({ alice, bob })
    const remoteCalls: number[] = []
    const page = await mergeOfficialFeedPage<Row, Row>({
      fetchRemote: async (limit) => {
        remoteCalls.push(limit)
        return remote.slice(0, limit)
      },
      fetchUser,
      limit: 10,
      users: ['alice', 'bob'],
    })
    expect(page.rows.map(describeEntry)).toEqual([
      'alice:a3',
      'bob:b3',
      'remote:r2',
      'bob:b2',
      'alice:a2',
      'remote:r1',
      'alice:a1',
    ])
    expect(remoteCalls).toEqual([11])
  })

  test('pages a remote-only feed, the cursor pointing at a remote row', async () => {
    const page = await mergeOfficialFeedPage<Row, Row>({
      fetchRemote: async (limit) => remote.slice(0, limit),
      fetchUser: async () => [],
      limit: 1,
      users: [],
    })
    expect(page.rows.map(describeEntry)).toEqual(['remote:r2'])
    expect(page.next?.label).toBe('r2')
  })
})
