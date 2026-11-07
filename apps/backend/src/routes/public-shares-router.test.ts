/**
 * Unit tests for the public-shares-router security helpers — the username
 * gate (which selects the per-user database) and the config sanitizer (which
 * neutralizes quick-link hrefs before exposing a config to anonymous viewers) —
 * and the challenge register-back checks.
 */
import type { DashboardConfig } from '@aurboda/api-spec'

import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type * as DbModule from '../db/index.ts'
import type { ChallengeRecord, ChallengeSpecFields, SharedExerciseRecord } from '../db/index.ts'
import type * as FederationModule from '../services/challenge-federation.ts'

import { isValidUsername } from '../api/auth-routes.ts'

vi.mock('../db/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  countPublicFeedPosts: vi.fn(),
  getActivityTypeDefinition: vi.fn(),
  getChallengeBySlug: vi.fn(),
  getChallengeMemberByIdentity: vi.fn(),
  getSharedDashboardBySlug: vi.fn(),
  getSharedExerciseBySlug: vi.fn(),
  getUserSettings: vi.fn(async () => null),
  listChallengeMembers: vi.fn(),
  listPublicChallenges: vi.fn(),
  listPublicSharedDashboards: vi.fn(),
  listPublicSharedExercises: vi.fn(),
  upsertChallengeMember: vi.fn(),
}))

vi.mock('../services/shared-exercise-data.ts', () => ({ resolveSharedExerciseData: vi.fn() }))

vi.mock('../services/challenge-federation.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof FederationModule>()),
  fetchMemberData: vi.fn(),
}))

const db = await import('../db/index.ts')
const federation = await import('../services/challenge-federation.ts')
const exerciseData = await import('../services/shared-exercise-data.ts')
const { createPublicSharesRouter, sanitizeConfig } = await import('./public-shares-router.ts')

describe('isValidUsername (public DB-selecting gate)', () => {
  test('accepts valid usernames', () => {
    expect(isValidUsername('fiddur')).toBe(true)
    expect(isValidUsername('abc')).toBe(true)
    expect(isValidUsername('a_b_2')).toBe(true)
  })

  test('rejects reserved usernames', () => {
    expect(isValidUsername('public')).toBe(false)
    expect(isValidUsername('admin')).toBe(false)
    expect(isValidUsername('postgres')).toBe(false)
  })

  test('rejects malformed / injection-shaped input', () => {
    expect(isValidUsername('AB')).toBe(false) // uppercase
    expect(isValidUsername('1abc')).toBe(false) // leading digit
    expect(isValidUsername('ab')).toBe(false) // too short
    expect(isValidUsername('a'.repeat(40))).toBe(false) // too long
    expect(isValidUsername('a-b')).toBe(false) // hyphen
    expect(isValidUsername('a;drop')).toBe(false) // semicolon
    expect(isValidUsername('a b')).toBe(false) // space
    expect(isValidUsername('')).toBe(false)
  })
})

describe('sanitizeConfig', () => {
  test('neutralizes quick-link hrefs and leaves other widgets untouched', () => {
    const config: DashboardConfig = {
      sections: [
        {
          id: 's1',
          title: 'Links',
          type: 'links',
          widgets: [
            {
              config: { href: '/secret/admin', icon: 'goals', label: 'Goals' },
              id: 'ql',
              type: 'quick_link',
            },
            { config: { metric: 'hrv_7day', title: 'HRV' }, id: 'mc', type: 'metric_card' },
          ],
        },
      ],
      version: 1,
    }

    const sanitized = sanitizeConfig(config)
    const [quickLink, metricCard] = sanitized.sections[0].widgets

    expect(quickLink.type).toBe('quick_link')
    if (quickLink.type === 'quick_link') {
      expect(quickLink.config.href).toBe('#')
      expect(quickLink.config.label).toBe('Goals') // label preserved
    }
    expect(metricCard).toEqual(config.sections[0].widgets[1]) // untouched
    // Original config is not mutated.
    expect(config.sections[0].widgets[0]).toMatchObject({ config: { href: '/secret/admin' } })
  })

  test('preserves author prose (dashboard + section descriptions)', () => {
    const config: DashboardConfig = {
      description: 'Two years of training.',
      sections: [
        { description: 'Recovery metrics.', id: 's1', title: 'Baseline', type: 'metrics', widgets: [] },
      ],
      version: 1,
    }
    const sanitized = sanitizeConfig(config)
    expect(sanitized.description).toBe('Two years of training.')
    expect(sanitized.sections[0].description).toBe('Recovery metrics.')
  })
})

describe('POST /public/:username/:slug/members (register-back)', () => {
  const hoursSpec: ChallengeSpecFields = {
    activity_type_id: null,
    aggregation: 'sum',
    bucket_size: '1w',
    filter_field: null,
    filter_value: null,
    measure: null,
    pattern: 'strength_training',
    source_type: 'activity_type',
    unit: 'hours',
  }
  const bestSetSpec: ChallengeSpecFields = {
    ...hoursSpec,
    aggregation: 'max',
    filter_field: 'sets.exercise',
    filter_value: 'Push-ups',
    measure: 'max_reps',
    unit: 'reps',
  }
  const challenge = (spec: ChallengeSpecFields): ChallengeRecord => ({
    announce_winner: true,
    banner_updated_at: null,
    created_at: new Date('2026-06-01T00:00:00Z'),
    end_ts: new Date('2026-07-01T00:00:00Z'),
    id: 'c1',
    is_public: true,
    join_token: 'jt',
    name: 'Push-ups',
    result_published_at: null,
    slug: 'abc',
    spec,
    start_ts: new Date('2026-06-01T00:00:00Z'),
    timezone: 'UTC',
    updated_at: new Date('2026-06-01T00:00:00Z'),
  })
  const body = {
    data_endpoint_url: 'https://peer.example/api/challenge-data/bob/tok',
    display_name: 'bob',
    identity_base_url: 'https://peer.example/u/bob',
    join_token: 'jt',
  }
  const register = () => {
    const app = express()
    app.use(express.json())
    app.use(createPublicSharesRouter('https://aurboda.net') as unknown as express.RequestHandler)
    return supertest(app).post('/public/alice/abc/members').send(body)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getChallengeMemberByIdentity).mockResolvedValue(null)
    vi.mocked(db.listChallengeMembers).mockResolvedValue([])
  })

  test('a measure challenge accepts a member whose instance echoes the same scoring', async () => {
    vi.mocked(db.getChallengeBySlug).mockResolvedValue(challenge(bestSetSpec))
    vi.mocked(federation.fetchMemberData).mockResolvedValue({
      aggregation: 'max',
      buckets: [],
      filter_field: 'sets.exercise',
      filter_value: 'push-ups',
      measure: 'max_reps',
      success: true,
      total: 0,
    })
    const res = await register()
    expect(res.status).toBe(200)
    expect(db.upsertChallengeMember).toHaveBeenCalledOnce()
  })

  test('refuses with 409 a member whose instance does not echo the measure', async () => {
    vi.mocked(db.getChallengeBySlug).mockResolvedValue(challenge(bestSetSpec))
    vi.mocked(federation.fetchMemberData).mockResolvedValue({ buckets: [], success: true, total: 2.5 })
    const res = await register()
    expect(res.status).toBe(409)
    expect(res.body.error).toBe(
      "Your instance does not support this challenge's measure (max_reps); update Aurboda to join",
    )
    expect(db.upsertChallengeMember).not.toHaveBeenCalled()
  })

  test('refuses with 409 a member whose instance echoes the measure but scores it another way', async () => {
    vi.mocked(db.getChallengeBySlug).mockResolvedValue(challenge(bestSetSpec))
    vi.mocked(federation.fetchMemberData).mockResolvedValue({
      aggregation: 'sum',
      buckets: [],
      filter_field: 'sets.exercise',
      filter_value: 'Push-ups',
      measure: 'max_reps',
      success: true,
      total: 0,
    })
    const res = await register()
    expect(res.status).toBe(409)
    expect(res.body.error).toBe(
      'Your instance scored this challenge differently (aggregation/filter); update Aurboda and rejoin',
    )
    expect(db.upsertChallengeMember).not.toHaveBeenCalled()
  })

  test('a challenge without a measure accepts an instance that echoes nothing', async () => {
    vi.mocked(db.getChallengeBySlug).mockResolvedValue(challenge(hoursSpec))
    vi.mocked(federation.fetchMemberData).mockResolvedValue({ buckets: [], success: true, total: 2.5 })
    expect((await register()).status).toBe(200)
  })
})

describe('shared exercises on the public surface', () => {
  const exercise: SharedExerciseRecord = {
    activity_type: 'strength_training',
    created_at: new Date('2026-10-01T00:00:00Z'),
    field: 'sets.exercise',
    id: 'e1',
    is_public: true,
    name: 'Bench',
    slug: 'ex1',
    updated_at: new Date('2026-10-01T00:00:00Z'),
    value: 'Bench Press',
  }
  const data = { done: null, history: [], per_week: null, records: [], trend: null }
  const app = () => {
    const a = express()
    a.use(createPublicSharesRouter('https://aurboda.net') as unknown as express.RequestHandler)
    return supertest(a)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getSharedDashboardBySlug).mockResolvedValue(null)
    vi.mocked(db.getChallengeBySlug).mockResolvedValue(null)
    vi.mocked(db.getSharedExerciseBySlug).mockResolvedValue(exercise)
    vi.mocked(exerciseData.resolveSharedExerciseData).mockResolvedValue(data)
  })

  test('a slug that is neither a dashboard nor a challenge resolves to the exercise', async () => {
    vi.mocked(db.getActivityTypeDefinition).mockResolvedValue({
      display_name: 'Strength training',
    } as Awaited<ReturnType<typeof db.getActivityTypeDefinition>>)
    const res = await app().get('/public/alice/ex1')
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('public, max-age=60')
    expect(res.body).toEqual({
      activity_type: 'strength_training',
      activity_type_name: 'Strength training',
      data,
      field: 'sets.exercise',
      name: 'Bench',
      profile_url: 'https://aurboda.net/u/alice',
      share_url: 'https://aurboda.net/u/alice/ex1',
      success: true,
      type: 'exercise',
      value: 'Bench Press',
    })
    expect(exerciseData.resolveSharedExerciseData).toHaveBeenCalledWith('alice', exercise)
  })

  test('the type name falls back to the type when it has no definition', async () => {
    vi.mocked(db.getActivityTypeDefinition).mockResolvedValue(null)
    const res = await app().get('/public/alice/ex1')
    expect(res.body.activity_type_name).toBe('strength_training')
  })

  test('an unknown slug is still a 404', async () => {
    vi.mocked(db.getSharedExerciseBySlug).mockResolvedValue(null)
    expect((await app().get('/public/alice/nope')).status).toBe(404)
  })

  test('the profile lists public exercises next to dashboards', async () => {
    vi.mocked(db.listPublicSharedDashboards).mockResolvedValue([])
    vi.mocked(db.listPublicChallenges).mockResolvedValue([])
    vi.mocked(db.listPublicSharedExercises).mockResolvedValue([exercise])
    vi.mocked(db.countPublicFeedPosts).mockResolvedValue(0)
    const res = await app().get('/public/alice/dashboards')
    expect(res.body.exercises).toEqual([
      { name: 'Bench', share_url: 'https://aurboda.net/u/alice/ex1', slug: 'ex1' },
    ])
    expect(res.body.has_articles).toBe(false)
  })

  test('the profile carries the display name, or null without one', async () => {
    vi.mocked(db.listPublicSharedDashboards).mockResolvedValue([])
    vi.mocked(db.listPublicChallenges).mockResolvedValue([])
    vi.mocked(db.listPublicSharedExercises).mockResolvedValue([])
    vi.mocked(db.countPublicFeedPosts).mockResolvedValue(0)
    vi.mocked(db.getUserSettings).mockResolvedValueOnce({ display_name: 'Alice Liddell' })
    expect((await app().get('/public/alice/dashboards')).body.display_name).toBe('Alice Liddell')

    vi.mocked(db.getUserSettings).mockResolvedValueOnce(null)
    expect((await app().get('/public/alice/dashboards')).body.display_name).toBeNull()
  })

  test('the profile says whether the user has public articles, for the Blog link', async () => {
    vi.mocked(db.listPublicSharedDashboards).mockResolvedValue([])
    vi.mocked(db.listPublicChallenges).mockResolvedValue([])
    vi.mocked(db.listPublicSharedExercises).mockResolvedValue([])
    vi.mocked(db.countPublicFeedPosts).mockResolvedValue(3)
    const res = await app().get('/public/alice/dashboards')
    expect(res.body.has_articles).toBe(true)
    expect(db.countPublicFeedPosts).toHaveBeenCalledWith('alice', 'article')
  })
})
