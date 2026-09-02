import type { ChallengeStanding } from '@aurboda/api-spec'

import { describe, expect, test, vi } from 'vitest'

import type { ChallengePostInput, ChallengeRecord, FeedPostRecord } from '../db/index.ts'

import {
  buildChallengeResultPost,
  challengeWinners,
  computeChallengeResult,
  publishFinishedChallengeResults,
  RESULT_GRACE_MS,
  resultPostVisibility,
} from './challenge-results.ts'

vi.mock('./audit-log.ts', () => ({ auditError: vi.fn() }))

const standing = (
  name: string,
  total: number,
  status: ChallengeStanding['status'] = 'active',
): ChallengeStanding => ({
  buckets: [],
  display_name: name,
  identity_base_url: `https://h.example/u/${name}`,
  last_updated: null,
  stale: false,
  status,
  total,
})

const challenge = (overrides: Partial<ChallengeRecord> = {}): ChallengeRecord => ({
  announce_winner: true,
  created_at: new Date('2026-08-01T00:00:00Z'),
  end_ts: new Date('2026-08-31T22:00:00Z'),
  id: 'c1',
  is_public: true,
  join_token: 'jt',
  name: 'August steps',
  result_published_at: null,
  slug: 'aug',
  spec: {
    activity_type_id: null,
    aggregation: 'sum',
    bucket_size: 'auto',
    pattern: 'steps',
    source_type: 'metric',
    unit: 'steps',
  },
  start_ts: new Date('2026-07-31T22:00:00Z'),
  timezone: 'Europe/Stockholm',
  updated_at: new Date('2026-08-01T00:00:00Z'),
  ...overrides,
})

describe('computeChallengeResult', () => {
  test('ranks active scorers, podium is ranks 1–3, winner is rank 1', () => {
    const result = computeChallengeResult(
      [standing('bob', 200), standing('alice', 300), standing('carol', 100), standing('dan', 50)],
      'steps',
    )
    expect(result?.podium.map((e) => [e.display_name, e.rank, e.total])).toEqual([
      ['alice', 1, 300],
      ['bob', 2, 200],
      ['carol', 3, 100],
    ])
    expect(result?.member_count).toBe(4)
    expect(result?.unit).toBe('steps')
    expect(challengeWinners(result!).map((e) => e.display_name)).toEqual(['alice'])
  })

  test('equal totals share a rank (competition ranking) and a tie for first means several winners', () => {
    const result = computeChallengeResult(
      [standing('a', 100), standing('b', 100), standing('c', 90), standing('d', 80)],
      'km',
    )
    expect(result?.podium.map((e) => [e.display_name, e.rank])).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 3],
    ])
    expect(challengeWinners(result!).map((e) => e.display_name)).toEqual(['a', 'b'])
  })

  test('ignores withdrawn members and leaves zero-scorers off the podium (still counted as members)', () => {
    const result = computeChallengeResult(
      [standing('gone', 999, 'withdrawn'), standing('alice', 10), standing('zero', 0)],
      'steps',
    )
    expect(result?.podium.map((e) => e.display_name)).toEqual(['alice'])
    expect(result?.member_count).toBe(2)
  })

  test('is null when nobody scored', () => {
    expect(computeChallengeResult([standing('a', 0), standing('b', 0)], 'steps')).toBeNull()
    expect(computeChallengeResult([], 'steps')).toBeNull()
  })

  test('caps a mass tie so the post cannot bloat', () => {
    const many = Array.from({ length: 30 }, (_, i) => standing(`m${i}`, 5))
    expect(computeChallengeResult(many, 'steps')?.podium).toHaveLength(10)
  })
})

describe('buildChallengeResultPost', () => {
  test('carries the canonical link + result, no message, visibility from the challenge', () => {
    const result = computeChallengeResult([standing('alice', 1)], 'steps')!
    const post = buildChallengeResultPost(challenge(), result, 'https://aurboda.net', 'host')
    expect(post).toEqual({
      challenge: { name: 'August steps', result, url: 'https://aurboda.net/u/host/aug' },
      message: null,
      visibility: 'public',
    })
    expect(resultPostVisibility(challenge({ is_public: false }))).toBe('unlisted')
  })
})

describe('publishFinishedChallengeResults', () => {
  const now = new Date('2026-09-01T12:00:00Z')
  const post = { id: 'p1' } as FeedPostRecord

  const deps = (overrides: Partial<Parameters<typeof publishFinishedChallengeResults>[0]> = {}) => {
    const created: { user: string; input: ChallengePostInput }[] = []
    const delivered: string[] = []
    const claimed: string[] = []
    const base = {
      claim: vi.fn(async (_user: string, id: string) => {
        claimed.push(id)
        return true
      }),
      createPost: vi.fn(async (user: string, input: ChallengePostInput) => {
        created.push({ input, user })
        return post
      }),
      deliver: vi.fn((_user: string, p: FeedPostRecord) => {
        delivered.push(p.id)
      }),
      listAwaiting: vi.fn(async () => [challenge()]),
      listUsers: vi.fn(async () => ['host']),
      now: () => now,
      standings: vi.fn(async () => [standing('alice', 300), standing('bob', 200)]),
      webHost: 'https://aurboda.net',
      ...overrides,
    }
    return { ...base, claimed, created, delivered }
  }

  test('asks for challenges that ended at least the grace period ago', async () => {
    const d = deps()
    await publishFinishedChallengeResults(d)
    expect(d.listAwaiting).toHaveBeenCalledWith('host', new Date(now.getTime() - RESULT_GRACE_MS))
  })

  test('claims, posts the result to the host feed and hands it to delivery', async () => {
    const d = deps()
    expect(await publishFinishedChallengeResults(d)).toBe(1)
    expect(d.claimed).toEqual(['c1'])
    expect(d.created).toHaveLength(1)
    expect(d.created[0].user).toBe('host')
    expect(d.created[0].input.challenge.result?.podium[0].display_name).toBe('alice')
    expect(d.delivered).toEqual(['p1'])
  })

  test('does not post when another sweep already claimed the challenge', async () => {
    const d = deps({ claim: vi.fn(async () => false) })
    expect(await publishFinishedChallengeResults(d)).toBe(0)
    expect(d.created).toHaveLength(0)
  })

  test('claims but posts nothing when nobody scored', async () => {
    const d = deps({ standings: vi.fn(async () => [standing('alice', 0)]) })
    expect(await publishFinishedChallengeResults(d)).toBe(0)
    expect(d.claimed).toEqual(['c1'])
    expect(d.created).toHaveLength(0)
  })

  test('a failed standings fetch leaves the challenge unclaimed for the next sweep and continues', async () => {
    const d = deps({
      listAwaiting: vi.fn(async () => [challenge({ id: 'broken' }), challenge({ id: 'fine' })]),
      standings: vi.fn(async (_user: string, c: ChallengeRecord) => {
        if (c.id === 'broken') throw new Error('remote down')
        return [standing('alice', 1)]
      }),
    })
    expect(await publishFinishedChallengeResults(d)).toBe(1)
    expect(d.claimed).toEqual(['fine'])
  })

  test('one user failing to list does not stop the others', async () => {
    const d = deps({
      listAwaiting: vi.fn(async (user: string) => {
        if (user === 'bad') throw new Error('db gone')
        return [challenge()]
      }),
      listUsers: vi.fn(async () => ['bad', 'host']),
    })
    expect(await publishFinishedChallengeResults(d)).toBe(1)
    expect(d.created[0].user).toBe('host')
  })
})
