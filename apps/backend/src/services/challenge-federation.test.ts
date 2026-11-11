/**
 * Challenge federation: how a public challenge link is canonicalised (what
 * every URL comparison keys off) and parsed, and — with the network and the
 * database mocked — how a host is discovered, joined and left.
 */
import { AxiosError, AxiosHeaders } from 'axios'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type * as DbModule from '../db/index.ts'
import type {
  ChallengeMemberRecord,
  ChallengeParticipationRecord,
  ChallengeRecord,
  ChallengeSpecFields,
} from '../db/index.ts'
import type * as SafeFetchModule from './safe-fetch.ts'

vi.mock('./safe-fetch.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof SafeFetchModule>()),
  safeFetchDelete: vi.fn(),
  safeFetchGet: vi.fn(),
  safeFetchPost: vi.fn(),
}))

vi.mock('../db/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  createChallengeParticipation: vi.fn(),
  deleteChallengeParticipation: vi.fn(),
  getChallengeBySlug: vi.fn(),
  getChallengeMemberByIdentity: vi.fn(),
  getLeftChallengeToken: vi.fn(),
  getParticipationById: vi.fn(),
  getParticipationByUrl: vi.fn(),
  removeChallengeMember: vi.fn(),
  upsertChallengeMember: vi.fn(),
}))

const safeFetch = await import('./safe-fetch.ts')
const db = await import('../db/index.ts')
const {
  canonicalChallengeUrl,
  discoverInstance,
  JoinChallengeError,
  joinChallenge,
  leaveChallenge,
  parseChallengeUrl,
  parsePublicChallenge,
  previewChallenge,
  specFromChallengeDocument,
} = await import('./challenge-federation.ts')

describe('canonicalChallengeUrl', () => {
  test('drops the query, the fragment, trailing slashes and a default port', () => {
    expect(canonicalChallengeUrl('https://peer.example/u/alice/abc?embed=1')).toBe(
      'https://peer.example/u/alice/abc',
    )
    expect(canonicalChallengeUrl('https://peer.example/u/alice/abc#standings')).toBe(
      'https://peer.example/u/alice/abc',
    )
    expect(canonicalChallengeUrl('https://peer.example/u/alice/abc///')).toBe(
      'https://peer.example/u/alice/abc',
    )
    expect(canonicalChallengeUrl('https://peer.example:443/u/alice/abc')).toBe(
      'https://peer.example/u/alice/abc',
    )
  })

  test('lowercases scheme and host but not the path', () => {
    expect(canonicalChallengeUrl('HTTPS://Peer.Example/u/Alice/AbC')).toBe('https://peer.example/u/Alice/AbC')
  })

  test('keeps a non-default port and a sub-path base', () => {
    expect(canonicalChallengeUrl('http://localhost:8080/u/alice/abc/')).toBe(
      'http://localhost:8080/u/alice/abc',
    )
    expect(canonicalChallengeUrl('https://peer.example/aurboda/u/alice/abc')).toBe(
      'https://peer.example/aurboda/u/alice/abc',
    )
  })

  test('null for anything that is not an http(s) URL', () => {
    expect(canonicalChallengeUrl('not a url')).toBeNull()
    expect(canonicalChallengeUrl('/u/alice/abc')).toBeNull()
    expect(canonicalChallengeUrl('ftp://peer.example/u/alice/abc')).toBeNull()
    expect(canonicalChallengeUrl('javascript:alert(1)')).toBeNull()
  })

  test('a canonicalised link parses without the query glued to the slug', () => {
    const url = canonicalChallengeUrl('https://peer.example/u/alice/abc?embed=1')
    expect(url && parseChallengeUrl(url)).toEqual({
      base: 'https://peer.example',
      slug: 'abc',
      username: 'alice',
    })
    // What the raw link would have parsed to, and why canonicalising comes first.
    expect(parseChallengeUrl('https://peer.example/u/alice/abc?embed=1')?.slug).toBe('abc?embed=1')
  })
})

describe('parseChallengeUrl', () => {
  test('splits `<base>/u/<username>/<slug>`, sub-path base included', () => {
    expect(parseChallengeUrl('https://peer.example/u/alice/abc')).toEqual({
      base: 'https://peer.example',
      slug: 'abc',
      username: 'alice',
    })
    expect(parseChallengeUrl('https://peer.example/aurboda/u/alice/abc/')).toEqual({
      base: 'https://peer.example/aurboda',
      slug: 'abc',
      username: 'alice',
    })
  })

  test('null without a `/u/` segment, a username or a slug', () => {
    expect(parseChallengeUrl('https://peer.example/alice/abc')).toBeNull()
    expect(parseChallengeUrl('https://peer.example/u/alice')).toBeNull()
    expect(parseChallengeUrl('/u/alice/abc')).toBeNull()
  })
})

describe('parsePublicChallenge', () => {
  const answer = (spec: Record<string, unknown>) => ({
    challenge: {
      end_ts: '2026-07-01T00:00:00.000Z',
      host_identity: 'https://peer.example/u/alice',
      join_token: 'tok',
      members: [],
      name: 'Push-ups',
      profile_url: 'https://peer.example/u/alice',
      share_url: 'https://peer.example/u/alice/abc',
      spec: {
        aggregation: 'sum',
        bucket_size: 'auto',
        pattern: 'strength_training',
        source_type: 'activity_type',
        unit: 'reps',
        ...spec,
      },
      start_ts: '2026-06-01T00:00:00.000Z',
      timezone: 'UTC',
      visibility: 'public',
    },
    success: true,
    type: 'challenge',
  })

  test('parses a measure challenge with its item filter', () => {
    const spec = { filter_field: 'sets.exercise', filter_value: 'Push-ups', measure: 'total_reps' }
    expect(parsePublicChallenge(answer(spec)).spec).toMatchObject(spec)
  })

  test('names a measure this instance does not know instead of calling the link wrong', () => {
    const parse = () => parsePublicChallenge(answer({ measure: 'max_distance' }))
    expect(parse).toThrow(JoinChallengeError)
    expect(parse).toThrow(
      "Your instance does not support this challenge's measure (max_distance); update Aurboda to join",
    )
  })

  test('anything else malformed is not a challenge', () => {
    expect(() => parsePublicChallenge({ success: true, type: 'dashboard' })).toThrow(
      'URL is not an Aurboda challenge',
    )
    expect(() => parsePublicChallenge(null)).toThrow('URL is not an Aurboda challenge')
  })
})

const response = (data: unknown) =>
  ({ config: {}, data, headers: {}, status: 200, statusText: 'OK' }) as never

const httpError = (status: number, data: unknown = {}) =>
  new AxiosError('failed', String(status), undefined, undefined, {
    config: { headers: new AxiosHeaders() },
    data,
    headers: {},
    status,
    statusText: '',
  })

const stepsSpec: ChallengeSpecFields = {
  activity_type_id: null,
  aggregation: 'sum',
  bucket_size: 'auto',
  filter_field: null,
  filter_value: null,
  measure: null,
  pattern: 'steps',
  source_type: 'metric',
  unit: '1',
}

const quantDocument = (overrides: Record<string, unknown> = {}) => ({
  endTime: '2026-11-30T23:00:00.000Z',
  host: { name: 'freja', url: 'https://qs.example/u/freja' },
  joinToken: 'jt',
  kind: 'challenge',
  metric: 'steps',
  name: 'November steps',
  scoring: 'sum',
  startTime: '2026-10-31T23:00:00.000Z',
  timezone: 'Europe/Stockholm',
  url: 'https://qs.example/u/freja/nov',
  ...overrides,
})

const participationRecord = (
  overrides: Partial<ChallengeParticipationRecord> = {},
): ChallengeParticipationRecord => ({
  challenge_url: 'https://qs.example/u/freja/nov',
  created_at: new Date('2026-11-01T00:00:00Z'),
  data_token: 'dtok',
  end_ts: new Date('2026-11-30T23:00:00Z'),
  host_identity: 'https://qs.example/u/freja',
  id: 'p1',
  name: 'November steps',
  protocol: null,
  spec: stepsSpec,
  start_ts: new Date('2026-10-31T23:00:00Z'),
  status: 'active',
  timezone: 'Europe/Stockholm',
  ...overrides,
})

/** Route GETs by URL suffix; anything unrouted 404s. */
const routeGets = (routes: Record<string, unknown>) => {
  vi.mocked(safeFetch.safeFetchGet).mockImplementation(async (url: string) => {
    const hit = Object.entries(routes).find(([suffix]) => url.endsWith(suffix))
    if (!hit) throw httpError(404)
    if (hit[1] instanceof Error) throw hit[1]
    return response(hit[1])
  })
}

const quantWellKnown = {
  apiBase: 'https://qs.example/api',
  challenges: true,
  product: 'x',
  quantpub: '0.3',
  version: '1',
}
const aurbodaWellKnown = {
  api_base: 'https://qs.example/api',
  federation: true,
  product: 'aurboda',
  version: '1',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(db.getParticipationByUrl).mockResolvedValue(null)
  vi.mocked(db.createChallengeParticipation).mockImplementation(async (_user, input) =>
    participationRecord({ ...input }),
  )
  vi.mocked(db.deleteChallengeParticipation).mockResolvedValue(true)
  vi.mocked(db.getLeftChallengeToken).mockResolvedValue(null)
  vi.mocked(db.getChallengeBySlug).mockResolvedValue(null)
  vi.mocked(db.getChallengeMemberByIdentity).mockResolvedValue(null)
  vi.mocked(db.removeChallengeMember).mockResolvedValue(true)
})

describe('discoverInstance', () => {
  test('prefers a QuantPub host that serves challenges', async () => {
    routeGets({ '/.well-known/aurboda': aurbodaWellKnown, '/.well-known/quantpub': quantWellKnown })
    expect(await discoverInstance('https://qs.example')).toEqual({
      apiBase: 'https://qs.example/api',
      kind: 'quantpub',
    })
  })

  test('falls back to the Aurboda document without the flag or without a QuantPub document', async () => {
    routeGets({
      '/.well-known/aurboda': aurbodaWellKnown,
      '/.well-known/quantpub': { ...quantWellKnown, challenges: undefined },
    })
    expect(await discoverInstance('https://qs.example')).toEqual({
      apiBase: 'https://qs.example/api',
      kind: 'aurboda',
    })
    routeGets({ '/.well-known/aurboda': aurbodaWellKnown })
    expect((await discoverInstance('https://qs.example')).kind).toBe('aurboda')
  })

  test('rethrows a transient QuantPub failure rather than falling back', async () => {
    routeGets({ '/.well-known/aurboda': aurbodaWellKnown, '/.well-known/quantpub': httpError(503) })
    await expect(discoverInstance('https://qs.example')).rejects.toThrow('failed')
  })
})

describe('specFromChallengeDocument', () => {
  test('takes the vendor spec as is', () => {
    const vendor = {
      aggregation: 'max',
      bucket_size: 'auto',
      measure: 'max_reps',
      pattern: 'strength_training',
      source_type: 'activity_type',
      unit: 'reps',
    } as const
    const doc = { ...quantDocument({ metric: 'aurboda:maxReps', scoring: 'max' }), aurboda: { spec: vendor } }
    expect(specFromChallengeDocument(doc as never)).toMatchObject({
      measure: 'max_reps',
      pattern: 'strength_training',
    })
  })

  test('synthesises a metric spec from a bare RECOMMENDED key', () => {
    expect(specFromChallengeDocument(quantDocument() as never)).toEqual(stepsSpec)
  })

  test('refuses what this instance cannot score', () => {
    for (const metric of ['tracker:pushups', 'heartRate', 'aurboda:steps']) {
      expect(() => specFromChallengeDocument(quantDocument({ metric }) as never)).toThrow(
        `This instance cannot score ${metric}`,
      )
    }
  })
})

describe('joinChallenge on a QuantPub host', () => {
  const deps = {
    apiBaseUrl: 'https://home.example/api',
    challengeUrl: 'https://qs.example/u/freja/nov?embed=1',
    user: 'ola',
    webHost: 'https://home.example',
  }

  test('reads the challenge document and registers with the new body', async () => {
    routeGets({ '/.well-known/quantpub': quantWellKnown, '/public/freja/challenges/nov': quantDocument() })
    vi.mocked(safeFetch.safeFetchPost).mockResolvedValue(response({ status: 'member' }))

    const participation = await joinChallenge(deps)

    expect(db.createChallengeParticipation).toHaveBeenCalledWith('ola', {
      challenge_url: 'https://qs.example/u/freja/nov',
      end_ts: new Date('2026-11-30T23:00:00.000Z'),
      host_identity: 'https://qs.example/u/freja',
      name: 'November steps',
      spec: stepsSpec,
      protocol: 'quantpub',
      start_ts: new Date('2026-10-31T23:00:00.000Z'),
      timezone: 'Europe/Stockholm',
    })
    expect(safeFetch.safeFetchPost).toHaveBeenCalledWith(
      'https://qs.example/api/public/freja/challenges/nov/members',
      {
        actor: 'https://home.example/users/ola',
        entryUrl: `https://home.example/api/public/ola/challenge-entries/${participation.data_token}`,
        joinToken: 'jt',
        name: 'ola',
        url: 'https://home.example/u/ola',
      },
    )
  })

  test('a rejoin presents the entry URL of the participation it left', async () => {
    routeGets({ '/.well-known/quantpub': quantWellKnown, '/public/freja/challenges/nov': quantDocument() })
    vi.mocked(safeFetch.safeFetchPost).mockResolvedValue(response({ status: 'member' }))
    vi.mocked(db.getLeftChallengeToken).mockResolvedValue('oldtok')

    await joinChallenge(deps)

    expect(db.getLeftChallengeToken).toHaveBeenCalledWith('ola', 'https://qs.example/u/freja/nov')
    expect(safeFetch.safeFetchPost).toHaveBeenCalledWith(
      'https://qs.example/api/public/freja/challenges/nov/members',
      expect.objectContaining({
        currentEntryUrl: 'https://home.example/api/public/ola/challenge-entries/oldtok',
        entryUrl: 'https://home.example/api/public/ola/challenge-entries/dtok',
      }),
    )
  })

  test('a first join sends no currentEntryUrl', async () => {
    routeGets({ '/.well-known/quantpub': quantWellKnown, '/public/freja/challenges/nov': quantDocument() })
    vi.mocked(safeFetch.safeFetchPost).mockResolvedValue(response({ status: 'member' }))
    await joinChallenge(deps)
    expect(vi.mocked(safeFetch.safeFetchPost).mock.calls[0][1]).not.toHaveProperty('currentEntryUrl')
  })

  test('refuses a metric it cannot score before creating anything', async () => {
    routeGets({
      '/.well-known/quantpub': quantWellKnown,
      '/public/freja/challenges/nov': quantDocument({ metric: 'tracker:pushups', unit: '1' }),
    })
    await expect(joinChallenge(deps)).rejects.toThrow('This instance cannot score tracker:pushups')
    expect(db.createChallengeParticipation).not.toHaveBeenCalled()
  })

  test("rolls the participation back, without a tombstone, and surfaces the host's reason", async () => {
    routeGets({ '/.well-known/quantpub': quantWellKnown, '/public/freja/challenges/nov': quantDocument() })
    vi.mocked(safeFetch.safeFetchPost).mockRejectedValue(httpError(409, { error: 'Challenge is full' }))
    await expect(joinChallenge(deps)).rejects.toThrow('Challenge is full')
    expect(db.deleteChallengeParticipation).toHaveBeenCalledWith('ola', 'p1', { tombstone: false })
  })

  test('an Aurboda-protocol host is still joined the old way', async () => {
    routeGets({
      '/.well-known/aurboda': aurbodaWellKnown,
      '/public/freja/nov': {
        challenge: {
          end_ts: '2026-11-30T23:00:00.000Z',
          host_identity: 'https://qs.example/u/freja',
          join_token: 'jt',
          members: [],
          name: 'November steps',
          profile_url: 'https://qs.example/u/freja',
          share_url: 'https://qs.example/u/freja/nov',
          spec: {
            aggregation: 'sum',
            bucket_size: 'auto',
            pattern: 'steps',
            source_type: 'metric',
            unit: 'steps',
          },
          start_ts: '2026-10-31T23:00:00.000Z',
          timezone: 'Europe/Stockholm',
          visibility: 'public',
        },
        success: true,
        type: 'challenge',
      },
    })
    vi.mocked(safeFetch.safeFetchPost).mockResolvedValue(response({ success: true }))
    await joinChallenge(deps)
    expect(db.createChallengeParticipation).toHaveBeenCalledWith(
      'ola',
      expect.objectContaining({ protocol: 'aurboda' }),
    )
    expect(safeFetch.safeFetchPost).toHaveBeenCalledWith(
      'https://qs.example/api/public/freja/nov/members',
      expect.objectContaining({
        data_endpoint_url: 'https://home.example/api/challenge-data/ola/dtok',
        join_token: 'jt',
      }),
    )
  })
})

describe('joinChallenge on this instance', () => {
  test('joins the host challenge directly and records the Aurboda protocol', async () => {
    vi.mocked(db.getChallengeBySlug).mockResolvedValue({
      end_ts: new Date('2026-11-30T23:00:00Z'),
      id: 'c1',
      name: 'November steps',
      spec: stepsSpec,
      start_ts: new Date('2026-10-31T23:00:00Z'),
      timezone: 'Europe/Stockholm',
    } as ChallengeRecord)
    await joinChallenge({
      apiBaseUrl: 'https://home.example/api',
      challengeUrl: 'https://home.example/u/freja/nov',
      user: 'ola',
      webHost: 'https://home.example',
    })
    expect(db.upsertChallengeMember).toHaveBeenCalledWith(
      'freja',
      'c1',
      expect.objectContaining({ kind: 'local' }),
    )
    expect(db.createChallengeParticipation).toHaveBeenCalledWith(
      'ola',
      expect.objectContaining({ protocol: 'aurboda' }),
    )
    expect(safeFetch.safeFetchPost).not.toHaveBeenCalled()
  })
})

describe('previewChallenge', () => {
  const webHost = 'https://home.example'
  const stepsApiSpec = {
    aggregation: 'sum',
    bucket_size: 'auto',
    pattern: 'steps',
    source_type: 'metric',
    unit: '1',
  }

  test('reads a QuantPub host without joining', async () => {
    routeGets({ '/.well-known/quantpub': quantWellKnown, '/public/freja/challenges/nov': quantDocument() })
    expect(
      await previewChallenge({ challengeUrl: 'https://qs.example/u/freja/nov?embed=1', webHost }),
    ).toEqual({
      end_ts: '2026-11-30T23:00:00.000Z',
      host_handle: '@freja@qs.example',
      host_identity: 'https://qs.example/u/freja',
      name: 'November steps',
      share_url: 'https://qs.example/u/freja/nov',
      spec: stepsApiSpec,
      start_ts: '2026-10-31T23:00:00.000Z',
      timezone: 'Europe/Stockholm',
    })
    expect(safeFetch.safeFetchPost).not.toHaveBeenCalled()
    expect(db.createChallengeParticipation).not.toHaveBeenCalled()
  })

  test('reads an Aurboda-protocol host from its public resolver', async () => {
    const spec = {
      aggregation: 'sum',
      bucket_size: 'auto',
      pattern: 'steps',
      source_type: 'metric',
      unit: 'steps',
    }
    routeGets({
      '/.well-known/aurboda': aurbodaWellKnown,
      '/public/freja/nov': {
        challenge: {
          end_ts: '2026-11-30T23:00:00.000Z',
          host_identity: 'https://qs.example/u/freja',
          join_token: 'jt',
          members: [],
          name: 'November steps',
          profile_url: 'https://qs.example/u/freja',
          share_url: 'https://qs.example/u/freja/nov',
          spec,
          start_ts: '2026-10-31T23:00:00.000Z',
          timezone: 'Europe/Stockholm',
          visibility: 'public',
        },
        success: true,
        type: 'challenge',
      },
    })
    const preview = await previewChallenge({ challengeUrl: 'https://qs.example/u/freja/nov', webHost })
    expect(preview).toMatchObject({
      host_identity: 'https://qs.example/u/freja',
      name: 'November steps',
      spec,
    })
    expect(preview).not.toHaveProperty('join_token')
  })

  test('reads a challenge on this instance in-process', async () => {
    vi.mocked(db.getChallengeBySlug).mockResolvedValue({
      end_ts: new Date('2026-11-30T23:00:00Z'),
      id: 'c1',
      name: 'November steps',
      spec: stepsSpec,
      start_ts: new Date('2026-10-31T23:00:00Z'),
      timezone: 'Europe/Stockholm',
    } as ChallengeRecord)
    expect(await previewChallenge({ challengeUrl: 'https://home.example/u/freja/nov', webHost })).toEqual({
      end_ts: '2026-11-30T23:00:00.000Z',
      host_handle: '@freja@home.example',
      host_identity: 'https://home.example/u/freja',
      name: 'November steps',
      share_url: 'https://home.example/u/freja/nov',
      spec: stepsApiSpec,
      start_ts: '2026-10-31T23:00:00.000Z',
      timezone: 'Europe/Stockholm',
    })
    expect(db.getChallengeBySlug).toHaveBeenCalledWith('freja', 'nov')
    expect(safeFetch.safeFetchGet).not.toHaveBeenCalled()
    expect(db.upsertChallengeMember).not.toHaveBeenCalled()
  })

  test('fails like a join would', async () => {
    await expect(
      previewChallenge({ challengeUrl: 'https://qs.example/nope', webHost }),
    ).rejects.toMatchObject({
      kind: 'invalid_url',
    })
    await expect(
      previewChallenge({ challengeUrl: 'https://home.example/u/freja/gone', webHost }),
    ).rejects.toMatchObject({ kind: 'not_found' })
    routeGets({
      '/.well-known/quantpub': quantWellKnown,
      '/public/freja/challenges/nov': quantDocument({ metric: 'tracker:pushups', unit: '1' }),
    })
    await expect(
      previewChallenge({ challengeUrl: 'https://qs.example/u/freja/nov', webHost }),
    ).rejects.toMatchObject({ kind: 'federation', message: 'This instance cannot score tracker:pushups' })
  })

  test('refuses a host whose window is not a date', async () => {
    for (const overrides of [{ startTime: 'soon' }, { endTime: '' }]) {
      routeGets({
        '/.well-known/quantpub': quantWellKnown,
        '/public/freja/challenges/nov': quantDocument(overrides),
      })
      await expect(
        previewChallenge({ challengeUrl: 'https://qs.example/u/freja/nov', webHost }),
      ).rejects.toMatchObject({ kind: 'federation', message: 'The host sent an unreadable challenge window' })
    }
  })
})

describe('leaveChallenge', () => {
  const ctx = { apiBaseUrl: 'https://home.example/api', webHost: 'https://home.example' }

  test('tells a QuantPub host with the entry URL, then deletes the participation', async () => {
    vi.mocked(db.getParticipationById).mockResolvedValue(participationRecord())
    routeGets({ '/.well-known/quantpub': quantWellKnown })
    vi.mocked(safeFetch.safeFetchDelete).mockResolvedValue(response({ status: 'left' }))
    expect(await leaveChallenge('ola', 'p1', ctx)).toBe(true)
    expect(safeFetch.safeFetchDelete).toHaveBeenCalledWith(
      'https://qs.example/api/public/freja/challenges/nov/members',
      {
        entryUrl: 'https://home.example/api/public/ola/challenge-entries/dtok',
      },
    )
    expect(db.deleteChallengeParticipation).toHaveBeenCalledWith('ola', 'p1')
  })

  test('a host that fails does not block the leave', async () => {
    vi.mocked(db.getParticipationById).mockResolvedValue(participationRecord())
    routeGets({ '/.well-known/quantpub': quantWellKnown })
    vi.mocked(safeFetch.safeFetchDelete).mockRejectedValue(httpError(404))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await leaveChallenge('ola', 'p1', ctx)).toBe(true)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test('an Aurboda-protocol host and a local challenge are not told', async () => {
    vi.mocked(db.getParticipationById).mockResolvedValue(participationRecord())
    routeGets({ '/.well-known/aurboda': aurbodaWellKnown })
    await leaveChallenge('ola', 'p1', ctx)
    vi.mocked(db.getParticipationById).mockResolvedValue(
      participationRecord({ challenge_url: 'https://home.example/u/freja/nov' }),
    )
    await leaveChallenge('ola', 'p1', ctx)
    expect(safeFetch.safeFetchDelete).not.toHaveBeenCalled()
    expect(db.deleteChallengeParticipation).toHaveBeenCalledTimes(2)
  })

  test('a participation joined over the Aurboda protocol is not told, without even discovering', async () => {
    vi.mocked(db.getParticipationById).mockResolvedValue(participationRecord({ protocol: 'aurboda' }))
    routeGets({ '/.well-known/quantpub': quantWellKnown })
    expect(await leaveChallenge('ola', 'p1', ctx)).toBe(true)
    expect(safeFetch.safeFetchGet).not.toHaveBeenCalled()
    expect(safeFetch.safeFetchDelete).not.toHaveBeenCalled()
    expect(db.deleteChallengeParticipation).toHaveBeenCalledWith('ola', 'p1')
  })

  test('a challenge hosted on this instance drops the leaver from the host standings', async () => {
    vi.mocked(db.getParticipationById).mockResolvedValue(
      participationRecord({ challenge_url: 'https://home.example/u/freja/nov', protocol: 'aurboda' }),
    )
    vi.mocked(db.getChallengeBySlug).mockResolvedValue({ id: 'c1' } as ChallengeRecord)
    vi.mocked(db.getChallengeMemberByIdentity).mockResolvedValue({ id: 'm1' } as ChallengeMemberRecord)

    expect(await leaveChallenge('ola', 'p1', ctx)).toBe(true)

    expect(db.getChallengeBySlug).toHaveBeenCalledWith('freja', 'nov')
    expect(db.getChallengeMemberByIdentity).toHaveBeenCalledWith('freja', 'c1', 'https://home.example/u/ola')
    expect(db.removeChallengeMember).toHaveBeenCalledWith('freja', 'c1', 'm1')
    expect(db.deleteChallengeParticipation).toHaveBeenCalledWith('ola', 'p1')
    expect(safeFetch.safeFetchGet).not.toHaveBeenCalled()
  })

  test('a same-instance leave with no host member row still leaves', async () => {
    vi.mocked(db.getParticipationById).mockResolvedValue(
      participationRecord({ challenge_url: 'https://home.example/u/freja/nov' }),
    )
    vi.mocked(db.getChallengeBySlug).mockResolvedValue({ id: 'c1' } as ChallengeRecord)

    expect(await leaveChallenge('ola', 'p1', ctx)).toBe(true)
    expect(db.removeChallengeMember).not.toHaveBeenCalled()
    expect(db.deleteChallengeParticipation).toHaveBeenCalledWith('ola', 'p1')
  })

  test('a same-instance leave of a deleted challenge still leaves', async () => {
    vi.mocked(db.getParticipationById).mockResolvedValue(
      participationRecord({ challenge_url: 'https://home.example/u/freja/nov' }),
    )
    expect(await leaveChallenge('ola', 'p1', ctx)).toBe(true)
    expect(db.getChallengeMemberByIdentity).not.toHaveBeenCalled()
    expect(db.deleteChallengeParticipation).toHaveBeenCalledWith('ola', 'p1')
  })

  test('an unknown participation is not found', async () => {
    vi.mocked(db.getParticipationById).mockResolvedValue(null)
    expect(await leaveChallenge('ola', 'nope', ctx)).toBe(false)
    expect(db.deleteChallengeParticipation).not.toHaveBeenCalled()
  })
})
