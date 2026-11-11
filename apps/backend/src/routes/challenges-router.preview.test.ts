import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type * as DbModule from '../db/index.ts'
import type { ChallengeRecord } from '../db/index.ts'

vi.mock('../db/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  getChallengeBySlug: vi.fn(),
}))

const db = await import('../db/index.ts')
const { createChallengesRouter } = await import('./challenges-router.ts')

const buildApp = () => {
  const app = express()
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /challenges/preview', () => {
  test('answers with what joining the link would join', async () => {
    vi.mocked(db.getChallengeBySlug).mockResolvedValue({
      end_ts: new Date('2026-11-01T00:00:00Z'),
      name: 'October steps',
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
    } as ChallengeRecord)
    const res = await supertest(buildApp())
      .get('/challenges/preview')
      .query({ challenge_url: 'https://aurboda.net/u/alice/oct' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      challenge: {
        end_ts: '2026-11-01T00:00:00.000Z',
        host_handle: '@alice@aurboda.net',
        host_identity: 'https://aurboda.net/u/alice',
        name: 'October steps',
        share_url: 'https://aurboda.net/u/alice/oct',
        spec: {
          aggregation: 'sum',
          bucket_size: '1d',
          pattern: 'steps',
          source_type: 'metric',
          unit: 'steps',
        },
        start_ts: '2026-10-01T00:00:00.000Z',
        timezone: 'UTC',
      },
      success: true,
    })
    expect(db.getChallengeBySlug).toHaveBeenCalledWith('alice', 'oct')
  })

  test('404 for a challenge this instance does not have', async () => {
    vi.mocked(db.getChallengeBySlug).mockResolvedValue(null)
    const res = await supertest(buildApp())
      .get('/challenges/preview')
      .query({ challenge_url: 'https://aurboda.net/u/alice/gone' })
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Challenge not found', success: false })
  })

  test('400 for a link that is not a challenge, or none', async () => {
    const notChallenge = await supertest(buildApp())
      .get('/challenges/preview')
      .query({ challenge_url: 'https://aurboda.net/settings' })
    expect(notChallenge.status).toBe(400)
    expect(notChallenge.body.error).toBe('Not a valid challenge URL')
    expect((await supertest(buildApp()).get('/challenges/preview')).status).toBe(400)
  })
})
