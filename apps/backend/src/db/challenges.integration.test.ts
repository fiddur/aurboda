import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

/**
 * Integration tests for challenges CRUD, members, and participations.
 */
import type { ChallengeSpecFields } from './challenges.ts'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  createChallenge,
  createChallengeParticipation,
  deleteChallenge,
  getChallengeBySlug,
  getParticipationByToken,
  listChallengeMembers,
  listChallengeParticipations,
  listChallenges,
  listPublicChallenges,
  removeChallengeMember,
  updateChallenge,
  updateChallengeMemberCache,
  upsertChallengeMember,
} from './challenges.ts'
import { createSharedDashboard } from './shared-dashboards.ts'

const CONTAINER_TIMEOUT = 120_000

const spec: ChallengeSpecFields = {
  activity_type_id: null,
  aggregation: 'sum',
  bucket_size: '1d',
  pattern: 'steps',
  source_type: 'metric',
  unit: 'steps',
}

const sampleInput = (name: string, isPublic = false) => ({
  end_ts: new Date('2026-06-08T00:00:00Z'),
  is_public: isPublic,
  name,
  spec,
  start_ts: new Date('2026-06-01T00:00:00Z'),
  timezone: 'Europe/Stockholm',
})

describe('Challenges integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('creates with a slug + join_token and round-trips by slug', async () => {
    const user = getTestUser()
    const created = await createChallenge(user, sampleInput('Step war'))

    expect(created.slug).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(created.join_token).toBeTruthy()
    expect(created.spec).toEqual(spec)
    expect(created.start_ts.toISOString()).toBe('2026-06-01T00:00:00.000Z')

    const bySlug = await getChallengeBySlug(user, created.slug)
    expect(bySlug?.id).toBe(created.id)
    expect(await getChallengeBySlug(user, 'nope')).toBeNull()
  })

  test('slug does not collide with a shared dashboard slug', async () => {
    const user = getTestUser()
    const dash = await createSharedDashboard(user, {
      config: { sections: [], version: 1 },
      is_public: false,
      name: 'D',
    })
    // Create several challenges; none should ever reuse the dashboard's slug.
    const slugs = new Set<string>([dash.slug])
    for (let i = 0; i < 5; i++) {
      const c = await createChallenge(user, sampleInput(`C${i}`))
      expect(slugs.has(c.slug)).toBe(false)
      slugs.add(c.slug)
    }
  })

  test('lists all and public-only', async () => {
    const user = getTestUser()
    await createChallenge(user, sampleInput('pub', true))
    await createChallenge(user, sampleInput('priv', false))
    expect((await listChallenges(user)).length).toBe(2)
    const pub = await listPublicChallenges(user)
    expect(pub.map((c) => c.name)).toEqual(['pub'])
  })

  test('updates spec + visibility, deletes', async () => {
    const user = getTestUser()
    const c = await createChallenge(user, sampleInput('x'))
    const updated = await updateChallenge(user, c.id, {
      is_public: true,
      spec: {
        ...spec,
        aggregation: 'count',
        unit: 'sessions',
        pattern: 'exercise',
        source_type: 'activity_type',
      },
    })
    expect(updated?.slug).toBe(c.slug)
    expect(updated?.is_public).toBe(true)
    expect(updated?.spec.aggregation).toBe('count')
    expect(updated?.spec.source_type).toBe('activity_type')

    expect(await deleteChallenge(user, c.id)).toBe(true)
    expect(await getChallengeBySlug(user, c.slug)).toBeNull()
  })

  test('upserts members (idempotent by identity), caches data, removes', async () => {
    const user = getTestUser()
    const c = await createChallenge(user, sampleInput('m'))

    const m1 = await upsertChallengeMember(user, c.id, {
      display_name: 'alice',
      identity_base_url: 'https://aurboda.net/u/alice',
      kind: 'local',
      local_user: 'alice',
    })
    // Re-join with a new display name updates the same row.
    const m1b = await upsertChallengeMember(user, c.id, {
      display_name: 'Alice A.',
      identity_base_url: 'https://aurboda.net/u/alice',
      kind: 'local',
      local_user: 'alice',
    })
    expect(m1b.id).toBe(m1.id)

    await upsertChallengeMember(user, c.id, {
      data_endpoint_url: 'https://foo.bar/challenge-data/tok',
      display_name: 'bob',
      identity_base_url: 'https://foo.bar/u/bob',
      kind: 'remote',
    })

    let members = await listChallengeMembers(user, c.id)
    expect(members.length).toBe(2)
    expect(members.find((m) => m.identity_base_url.includes('alice'))?.display_name).toBe('Alice A.')

    await updateChallengeMemberCache(user, m1.id, {
      buckets: [{ bucket_start: '2026-06-01T00:00:00.000Z', value: 1000 }],
      error: null,
      total: 1000,
    })
    members = await listChallengeMembers(user, c.id)
    const cached = members.find((m) => m.id === m1.id)
    expect(cached?.cached_total).toBe(1000)
    expect(cached?.cached_buckets).toEqual([{ bucket_start: '2026-06-01T00:00:00.000Z', value: 1000 }])
    expect(cached?.last_fetched_at).not.toBeNull()

    expect(await removeChallengeMember(user, c.id, m1.id)).toBe(true)
    expect((await listChallengeMembers(user, c.id)).length).toBe(1)
  })

  test('cascade deletes members with the challenge', async () => {
    const user = getTestUser()
    const c = await createChallenge(user, sampleInput('casc'))
    await upsertChallengeMember(user, c.id, {
      display_name: 'a',
      identity_base_url: 'https://x/u/a',
      kind: 'local',
      local_user: 'a',
    })
    await deleteChallenge(user, c.id)
    expect((await listChallengeMembers(user, c.id)).length).toBe(0)
  })

  test('creates a participation with a data token and looks it up', async () => {
    const user = getTestUser()
    const p = await createChallengeParticipation(user, {
      challenge_url: 'https://aurboda.net/u/alice/abc123',
      end_ts: new Date('2026-06-08T00:00:00Z'),
      host_identity: 'https://aurboda.net/u/alice',
      name: 'Step war',
      spec,
      start_ts: new Date('2026-06-01T00:00:00Z'),
      timezone: 'Europe/Stockholm',
    })

    expect(p.data_token).toBeTruthy()
    expect((await listChallengeParticipations(user)).length).toBe(1)
    const byToken = await getParticipationByToken(user, p.data_token)
    expect(byToken?.id).toBe(p.id)
    expect(byToken?.spec).toEqual(spec)
    expect(await getParticipationByToken(user, 'missing')).toBeNull()
  })
})
