import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type * as DbModule from '../db/index.ts'
import type {
  ChallengeMemberRecord,
  ChallengeParticipationRecord,
  ChallengeRecord,
  ChallengeSpecFields,
} from '../db/index.ts'
import type * as FederationModule from '../services/challenge-federation.ts'
import type * as SpecModule from '../services/challenge-spec.ts'
import type * as StandingsModule from '../services/challenge-standings.ts'

vi.mock('../db/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  getChallengeBySlug: vi.fn(),
  getChallengeMemberByIdentity: vi.fn(),
  getParticipationByToken: vi.fn(),
  listChallengeMembers: vi.fn(),
  listPublicChallenges: vi.fn(),
  removeChallengeMember: vi.fn(),
  upsertChallengeMember: vi.fn(),
}))

vi.mock('../services/challenge-federation.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof FederationModule>()),
  fetchChallengeEntry: vi.fn(),
}))

vi.mock('../services/challenge-spec.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof SpecModule>()),
  resolveMemberSeries: vi.fn(),
}))

vi.mock('../services/challenge-standings.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof StandingsModule>()),
  getChallengeStandings: vi.fn(),
}))

const db = await import('../db/index.ts')
const federation = await import('../services/challenge-federation.ts')
const spec = await import('../services/challenge-spec.ts')
const standings = await import('../services/challenge-standings.ts')
const { createChallengeQuantpubRouter } = await import('./challenge-quantpub-router.ts')

const NOW = new Date('2026-11-03T12:00:00Z')

const stepsSpec: ChallengeSpecFields = {
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

const bestSetSpec: ChallengeSpecFields = {
  ...stepsSpec,
  aggregation: 'max',
  filter_field: 'sets.exercise',
  filter_value: 'Push-ups',
  measure: 'max_reps',
  pattern: 'strength_training',
  source_type: 'activity_type',
  unit: 'reps',
}

const challenge = (overrides: Partial<ChallengeRecord> = {}): ChallengeRecord => ({
  announce_winner: true,
  banner_updated_at: null,
  created_at: NOW,
  end_ts: new Date('2026-11-30T23:00:00Z'),
  id: 'c1',
  is_public: true,
  join_token: 'jt',
  name: 'November steps',
  result_published_at: null,
  slug: 'nov',
  spec: stepsSpec,
  start_ts: new Date('2026-10-31T23:00:00Z'),
  timezone: 'Europe/Stockholm',
  updated_at: NOW,
  ...overrides,
})

const member = (overrides: Partial<ChallengeMemberRecord> = {}): ChallengeMemberRecord => ({
  actor: null,
  cached_buckets: null,
  cached_total: null,
  challenge_id: 'c1',
  data_endpoint_url: 'https://ola.example/entry/old',
  data_last_updated: null,
  display_name: 'ola',
  id: 'm1',
  identity_base_url: 'https://ola.example/',
  joined_at: NOW,
  kind: 'remote',
  last_error: null,
  last_fetched_at: null,
  local_user: null,
  status: 'active',
  ...overrides,
})

const app = () => {
  const a = express()
  a.use(express.json())
  a.use(
    createChallengeQuantpubRouter({
      apiBaseUrl: 'https://qs.example/api',
      now: () => NOW,
      webHost: 'https://qs.example',
    }) as unknown as express.RequestHandler,
  )
  return supertest(a)
}

const joinBody = {
  actor: 'https://ola.example/users/ola',
  entryUrl: 'https://ola.example/entry/new',
  joinToken: 'jt',
  name: 'ola',
  url: 'https://ola.example/',
}

const stepsEntry = {
  challenge: 'https://qs.example/u/freja/nov',
  kind: 'challengeEntry' as const,
  metric: 'steps',
  scoring: 'sum' as const,
  total: 100,
}

const join = (body: Record<string, unknown> = joinBody) =>
  app().post('/public/freja/challenges/nov/members').send(body)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(db.getChallengeBySlug).mockResolvedValue(challenge())
  vi.mocked(db.getChallengeMemberByIdentity).mockResolvedValue(null)
  vi.mocked(db.listChallengeMembers).mockResolvedValue([])
  vi.mocked(federation.fetchChallengeEntry).mockResolvedValue(stepsEntry)
})

describe('GET /public/:username/challenges', () => {
  test('lists public challenges without join tokens or members, cacheable', async () => {
    vi.mocked(db.listPublicChallenges).mockResolvedValue([challenge()])
    const res = await app().get('/public/freja/challenges')
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('public, max-age=60')
    expect(res.body.kind).toBe('challengeList')
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0]).toMatchObject({ kind: 'challenge', metric: 'steps', name: 'November steps' })
    expect(res.body.items[0]).not.toHaveProperty('joinToken')
    expect(res.body.items[0]).not.toHaveProperty('members')
  })

  test('an invalid username is not found', async () => {
    expect((await app().get('/public/AB/challenges')).status).toBe(404)
  })
})

describe('GET /public/:username/challenges/:slug', () => {
  test('serves the document with the join token and the members, never their entry URLs', async () => {
    vi.mocked(db.listChallengeMembers).mockResolvedValue([member()])
    const res = await app().get('/public/freja/challenges/nov')
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).toMatchObject({ joinToken: 'jt', kind: 'challenge', members: [{ name: 'ola' }] })
    expect(JSON.stringify(res.body)).not.toContain('entry/old')
  })

  test('an unknown slug is not found', async () => {
    vi.mocked(db.getChallengeBySlug).mockResolvedValue(null)
    expect((await app().get('/public/freja/challenges/nope')).status).toBe(404)
  })
})

describe('POST /public/:username/challenges/:slug/members', () => {
  test('joins a new member after probing its entry', async () => {
    const res = await join()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'member' })
    expect(federation.fetchChallengeEntry).toHaveBeenCalledWith('https://ola.example/entry/new')
    expect(db.upsertChallengeMember).toHaveBeenCalledWith('freja', 'c1', {
      actor: 'https://ola.example/users/ola',
      data_endpoint_url: 'https://ola.example/entry/new',
      display_name: 'ola',
      identity_base_url: 'https://ola.example/',
      kind: 'remote',
    })
  })

  test('a malformed body is 400', async () => {
    expect((await join({ ...joinBody, entryUrl: 'not a url' })).status).toBe(400)
    expect((await join({ ...joinBody, url: 'ftp://ola.example/' })).status).toBe(400)
    expect(db.upsertChallengeMember).not.toHaveBeenCalled()
  })

  test('no such challenge is 404', async () => {
    vi.mocked(db.getChallengeBySlug).mockResolvedValue(null)
    expect((await join()).status).toBe(404)
  })

  test('a wrong join token is 403', async () => {
    expect((await join({ ...joinBody, joinToken: 'nope' })).status).toBe(403)
  })

  test('an ended challenge is closed', async () => {
    vi.mocked(db.getChallengeBySlug).mockResolvedValue(challenge({ end_ts: NOW }))
    const res = await join()
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('Challenge is closed')
  })

  test('a local member cannot be claimed', async () => {
    vi.mocked(db.getChallengeMemberByIdentity).mockResolvedValue(member({ kind: 'local', local_user: 'ola' }))
    expect((await join()).status).toBe(409)
    expect(db.upsertChallengeMember).not.toHaveBeenCalled()
  })

  test('a registered identity changes only with its current entry URL', async () => {
    vi.mocked(db.getChallengeMemberByIdentity).mockResolvedValue(member())

    const without = await join()
    expect(without.status).toBe(409)
    expect(without.body.error).toBe('That identity is registered with another entry')

    const wrong = await join({ ...joinBody, currentEntryUrl: 'https://ola.example/entry/guess' })
    expect(wrong.status).toBe(409)
    expect(db.upsertChallengeMember).not.toHaveBeenCalled()

    const right = await join({ ...joinBody, currentEntryUrl: 'https://ola.example/entry/old' })
    expect(right.status).toBe(200)
    expect(db.upsertChallengeMember).toHaveBeenCalledOnce()
    expect(db.listChallengeMembers).not.toHaveBeenCalled()
  })

  test('a full challenge refuses a new member', async () => {
    vi.mocked(db.listChallengeMembers).mockResolvedValue(Array.from({ length: 200 }, () => member()))
    const res = await join()
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('Challenge is full')
  })

  test('an entry that cannot be read is 400', async () => {
    vi.mocked(federation.fetchChallengeEntry).mockRejectedValue(new Error('404'))
    const res = await join()
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Entry URL unreachable or not a challenge entry')
  })

  test('an entry scoring another metric or another way is 409', async () => {
    vi.mocked(federation.fetchChallengeEntry).mockResolvedValueOnce({ ...stepsEntry, metric: 'distance' })
    expect((await join()).status).toBe(409)
    vi.mocked(federation.fetchChallengeEntry).mockResolvedValueOnce({ ...stepsEntry, scoring: 'count' })
    expect((await join()).status).toBe(409)
    expect(db.upsertChallengeMember).not.toHaveBeenCalled()
  })

  test('a measure challenge needs the vendor echo to match', async () => {
    vi.mocked(db.getChallengeBySlug).mockResolvedValue(challenge({ spec: bestSetSpec }))
    const measureEntry = { ...stepsEntry, metric: 'aurboda:maxReps', scoring: 'max' as const }

    vi.mocked(federation.fetchChallengeEntry).mockResolvedValueOnce(measureEntry)
    const missing = await join()
    expect(missing.status).toBe(409)
    expect(missing.body.error).toBe(
      "Your instance does not support this challenge's measure (max_reps); update Aurboda to join",
    )

    vi.mocked(federation.fetchChallengeEntry).mockResolvedValueOnce({
      ...measureEntry,
      aurboda: {
        aggregation: 'max',
        filterField: 'sets.exercise',
        filterValue: 'push-ups',
        measure: 'max_reps',
      },
    })
    expect((await join()).status).toBe(200)
  })
})

describe('DELETE /public/:username/challenges/:slug/members', () => {
  test('removes the member that registered the entry URL', async () => {
    vi.mocked(db.listChallengeMembers).mockResolvedValue([member()])
    const res = await app()
      .delete('/public/freja/challenges/nov/members')
      .send({ entryUrl: 'https://ola.example/entry/old' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'left' })
    expect(db.removeChallengeMember).toHaveBeenCalledWith('freja', 'c1', 'm1')
  })

  test('an entry URL no member registered is 404', async () => {
    vi.mocked(db.listChallengeMembers).mockResolvedValue([member()])
    const res = await app()
      .delete('/public/freja/challenges/nov/members')
      .send({ entryUrl: 'https://ola.example/entry/guess' })
    expect(res.status).toBe(404)
    expect(db.removeChallengeMember).not.toHaveBeenCalled()
  })
})

describe('GET /public/:username/challenges/:slug/standings', () => {
  beforeEach(() => {
    vi.mocked(standings.getChallengeStandings).mockResolvedValue([
      {
        buckets: [],
        display_name: 'ola',
        identity_base_url: 'https://ola.example/',
        last_updated: null,
        stale: false,
        status: 'active',
        total: 100,
      },
    ])
  })

  test('a public challenge caches briefly', async () => {
    const res = await app().get('/public/freja/challenges/nov/standings')
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('public, max-age=60')
    expect(res.body).toMatchObject({ kind: 'standings', members: [{ name: 'ola', rank: 1, total: 100 }] })
  })

  test('an unlisted challenge is no-store', async () => {
    vi.mocked(db.getChallengeBySlug).mockResolvedValue(challenge({ is_public: false }))
    const res = await app().get('/public/freja/challenges/nov/standings')
    expect(res.headers['cache-control']).toBe('no-store')
  })
})

describe('GET /public/:username/challenge-entries/:token', () => {
  const participation: ChallengeParticipationRecord = {
    challenge_url: 'https://qs.example/u/freja/nov',
    created_at: NOW,
    data_token: 'tok',
    end_ts: new Date('2026-11-30T23:00:00Z'),
    host_identity: 'https://qs.example/u/freja',
    id: 'p1',
    name: 'November steps',
    spec: stepsSpec,
    start_ts: new Date('2026-10-31T23:00:00Z'),
    status: 'active',
    timezone: 'Europe/Stockholm',
  }

  test('serves the entry, no-store', async () => {
    vi.mocked(db.getParticipationByToken).mockResolvedValue(participation)
    vi.mocked(spec.resolveMemberSeries).mockResolvedValue({ buckets: [], last_updated: null, total: 42 })
    const res = await app().get('/public/ola/challenge-entries/tok')
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).toMatchObject({ kind: 'challengeEntry', metric: 'steps', scoring: 'sum', total: 42 })
  })

  test('an unknown or withdrawn token is 404', async () => {
    vi.mocked(db.getParticipationByToken).mockResolvedValueOnce(null)
    expect((await app().get('/public/ola/challenge-entries/missing')).status).toBe(404)
    vi.mocked(db.getParticipationByToken).mockResolvedValueOnce({ ...participation, status: 'withdrawn' })
    expect((await app().get('/public/ola/challenge-entries/tok')).status).toBe(404)
    expect(spec.resolveMemberSeries).not.toHaveBeenCalled()
  })
})
