import type { ChallengeStanding, PublicChallenge } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import type { ChallengeParticipationRecord, ChallengeRecord } from '../db/index.ts'

import { getJoinedChallenge, type JoinedChallengeDeps } from './joined-challenge.ts'
import { toPublicChallenge } from './public-challenge.ts'

const HOME = 'https://home.example'
const HOST = 'https://host.example'
const HOST_API = 'https://host.example/api'

const record: ChallengeRecord = {
  announce_winner: false,
  banner_updated_at: null,
  created_at: new Date('2026-10-01T00:00:00Z'),
  end_ts: new Date('2026-12-01T00:00:00Z'),
  id: 'c1',
  is_public: true,
  join_token: 'jt',
  name: 'November',
  result_published_at: null,
  slug: 'nov',
  spec: {
    activity_type_id: null,
    aggregation: 'sum',
    bucket_size: 'auto',
    filter_field: null,
    filter_value: null,
    measure: null,
    pattern: 'steps',
    source_type: 'metric',
    unit: 'steps',
  },
  start_ts: new Date('2026-11-01T00:00:00Z'),
  timezone: 'UTC',
  updated_at: new Date('2026-10-01T00:00:00Z'),
}

const publicChallenge: PublicChallenge = toPublicChallenge(record, [], HOST, 'freja')

const standing: ChallengeStanding = {
  buckets: [],
  display_name: 'Freja',
  identity_base_url: `${HOST}/u/freja`,
  last_updated: null,
  stale: false,
  status: 'active',
  total: 42,
}

const participation = (challengeUrl: string): ChallengeParticipationRecord => ({
  challenge_object_uri: null,
  challenge_url: challengeUrl,
  created_at: new Date('2026-11-01T00:00:00Z'),
  data_token: 'dtok',
  end_ts: new Date('2026-12-01T00:00:00Z'),
  host_actor_uri: null,
  host_checked_at: null,
  host_identity: `${HOST}/u/freja`,
  id: 'p1',
  name: 'November',
  protocol: 'aurboda',
  spec: record.spec,
  start_ts: new Date('2026-11-01T00:00:00Z'),
  status: 'active',
  thread_attendees: [],
  thread_audiences: [],
  thread_synced_at: null,
  thread_url: null,
  timezone: 'UTC',
})

const deps = (over: Partial<JoinedChallengeDeps> & { participation?: ChallengeParticipationRecord }) => {
  const fetched: string[] = []
  const local: [string, string, string][] = []
  const value: JoinedChallengeDeps = {
    discover: async () => ({ apiBase: HOST_API, kind: 'aurboda' }),
    fetchJson: async (url) => {
      fetched.push(url)
      if (url.endsWith('/standings')) return { members: [standing], success: true }
      return { challenge: publicChallenge, success: true, type: 'challenge' }
    },
    getParticipation: async (_user, id) => (id === 'p1' ? (over.participation ?? null) : null),
    loadLocal: async (username, slug, webHost) => {
      local.push([username, slug, webHost])
      return { challenge: publicChallenge, standings: [standing] }
    },
    ...over,
  }
  return { deps: value, fetched, local }
}

describe('getJoinedChallenge', () => {
  test('a participation the user does not have is a 404', async () => {
    const { deps: d } = deps({})
    expect(await getJoinedChallenge(d, 'ola', 'p1', { webHost: HOME })).toEqual({
      error: 'Participation not found',
      ok: false,
      status: 404,
    })
  })

  test('a challenge hosted here is read in-process', async () => {
    const { deps: d, fetched, local } = deps({ participation: participation(`${HOME}/u/freja/nov`) })
    const result = await getJoinedChallenge(d, 'ola', 'p1', { webHost: HOME })
    expect(local).toEqual([['freja', 'nov', HOME]])
    expect(fetched).toEqual([])
    expect(result).toMatchObject({
      ok: true,
      response: {
        challenge: publicChallenge,
        host_page_url: `${HOME}/u/freja/nov`,
        participation: { id: 'p1' },
        standings: [standing],
        success: true,
      },
    })
  })

  test("another Aurboda server's challenge is read from its public page and standings", async () => {
    const { deps: d, fetched, local } = deps({ participation: participation(`${HOST}/u/freja/nov`) })
    const result = await getJoinedChallenge(d, 'ola', 'p1', { webHost: HOME })
    expect(local).toEqual([])
    expect(fetched.toSorted()).toEqual([
      `${HOST_API}/public/freja/nov`,
      `${HOST_API}/public/freja/nov/standings`,
    ])
    expect(result).toMatchObject({
      ok: true,
      response: { challenge: publicChallenge, host_page_url: `${HOST}/u/freja/nov`, standings: [standing] },
    })
  })

  test('a host that cannot be read leaves the challenge and standings out', async () => {
    const { deps: d } = deps({
      fetchJson: async () => {
        throw new Error('down')
      },
      participation: participation(`${HOST}/u/freja/nov`),
    })
    const result = await getJoinedChallenge(d, 'ola', 'p1', { webHost: HOME })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.response.challenge).toBeUndefined()
    expect(result.response.standings).toBeUndefined()
    expect(result.response.host_page_url).toBe(`${HOST}/u/freja/nov`)
  })

  test('a host answering something other than a challenge page leaves both out', async () => {
    const { deps: d } = deps({
      fetchJson: async () => ({ success: true, type: 'activity' }),
      participation: participation(`${HOST}/u/freja/nov`),
    })
    const result = await getJoinedChallenge(d, 'ola', 'p1', { webHost: HOME })
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.response.challenge).toBeUndefined()
  })

  test('a URL that is not a challenge page is not fetched at all', async () => {
    const { deps: d, fetched } = deps({ participation: participation(`${HOST}/somewhere`) })
    const result = await getJoinedChallenge(d, 'ola', 'p1', { webHost: HOME })
    expect(fetched).toEqual([])
    expect(result).toMatchObject({ ok: true, response: { host_page_url: `${HOST}/somewhere` } })
  })
})
