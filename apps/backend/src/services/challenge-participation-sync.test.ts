import { describe, expect, test } from 'vitest'

import type {
  ChallengeMemberRecord,
  ChallengeParticipationRecord,
  ChallengeParticipationSnapshotPatch,
  ChallengeRecord,
  ChallengeSpecFields,
} from '../db/index.ts'

import {
  HOST_CHECK_INTERVAL_MS,
  type HostChallengeSnapshot,
  type ListFreshDeps,
  listParticipationsFresh,
  participationDrift,
  pushChallengeToLocalMembers,
  type PushDeps,
} from './challenge-participation-sync.ts'

const WEB_HOST = 'https://aurboda.example'
const NOW = new Date('2026-11-15T12:00:00Z')

const spec: ChallengeSpecFields = {
  activity_type_id: null,
  aggregation: 'sum',
  bucket_size: '1d',
  filter_field: null,
  filter_value: null,
  measure: null,
  pattern: 'steps',
  source_type: 'metric',
  unit: 'steps',
}

const challenge = (overrides: Partial<ChallengeRecord> = {}): ChallengeRecord => ({
  announce_winner: false,
  banner_updated_at: null,
  created_at: new Date('2026-10-01T00:00:00Z'),
  end_ts: new Date('2026-12-01T00:00:00Z'),
  id: 'c1',
  is_public: true,
  join_token: 'jt',
  name: 'November steps',
  result_published_at: null,
  slug: 'nov',
  spec,
  start_ts: new Date('2026-11-01T00:00:00Z'),
  timezone: 'UTC',
  updated_at: new Date('2026-10-01T00:00:00Z'),
  ...overrides,
})

const participation = (
  overrides: Partial<ChallengeParticipationRecord> = {},
): ChallengeParticipationRecord => ({
  challenge_url: `${WEB_HOST}/u/alice/nov`,
  created_at: new Date('2026-10-02T00:00:00Z'),
  data_token: 'tok',
  end_ts: new Date('2026-12-01T00:00:00Z'),
  host_checked_at: null,
  host_identity: `${WEB_HOST}/u/alice`,
  id: 'p1',
  name: 'November steps',
  protocol: 'aurboda',
  spec,
  start_ts: new Date('2026-11-01T00:00:00Z'),
  status: 'active',
  timezone: 'UTC',
  ...overrides,
})

const member = (overrides: Partial<ChallengeMemberRecord>): ChallengeMemberRecord => ({
  actor: null,
  cached_buckets: null,
  cached_total: null,
  challenge_id: 'c1',
  data_endpoint_url: null,
  data_last_updated: null,
  display_name: 'm',
  id: 'm',
  identity_base_url: 'https://x/u/m',
  joined_at: new Date('2026-10-01T00:00:00Z'),
  kind: 'local',
  last_error: null,
  last_fetched_at: null,
  local_user: null,
  status: 'active',
  ...overrides,
})

type Update = { user: string; id: string; patch: ChallengeParticipationSnapshotPatch }

const recordingUpdate = (updates: Update[], fail: (user: string) => boolean = () => false) =>
  (async (user, id, patch) => {
    if (fail(user)) throw new Error('database down')
    updates.push({ id, patch, user })
    return null
  }) as PushDeps['updateChallengeParticipationSnapshot']

describe('participationDrift', () => {
  test('null when the participation matches the host', () => {
    expect(participationDrift(participation(), challenge())).toBeNull()
    expect(
      participationDrift(
        participation({ end_ts: new Date('2026-12-01T00:00:00.000Z') }),
        challenge({ spec: { ...spec } }),
      ),
    ).toBeNull()
  })

  test('carries only what differs', () => {
    expect(participationDrift(participation(), challenge({ name: 'Renamed' }))).toEqual({ name: 'Renamed' })
    const moved = challenge({
      end_ts: new Date('2026-12-15T00:00:00Z'),
      spec: { ...spec, pattern: 'distance', unit: 'km' },
      start_ts: new Date('2026-11-02T00:00:00Z'),
      timezone: 'Europe/Stockholm',
    })
    expect(participationDrift(participation(), moved)).toEqual({
      end_ts: moved.end_ts,
      spec: moved.spec,
      start_ts: moved.start_ts,
      timezone: 'Europe/Stockholm',
    })
  })
})

describe('pushChallengeToLocalMembers', () => {
  const renamed = challenge({ end_ts: new Date('2026-12-15T00:00:00Z'), name: 'Renamed' })

  test("patches local members' participations, by the challenge's canonical URL, and skips remote ones", async () => {
    const updates: Update[] = []
    const lookups: string[] = []
    await pushChallengeToLocalMembers('alice', renamed, `${WEB_HOST}/`, {
      listChallengeParticipations: async (user) => {
        lookups.push(user)
        return user === 'carol'
          ? [participation({ challenge_url: `${WEB_HOST}/u/alice/other`, id: 'p-other' })]
          : [
              participation({ challenge_url: `${WEB_HOST}/u/alice/other`, id: 'p-other' }),
              participation({ id: `p-${user}` }),
            ]
      },
      listChallengeMembers: async () => [
        member({ local_user: 'alice' }),
        member({ local_user: 'bob' }),
        member({ local_user: 'carol' }),
        member({ identity_base_url: 'https://remote.example/u/dave', kind: 'remote', local_user: null }),
        member({ kind: 'local', local_user: null }),
      ],
      updateChallengeParticipationSnapshot: recordingUpdate(updates),
    })
    expect(lookups).toEqual(['alice', 'bob', 'carol'])
    expect(updates).toEqual([
      { id: 'p-alice', patch: { end_ts: renamed.end_ts, name: 'Renamed' }, user: 'alice' },
      { id: 'p-bob', patch: { end_ts: renamed.end_ts, name: 'Renamed' }, user: 'bob' },
    ])
  })

  test('one failing member does not stop the others, and nothing throws', async () => {
    const updates: Update[] = []
    await expect(
      pushChallengeToLocalMembers('alice', renamed, WEB_HOST, {
        listChallengeParticipations: async (user) => {
          if (user === 'bob') throw new Error('no such database')
          return [participation({ id: `p-${user}` })]
        },
        listChallengeMembers: async () => [
          member({ local_user: 'bob' }),
          member({ local_user: 'carol' }),
          member({ local_user: 'erin' }),
        ],
        updateChallengeParticipationSnapshot: recordingUpdate(updates, (user) => user === 'carol'),
      }),
    ).resolves.toBeUndefined()
    expect(updates.map((u) => u.user)).toEqual(['erin'])
  })

  test('a participation already in line is not written', async () => {
    const updates: Update[] = []
    await pushChallengeToLocalMembers('alice', challenge(), WEB_HOST, {
      listChallengeMembers: async () => [member({ local_user: 'bob' })],
      listChallengeParticipations: async () => [participation()],
      updateChallengeParticipationSnapshot: recordingUpdate(updates),
    })
    expect(updates).toEqual([])
  })

  test('finds a participation stored under another spelling of the challenge url', async () => {
    const updates: Update[] = []
    await pushChallengeToLocalMembers('alice', renamed, WEB_HOST, {
      listChallengeMembers: async () => [member({ local_user: 'bob' })],
      listChallengeParticipations: async () => [
        participation({ challenge_url: 'https://AURBODA.example/u/alice/nov/?embed=1', id: 'p-old' }),
      ],
      updateChallengeParticipationSnapshot: recordingUpdate(updates),
    })
    expect(updates).toEqual([
      { id: 'p-old', patch: { end_ts: renamed.end_ts, name: 'Renamed' }, user: 'bob' },
    ])
  })
})

const listDeps = (
  participations: ChallengeParticipationRecord[],
  overrides: Partial<ListFreshDeps> = {},
): { deps: ListFreshDeps; updates: Update[]; tasks: Promise<void>[]; fetched: string[] } => {
  const updates: Update[] = []
  const tasks: Promise<void>[] = []
  const fetched: string[] = []
  const deps: ListFreshDeps = {
    background: (task) => {
      tasks.push(task())
    },
    fetchRemoteChallenge: async (parsed): Promise<HostChallengeSnapshot> => {
      fetched.push(`${parsed.base}/${parsed.username}/${parsed.slug}`)
      return {
        end_ts: '2027-01-01T00:00:00Z',
        name: 'Remote renamed',
        start_ts: '2026-11-03T00:00:00Z',
        timezone: 'Asia/Tokyo',
      }
    },
    getChallengeBySlug: async () => null,
    listChallengeParticipations: async () => participations,
    now: () => NOW,
    updateChallengeParticipationSnapshot: async (user, id, patch) => {
      updates.push({ id, patch, user })
      const current = participations.find((p) => p.id === id)
      return current
        ? { ...current, ...patch, host_checked_at: patch.host_checked_at ?? current.host_checked_at }
        : null
    },
    ...overrides,
  }
  return { deps, fetched, tasks, updates }
}

const remote = (id: string, overrides: Partial<ChallengeParticipationRecord> = {}) =>
  participation({
    challenge_url: `https://remote.example/u/bob/${id}`,
    host_identity: 'https://remote.example/u/bob',
    id,
    name: 'Remote challenge',
    ...overrides,
  })

describe('listParticipationsFresh: hosted on this instance', () => {
  test('a drifted participation is patched and returned fresh', async () => {
    const host = challenge({ end_ts: new Date('2026-12-15T00:00:00Z'), name: 'Renamed' })
    const slugs: string[] = []
    const { deps, updates } = listDeps(
      [participation({ challenge_url: `${WEB_HOST}/u/alice/nov?embed=1` })],
      {
        getChallengeBySlug: async (user, slug) => {
          slugs.push(`${user}/${slug}`)
          return host
        },
      },
    )
    const [fresh] = await listParticipationsFresh('bob', { webHost: WEB_HOST }, deps)
    expect(slugs).toEqual(['alice/nov'])
    expect(updates).toEqual([{ id: 'p1', patch: { end_ts: host.end_ts, name: 'Renamed' }, user: 'bob' }])
    expect(fresh.name).toBe('Renamed')
    expect(fresh.end_ts).toEqual(host.end_ts)
  })

  test('a hosted challenge that no longer exists leaves the row as it is', async () => {
    const { deps, updates } = listDeps([participation()])
    expect(await listParticipationsFresh('bob', { webHost: WEB_HOST }, deps)).toEqual([participation()])
    expect(updates).toEqual([])
  })

  test('a failing host lookup still lists the row', async () => {
    const { deps } = listDeps([participation()], {
      getChallengeBySlug: async () => {
        throw new Error('no such database')
      },
    })
    expect(await listParticipationsFresh('bob', { webHost: WEB_HOST }, deps)).toEqual([participation()])
  })

  test('is never sent to a remote host', async () => {
    const { deps, fetched } = listDeps([participation()])
    await listParticipationsFresh('bob', { webHost: WEB_HOST }, deps)
    expect(fetched).toEqual([])
  })
})

describe('listParticipationsFresh: hosted elsewhere', () => {
  test('a never-checked participation asks the host in the background and takes only its name', async () => {
    const lookups: string[] = []
    const row = remote('r1')
    const { deps, fetched, tasks, updates } = listDeps([row], {
      getChallengeBySlug: async (user, slug) => {
        lookups.push(`${user}/${slug}`)
        return null
      },
    })
    const listed = await listParticipationsFresh('carol', { webHost: WEB_HOST }, deps)
    expect(listed).toEqual([row])
    await Promise.all(tasks)
    expect(lookups).toEqual([])
    expect(fetched).toEqual(['https://remote.example/bob/r1'])
    expect(updates).toEqual([
      { id: 'r1', patch: { host_checked_at: NOW, name: 'Remote renamed' }, user: 'carol' },
    ])
  })

  test('a stale check is repeated; a fresh one is not', async () => {
    const stale = remote('stale', { host_checked_at: new Date(NOW.getTime() - HOST_CHECK_INTERVAL_MS) })
    const fresh = remote('fresh', {
      host_checked_at: new Date(NOW.getTime() - HOST_CHECK_INTERVAL_MS + 60_000),
    })
    const { deps, fetched, tasks } = listDeps([stale, fresh])
    await listParticipationsFresh('carol', { webHost: WEB_HOST }, deps)
    await Promise.all(tasks)
    expect(fetched).toEqual(['https://remote.example/bob/stale'])
  })

  test('a host that does not answer still records the check', async () => {
    const { deps, tasks, updates } = listDeps([remote('r1')], {
      fetchRemoteChallenge: async () => {
        throw new Error('ECONNREFUSED')
      },
    })
    await listParticipationsFresh('carol', { webHost: WEB_HOST }, deps)
    await Promise.all(tasks)
    expect(updates).toEqual([{ id: 'r1', patch: { host_checked_at: NOW }, user: 'carol' }])
  })

  test('an unchanged or empty name only records the check', async () => {
    for (const name of ['Remote challenge', '  ']) {
      const { deps, tasks, updates } = listDeps([remote('r1')], {
        fetchRemoteChallenge: async () => ({
          end_ts: '2027-01-01T00:00:00Z',
          name,
          start_ts: '2026-11-03T00:00:00Z',
          timezone: 'UTC',
        }),
      })
      await listParticipationsFresh('carol', { webHost: WEB_HOST }, deps)
      await Promise.all(tasks)
      expect(updates).toEqual([{ id: 'r1', patch: { host_checked_at: NOW }, user: 'carol' }])
    }
  })

  test('a name over the challenge name limit is cut to it', async () => {
    const { deps, tasks, updates } = listDeps([remote('r1')], {
      fetchRemoteChallenge: async () => ({
        end_ts: '2027-01-01T00:00:00Z',
        name: `  ${'x'.repeat(500)}  `,
        start_ts: '2026-11-03T00:00:00Z',
        timezone: 'UTC',
      }),
    })
    await listParticipationsFresh('carol', { webHost: WEB_HOST }, deps)
    await Promise.all(tasks)
    expect(updates).toEqual([
      { id: 'r1', patch: { host_checked_at: NOW, name: 'x'.repeat(120) }, user: 'carol' },
    ])
  })

  test('the list does not wait for the host', async () => {
    const row = remote('r1')
    const { deps, updates } = listDeps([row], {
      background: () => {},
    })
    expect(await listParticipationsFresh('carol', { webHost: WEB_HOST }, deps)).toEqual([row])
    expect(updates).toEqual([])
  })

  test('at most five hosts are asked per list', async () => {
    const rows = Array.from({ length: 8 }, (_, i) => remote(`r${i}`))
    const { deps, fetched, tasks } = listDeps(rows)
    expect(await listParticipationsFresh('carol', { webHost: WEB_HOST }, deps)).toHaveLength(8)
    await Promise.all(tasks)
    expect(fetched).toHaveLength(5)
  })
})
