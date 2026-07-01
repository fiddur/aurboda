/**
 * Integration test for challenge standings aggregation: a local member computed
 * in-process plus a remote member fetched (mocked) from a data endpoint, with
 * TTL caching. Runs against a real PostgreSQL via testcontainers.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  createChallenge,
  insertTimeSeries,
  upsertChallengeMember,
} from '../db/index.ts'
import type * as FederationModule from './challenge-federation.ts'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { fetchMemberData } from './challenge-federation.ts'
import { getChallengeStandings } from './challenge-standings.ts'

vi.mock('./challenge-federation.ts', async (importActual) => {
  const actual = await importActual<typeof FederationModule>()
  return { ...actual, fetchMemberData: vi.fn() }
})

const CONTAINER_TIMEOUT = 120_000

describe('getChallengeStandings integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    vi.mocked(fetchMemberData).mockReset()
  })

  test('aggregates a local member (in-process) and a remote member (fetched + cached)', async () => {
    const user = getTestUser()

    // Local member's data: 2 days of resting_heart_rate (queryable from any source).
    await insertTimeSeries(user, [
      { metric: 'resting_heart_rate', source: 'manual', time: new Date('2026-06-01T08:00:00Z'), value: 50 },
      { metric: 'resting_heart_rate', source: 'manual', time: new Date('2026-06-02T08:00:00Z'), value: 60 },
    ])

    const challenge = await createChallenge(user, {
      end_ts: new Date('2026-06-03T00:00:00Z'),
      is_public: true,
      name: 'RHR sum',
      spec: {
        activity_type_id: null,
        aggregation: 'sum',
        bucket_size: '1d',
        pattern: 'resting_heart_rate',
        source_type: 'metric',
        unit: 'bpm',
      },
      start_ts: new Date('2026-06-01T00:00:00Z'),
      timezone: 'UTC',
    })

    await upsertChallengeMember(user, challenge.id, {
      display_name: user,
      identity_base_url: `https://local/u/${user}`,
      kind: 'local',
      local_user: user,
    })
    await upsertChallengeMember(user, challenge.id, {
      data_endpoint_url: 'https://remote.example/challenge-data/u/tok',
      display_name: 'remote-bob',
      identity_base_url: 'https://remote.example/u/bob',
      kind: 'remote',
    })

    vi.mocked(fetchMemberData).mockResolvedValue({
      buckets: [
        { bucket_start: '2026-06-01T00:00:00.000Z', value: 100 },
        { bucket_start: '2026-06-02T00:00:00.000Z', value: 200 },
      ],
      display_name: 'remote-bob',
      last_updated: new Date().toISOString(),
      success: true,
      total: 300,
      unit: 'bpm',
    })

    const standings = await getChallengeStandings(user, challenge)

    // Sorted by total desc: remote (300) before local (110).
    expect(standings.map((s) => s.display_name)).toEqual(['remote-bob', user])
    expect(standings[0].total).toBe(300)
    expect(standings[1].total).toBe(110)
    // Minimal projection — only bucket_start + value per bucket.
    for (const s of standings) {
      for (const b of s.buckets) expect(Object.keys(b).sort()).toEqual(['bucket_start', 'value'])
    }
    expect(vi.mocked(fetchMemberData)).toHaveBeenCalledTimes(1)

    // Second call within TTL uses the cache — no second remote fetch.
    const again = await getChallengeStandings(user, challenge)
    expect(again.find((s) => s.display_name === 'remote-bob')?.total).toBe(300)
    expect(vi.mocked(fetchMemberData)).toHaveBeenCalledTimes(1)
  })

  test('caches a failed remote fetch for the TTL (no per-call re-fetch storm)', async () => {
    const user = getTestUser()
    const challenge = await createChallenge(user, {
      end_ts: new Date('2026-06-03T00:00:00Z'),
      is_public: true,
      name: 'Flaky',
      spec: {
        activity_type_id: null,
        aggregation: 'sum',
        bucket_size: '1d',
        pattern: 'steps',
        source_type: 'metric',
        unit: 'steps',
      },
      start_ts: new Date('2026-06-01T00:00:00Z'),
      timezone: 'UTC',
    })
    await upsertChallengeMember(user, challenge.id, {
      data_endpoint_url: 'https://remote.example/challenge-data/u/tok',
      display_name: 'hangs',
      identity_base_url: 'https://remote.example/u/hangs',
      kind: 'remote',
    })

    // Endpoint always fails — it must still be cached so the TTL bounds fan-out.
    vi.mocked(fetchMemberData).mockRejectedValue(new Error('timeout'))

    const first = await getChallengeStandings(user, challenge)
    expect(first[0].stale).toBe(true)
    expect(first[0].total).toBe(0)
    expect(vi.mocked(fetchMemberData)).toHaveBeenCalledTimes(1)

    // Within the TTL the failed member is NOT re-fetched (the bug this guards).
    await getChallengeStandings(user, challenge)
    expect(vi.mocked(fetchMemberData)).toHaveBeenCalledTimes(1)
  })
})
