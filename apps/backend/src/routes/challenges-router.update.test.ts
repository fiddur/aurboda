import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type * as DbModule from '../db/index.ts'
import type { ChallengePatch, ChallengeRecord } from '../db/index.ts'

vi.mock('../db/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  getChallengeById: vi.fn(),
  hasRemoteChallengeMember: vi.fn(),
  updateChallenge: vi.fn(),
}))

const db = await import('../db/index.ts')
const { createChallengesRouter } = await import('./challenges-router.ts')
const { SPEC_LOCKED_MESSAGE } = await import('../services/challenge-update.ts')

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

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(db.getChallengeById).mockResolvedValue(record())
  vi.mocked(db.updateChallenge).mockImplementation(
    async (_user: string, _id: string, patch: ChallengePatch) =>
      record({ ...(patch.name ? { name: patch.name } : {}), ...(patch.spec ? { spec: patch.spec } : {}) }),
  )
})

describe('PUT /challenges/:id with a remote member', () => {
  beforeEach(() => {
    vi.mocked(db.hasRemoteChallengeMember).mockResolvedValue(true)
  })

  test('refuses a changed spec with 409', async () => {
    const res = await put({ spec: changedSpecBody })
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: SPEC_LOCKED_MESSAGE, success: false })
    expect(db.updateChallenge).not.toHaveBeenCalled()
  })

  test('refuses a changed spec even alongside allowed fields', async () => {
    const res = await put({ name: 'Renamed', spec: changedSpecBody })
    expect(res.status).toBe(409)
    expect(db.updateChallenge).not.toHaveBeenCalled()
  })

  test('accepts the unchanged spec sent back with the rest of the challenge', async () => {
    const res = await put({ name: 'Renamed', spec: storedSpecBody })
    expect(res.status).toBe(200)
    expect(res.body.challenge.name).toBe('Renamed')
    expect(db.updateChallenge).toHaveBeenCalledOnce()
  })

  test('accepts name, dates and visibility without a spec', async () => {
    const res = await put({
      end_ts: '2026-11-15T00:00:00.000Z',
      name: 'Renamed',
      start_ts: '2026-10-02T00:00:00.000Z',
      visibility: 'unlisted',
    })
    expect(res.status).toBe(200)
    expect(db.updateChallenge).toHaveBeenCalledWith('tester', 'c1', {
      announce_winner: undefined,
      end_ts: new Date('2026-11-15T00:00:00.000Z'),
      is_public: false,
      name: 'Renamed',
      spec: undefined,
      start_ts: new Date('2026-10-02T00:00:00.000Z'),
      timezone: undefined,
    })
  })
})

describe('PUT /challenges/:id without a remote member', () => {
  test('accepts a changed spec', async () => {
    vi.mocked(db.hasRemoteChallengeMember).mockResolvedValue(false)
    const res = await put({ spec: changedSpecBody })
    expect(res.status).toBe(200)
    expect(res.body.challenge.spec.pattern).toBe('distance')
    expect(db.hasRemoteChallengeMember).toHaveBeenCalledWith('tester', 'c1')
  })

  test('404 when the challenge is not the user’s', async () => {
    vi.mocked(db.getChallengeById).mockResolvedValue(null)
    const res = await put({ spec: changedSpecBody })
    expect(res.status).toBe(404)
    expect(db.updateChallenge).not.toHaveBeenCalled()
  })
})
