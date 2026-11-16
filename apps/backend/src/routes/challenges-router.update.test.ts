import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type * as DbModule from '../db/index.ts'
import type { ChallengePatch, ChallengeRecord } from '../db/index.ts'

vi.mock('../db/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  getChallengeById: vi.fn(),
  listChallengeMembers: vi.fn(),
  listChallengeParticipations: vi.fn(),
  updateChallenge: vi.fn(),
  updateChallengeParticipationSnapshot: vi.fn(),
}))

const db = await import('../db/index.ts')
const { createChallengesRouter } = await import('./challenges-router.ts')
const { LOCKED_MESSAGES } = await import('../services/challenge-update.ts')

const record = (overrides: Partial<ChallengeRecord> = {}): ChallengeRecord => ({
  announce_winner: false,
  banner_updated_at: null,
  created_at: new Date('2026-09-01T00:00:00Z'),
  end_ts: new Date('2026-11-01T00:00:00Z'),
  id: 'c1',
  is_public: true,
  join_token: 'jt',
  name: 'October steps',
  result_published_at: null,
  slug: 'oct',
  spec: {
    activity_type_id: null,
    aggregation: 'sum',
    bucket_size: '1d',
    filter_field: null,
    filter_value: null,
    measure: null,
    pattern: 'steps',
    source_type: 'metric',
    unit: 'steps',
  },
  start_ts: new Date('2026-10-01T00:00:00Z'),
  timezone: 'UTC',
  updated_at: new Date('2026-09-01T00:00:00Z'),
  ...overrides,
})

const storedSpecBody = {
  aggregation: 'sum',
  bucket_size: '1d',
  pattern: 'steps',
  source_type: 'metric',
  unit: 'steps',
}
const changedSpecBody = { ...storedSpecBody, pattern: 'distance', unit: 'km' }

const buildApp = () => {
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use(
    '/challenges',
    createChallengesRouter(auth, 'https://aurboda.net', 'https://aurboda.net/api', async () => ({
      challenges: [],
      peers_unreachable: 0,
    })) as unknown as express.RequestHandler,
  )
  return app
}

const put = (body: object) => supertest(buildApp()).put('/challenges/c1').send(body)

let remoteMember = false

beforeEach(() => {
  vi.clearAllMocks()
  remoteMember = false
  vi.mocked(db.getChallengeById).mockResolvedValue(record())
  vi.mocked(db.listChallengeMembers).mockResolvedValue([])
  vi.mocked(db.updateChallenge).mockImplementation(
    async (_user: string, _id: string, patch: ChallengePatch, options?: { unlessRemoteMember?: boolean }) =>
      options?.unlessRemoteMember && remoteMember
        ? null
        : record({
            ...(patch.name ? { name: patch.name } : {}),
            ...(patch.spec ? { spec: patch.spec } : {}),
            ...(patch.start_ts ? { start_ts: patch.start_ts } : {}),
            ...(patch.end_ts ? { end_ts: patch.end_ts } : {}),
            ...(patch.timezone ? { timezone: patch.timezone } : {}),
          }),
  )
})

const guarded = () => vi.mocked(db.updateChallenge).mock.calls[0]?.[3]?.unlessRemoteMember

describe('PUT /challenges/:id with a remote member', () => {
  beforeEach(() => {
    remoteMember = true
  })

  test('refuses a changed spec with 409', async () => {
    const res = await put({ spec: changedSpecBody })
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: LOCKED_MESSAGES.spec_locked, success: false })
  })

  test('refuses a changed spec even alongside allowed fields', async () => {
    const res = await put({ name: 'Renamed', spec: changedSpecBody })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe(LOCKED_MESSAGES.spec_locked)
  })

  test('accepts the unchanged spec sent back with the rest of the challenge', async () => {
    const res = await put({ name: 'Renamed', spec: storedSpecBody })
    expect(res.status).toBe(200)
    expect(res.body.challenge.name).toBe('Renamed')
    expect(guarded()).toBe(false)
  })

  test.each([
    ['start', { start_ts: '2026-10-02T00:00:00.000Z' }],
    ['end', { end_ts: '2026-11-15T00:00:00.000Z' }],
    ['timezone', { timezone: 'Europe/Stockholm' }],
  ])('refuses a changed %s with 409', async (_name, body) => {
    const res = await put({ name: 'Renamed', ...body })
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: LOCKED_MESSAGES.window_locked, success: false })
  })

  test('accepts the unchanged dates and timezone sent back with the rest of the challenge', async () => {
    const res = await put({
      end_ts: '2026-11-01T00:00:00.000Z',
      name: 'Renamed',
      start_ts: '2026-10-01T00:00:00.000Z',
      timezone: 'UTC',
    })
    expect(res.status).toBe(200)
    expect(guarded()).toBe(false)
  })

  test('accepts name and visibility', async () => {
    const res = await put({ name: 'Renamed', visibility: 'unlisted' })
    expect(res.status).toBe(200)
    expect(db.updateChallenge).toHaveBeenCalledWith(
      'tester',
      'c1',
      {
        announce_winner: undefined,
        end_ts: undefined,
        is_public: false,
        name: 'Renamed',
        spec: undefined,
        start_ts: undefined,
        timezone: undefined,
      },
      { unlessRemoteMember: false },
    )
  })
})

describe('PUT /challenges/:id without a remote member', () => {
  test('accepts a changed spec, guarded against a remote member joining meanwhile', async () => {
    const res = await put({ spec: changedSpecBody })
    expect(res.status).toBe(200)
    expect(res.body.challenge.spec.pattern).toBe('distance')
    expect(guarded()).toBe(true)
  })

  test('accepts changed dates and timezone, guarded the same way', async () => {
    const res = await put({
      end_ts: '2026-11-15T00:00:00.000Z',
      start_ts: '2026-10-02T00:00:00.000Z',
      timezone: 'Europe/Stockholm',
    })
    expect(res.status).toBe(200)
    expect(res.body.challenge).toMatchObject({
      end_ts: '2026-11-15T00:00:00.000Z',
      start_ts: '2026-10-02T00:00:00.000Z',
      timezone: 'Europe/Stockholm',
    })
    expect(guarded()).toBe(true)
  })

  test("brings a local member's participation in line with the update", async () => {
    vi.mocked(db.listChallengeMembers).mockResolvedValue([
      { kind: 'local', local_user: 'bob' } as Awaited<ReturnType<typeof db.listChallengeMembers>>[number],
    ])
    vi.mocked(db.listChallengeParticipations).mockResolvedValue([
      {
        ...record(),
        challenge_url: 'https://aurboda.net/u/tester/oct',
        data_token: 'tok',
        host_checked_at: null,
        host_identity: 'https://aurboda.net/u/tester',
        id: 'p1',
        protocol: 'aurboda',
        status: 'active',
      },
    ])
    const res = await put({ end_ts: '2026-11-15T00:00:00.000Z', name: 'Renamed' })
    expect(res.status).toBe(200)
    expect(db.listChallengeParticipations).toHaveBeenCalledWith('bob')
    expect(db.updateChallengeParticipationSnapshot).toHaveBeenCalledWith('bob', 'p1', {
      end_ts: new Date('2026-11-15T00:00:00.000Z'),
      name: 'Renamed',
    })
  })

  test('404 when the challenge is not the user’s', async () => {
    vi.mocked(db.getChallengeById).mockResolvedValue(null)
    const res = await put({ spec: changedSpecBody })
    expect(res.status).toBe(404)
    expect(db.updateChallenge).not.toHaveBeenCalled()
  })

  test('404 when the challenge is deleted before the guarded write', async () => {
    vi.mocked(db.getChallengeById).mockResolvedValueOnce(record()).mockResolvedValueOnce(null)
    vi.mocked(db.updateChallenge).mockResolvedValue(null)
    const res = await put({ spec: changedSpecBody })
    expect(res.status).toBe(404)
  })
})
