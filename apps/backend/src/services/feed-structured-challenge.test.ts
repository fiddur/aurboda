import type { ChallengeStanding, QuantChallengeDocument, QuantStandings } from '@aurboda/api-spec'

import { feedStructuredPostSchema } from '@aurboda/api-spec'
import { describe, expect, test, vi } from 'vitest'

import type {
  ChallengeMemberRecord,
  ChallengeParticipationRecord,
  ChallengeRecord,
  ChallengeSpecFields,
} from '../db/index.ts'

import {
  resolveStandingsChart,
  resolveStructuredChallenge,
  type StructuredChallengeDeps,
  type StructuredChallengePost,
} from './feed-structured-challenge.ts'

const spec: ChallengeSpecFields = {
  activity_type_id: null,
  aggregation: 'sum',
  bucket_size: 'auto',
  filter_field: null,
  filter_value: null,
  measure: null,
  pattern: 'steps',
  source_type: 'metric',
  unit: 'steps',
}

const START = new Date('2026-10-31T23:00:00Z')
const END = new Date('2026-11-30T23:00:00Z')
const NOW = new Date('2026-11-04T12:00:00Z')

const record: ChallengeRecord = {
  announce_winner: true,
  banner_updated_at: null,
  created_at: START,
  end_ts: END,
  id: 'c1',
  is_public: true,
  join_token: 'jt',
  name: 'November steps',
  result_published_at: null,
  slug: 'nov',
  spec,
  start_ts: START,
  timezone: 'Europe/Stockholm',
  updated_at: START,
}

const member: ChallengeMemberRecord = {
  actor: null,
  cached_buckets: null,
  cached_total: null,
  challenge_id: 'c1',
  data_endpoint_url: null,
  data_last_updated: null,
  display_name: 'freja',
  id: 'm1',
  identity_base_url: 'https://qs.example/u/freja',
  joined_at: START,
  kind: 'local',
  last_error: null,
  last_fetched_at: null,
  local_user: 'freja',
  status: 'active',
}

const standing: ChallengeStanding = {
  buckets: [{ bucket_start: '2026-10-31T23:00:00.000Z', value: 1200 }],
  display_name: 'freja',
  identity_base_url: 'https://qs.example/u/freja',
  last_updated: null,
  stale: false,
  status: 'active',
  total: 1200,
}

const participation: ChallengeParticipationRecord = {
  challenge_url: 'https://other.example/u/olle/oct',
  created_at: START,
  data_token: 'dt',
  end_ts: END,
  host_identity: '@olle@other.example',
  id: 'p1',
  name: 'Olle’s steps',
  protocol: 'quantpub',
  spec,
  start_ts: START,
  status: 'active',
  timezone: 'Europe/Stockholm',
}

const remoteDoc: QuantChallengeDocument = {
  endTime: END.toISOString(),
  host: { name: 'olle', url: 'https://other.example/u/olle' },
  kind: 'challenge',
  metric: 'steps',
  name: 'Olle’s steps',
  scoring: 'sum',
  standingsUrl: 'https://other.example/api/public/olle/challenges/oct/standings',
  startTime: START.toISOString(),
  timezone: 'Europe/Stockholm',
  url: 'https://other.example/u/olle/oct',
}

const remoteStandings: QuantStandings = {
  asOf: NOW.toISOString(),
  bucket: '1d',
  challenge: 'https://other.example/u/olle/oct',
  kind: 'standings',
  members: [
    {
      lastUpdated: null,
      name: 'olle',
      rank: 1,
      samples: [{ offset: 0, sum: 500 }],
      stale: false,
      total: 500,
      url: 'https://other.example/u/olle',
    },
  ],
}

const makeDeps = (overrides: Partial<StructuredChallengeDeps> = {}): StructuredChallengeDeps => ({
  apiBaseUrl: 'https://qs.example/api',
  discoverInstance: vi.fn(async () => ({ apiBase: 'https://other.example/api', kind: 'quantpub' as const })),
  fetchChallengeDocument: vi.fn(async () => remoteDoc),
  fetchStandings: vi.fn(async () => remoteStandings),
  getChallengeBySlug: vi.fn(async () => record),
  getChallengeStandings: vi.fn(async () => [standing]),
  getParticipationByUrl: vi.fn(async () => participation),
  listChallengeMembers: vi.fn(async () => [member]),
  now: () => NOW,
  webHost: 'https://qs.example/',
  ...overrides,
})

const ownShare = { name: 'November steps', url: 'https://qs.example/u/freja/nov' }

const ownPost: StructuredChallengePost = {
  challenge: ownShare,
  kind: 'challenge',
  message: 'Join **me**!',
}

const joinedPost: StructuredChallengePost = {
  challenge: {
    host_identity: '@olle@other.example',
    name: 'Olle’s steps',
    url: 'https://other.example/u/olle/oct',
  },
  kind: 'challenge',
  message: null,
}

describe('resolveStructuredChallenge', () => {
  test('a non-challenge post resolves to null', async () => {
    const deps = makeDeps()
    expect(
      await resolveStructuredChallenge('freja', { challenge: null, kind: 'article', message: null }, deps),
    ).toBeNull()
    expect(
      await resolveStructuredChallenge('freja', { challenge: null, kind: 'challenge', message: null }, deps),
    ).toBeNull()
  })

  test('an own challenge resolves to its document and local standings', async () => {
    const deps = makeDeps()
    const out = await resolveStructuredChallenge('freja', ownPost, deps)
    expect(deps.getChallengeBySlug).toHaveBeenCalledWith('freja', 'nov')
    expect(deps.getParticipationByUrl).not.toHaveBeenCalled()
    expect(out?.kind).toBe('challenge')
    expect(out?.message).toBe('Join **me**!')
    expect(out?.challenge).toMatchObject({
      name: 'November steps',
      standingsUrl: 'https://qs.example/api/public/freja/challenges/nov/standings',
      url: 'https://qs.example/u/freja/nov',
    })
    expect(out?.challenge.joinToken).toBeUndefined()
    expect(out?.challenge.members).toBeUndefined()
    expect(out?.standings?.asOf).toBe(NOW.toISOString())
    expect(out?.standings?.members).toHaveLength(1)
    expect(out?.standings?.members[0]).toMatchObject({ name: 'freja', rank: 1, total: 1200 })
    expect(feedStructuredPostSchema.safeParse(out).success).toBe(true)
  })

  test('an own-challenge URL whose challenge is gone resolves to null', async () => {
    const deps = makeDeps({ getChallengeBySlug: vi.fn(async () => null) })
    expect(await resolveStructuredChallenge('freja', ownPost, deps)).toBeNull()
  })

  test('a URL that is neither own nor a participation resolves to null', async () => {
    const deps = makeDeps({ getParticipationByUrl: vi.fn(async () => null) })
    expect(await resolveStructuredChallenge('freja', joinedPost, deps)).toBeNull()
    expect(deps.getChallengeBySlug).not.toHaveBeenCalled()
  })

  test("another local user's challenge URL takes the joined path", async () => {
    const deps = makeDeps()
    const post = { ...ownPost, challenge: { name: 'x', url: 'https://qs.example/u/olle/nov' } }
    await resolveStructuredChallenge('freja', post, deps)
    expect(deps.getChallengeBySlug).not.toHaveBeenCalled()
    expect(deps.getParticipationByUrl).toHaveBeenCalledWith('freja', 'https://qs.example/u/olle/nov')
  })

  test('a joined challenge on a QuantPub host carries the fetched standings', async () => {
    const deps = makeDeps()
    const out = await resolveStructuredChallenge('freja', joinedPost, deps)
    expect(deps.discoverInstance).toHaveBeenCalledWith('https://other.example')
    expect(deps.fetchChallengeDocument).toHaveBeenCalledWith('https://other.example/api', 'olle', 'oct')
    expect(deps.fetchStandings).toHaveBeenCalledWith(remoteDoc.standingsUrl)
    expect(out?.challenge).toMatchObject({
      aurboda: { spec: { aggregation: 'sum', pattern: 'steps' } },
      bucket: '1d',
      endTime: END.toISOString(),
      host: { actor: null, name: 'olle', url: 'https://other.example/u/olle' },
      joinMode: 'free',
      kind: 'challenge',
      metric: 'steps',
      name: 'Olle’s steps',
      scoring: 'sum',
      startTime: START.toISOString(),
      timezone: 'Europe/Stockholm',
      url: 'https://other.example/u/olle/oct',
    })
    expect(out?.standings).toEqual(remoteStandings)
    expect(out?.message).toBeUndefined()
    expect(feedStructuredPostSchema.safeParse(out).success).toBe(true)
  })

  test('a finished joined challenge is not joinable', async () => {
    const deps = makeDeps({ now: () => new Date('2026-12-05T00:00:00Z') })
    const out = await resolveStructuredChallenge('freja', joinedPost, deps)
    expect(out?.challenge.joinMode).toBe('none')
  })

  test('a joined challenge on an aurboda-kind host omits standings', async () => {
    const deps = makeDeps({
      discoverInstance: vi.fn(async () => ({
        apiBase: 'https://other.example/api',
        kind: 'aurboda' as const,
      })),
    })
    const out = await resolveStructuredChallenge('freja', joinedPost, deps)
    expect(out?.challenge.name).toBe('Olle’s steps')
    expect(out?.standings).toBeUndefined()
    expect(deps.fetchChallengeDocument).not.toHaveBeenCalled()
  })

  test('a remote failure omits standings without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = makeDeps({ fetchStandings: vi.fn(async () => Promise.reject(new Error('boom'))) })
    const out = await resolveStructuredChallenge('freja', joinedPost, deps)
    expect(out?.challenge.name).toBe('Olle’s steps')
    expect(out?.standings).toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test('a hung host times out and omits standings', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const deps = makeDeps({ fetchStandings: vi.fn(() => new Promise<unknown>(() => {})) })
      const pending = resolveStructuredChallenge('freja', joinedPost, deps)
      await vi.advanceTimersByTimeAsync(8_000)
      const out = await pending
      expect(out?.standings).toBeUndefined()
      expect(out?.challenge.name).toBe('Olle’s steps')
    } finally {
      warn.mockRestore()
      vi.useRealTimers()
    }
  })

  test('malformed remote standings are omitted', async () => {
    const deps = makeDeps({ fetchStandings: vi.fn(async () => ({ kind: 'nope' })) })
    const out = await resolveStructuredChallenge('freja', joinedPost, deps)
    expect(out?.standings).toBeUndefined()
  })

  test('a remote document without standingsUrl omits standings', async () => {
    const deps = makeDeps({
      fetchChallengeDocument: vi.fn(async () => ({ ...remoteDoc, standingsUrl: undefined })),
    })
    const out = await resolveStructuredChallenge('freja', joinedPost, deps)
    expect(out?.standings).toBeUndefined()
    expect(deps.fetchStandings).not.toHaveBeenCalled()
  })

  test('the completion result passes through', async () => {
    const result = {
      member_count: 2,
      podium: [
        { display_name: 'freja', identity_base_url: 'https://qs.example/u/freja', rank: 1, total: 1200 },
      ],
      unit: 'steps',
    }
    const out = await resolveStructuredChallenge(
      'freja',
      { ...ownPost, challenge: { ...ownShare, result } },
      makeDeps(),
    )
    expect(out?.result).toEqual(result)
  })
})

describe('resolveStandingsChart', () => {
  test('null while the resolver is unconfigured', async () => {
    expect(await resolveStandingsChart('freja', ownPost, null)).toBeNull()
  })

  test('the race over the own challenge window, one line per member', async () => {
    const chart = await resolveStandingsChart('freja', ownPost, makeDeps())
    expect(chart).toMatchObject({ asOf: NOW, endTime: END, startTime: START, title: 'November steps' })
    expect(chart?.lines.map((line) => line.name)).toEqual(['freja'])
    expect(chart?.lines[0].points.at(-1)?.[1]).toBe(1200)
  })

  test('null when a joined challenge has no reachable standings', async () => {
    const deps = makeDeps({
      discoverInstance: vi.fn(async () => ({
        apiBase: 'https://other.example/api',
        kind: 'aurboda' as const,
      })),
    })
    expect(await resolveStandingsChart('freja', joinedPost, deps)).toBeNull()
  })
})
