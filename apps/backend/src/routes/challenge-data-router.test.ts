import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type * as DbModule from '../db/index.ts'
import type { ChallengeParticipationRecord, ChallengeSpecFields } from '../db/index.ts'
import type * as SpecModule from '../services/challenge-spec.ts'

vi.mock('../db/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  getParticipationByToken: vi.fn(),
}))

vi.mock('../services/challenge-spec.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof SpecModule>()),
  resolveMemberSeries: vi.fn(),
}))

const db = await import('../db/index.ts')
const spec = await import('../services/challenge-spec.ts')
const { createChallengeDataRouter } = await import('./challenge-data-router.ts')

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

const participation = (specFields: ChallengeSpecFields): ChallengeParticipationRecord => ({
  challenge_url: 'https://peer.example/u/alice/abc',
  created_at: new Date('2026-06-01T00:00:00Z'),
  data_token: 'tok',
  end_ts: new Date('2026-07-01T00:00:00Z'),
  host_identity: 'https://peer.example/u/alice',
  id: 'p1',
  name: 'Push-ups',
  spec: specFields,
  start_ts: new Date('2026-06-01T00:00:00Z'),
  status: 'active',
  timezone: 'UTC',
})

const buildApp = () => {
  const app = express()
  app.use(createChallengeDataRouter() as unknown as express.RequestHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(spec.resolveMemberSeries).mockResolvedValue({
    buckets: [{ bucket_start: '2026-06-01T00:00:00.000Z', value: 30 }],
    last_updated: '2026-06-02T17:00:00.000Z',
    total: 30,
  })
})

describe('GET /challenge-data/:username/:token', () => {
  test('echoes the measure, aggregation and item filter it scored with', async () => {
    vi.mocked(db.getParticipationByToken).mockResolvedValue(
      participation({
        ...hoursSpec,
        aggregation: 'max',
        filter_field: 'sets.exercise',
        filter_value: 'Push-ups',
        measure: 'max_reps',
        unit: 'reps',
      }),
    )
    const res = await supertest(buildApp()).get('/challenge-data/bob/tok')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      aggregation: 'max',
      buckets: [{ bucket_start: '2026-06-01T00:00:00.000Z', value: 30 }],
      display_name: 'bob',
      filter_field: 'sets.exercise',
      filter_value: 'Push-ups',
      last_updated: '2026-06-02T17:00:00.000Z',
      measure: 'max_reps',
      success: true,
      total: 30,
      unit: 'reps',
    })
  })

  test('a spec without a measure echoes only the aggregation', async () => {
    vi.mocked(db.getParticipationByToken).mockResolvedValue(participation(hoursSpec))
    const res = await supertest(buildApp()).get('/challenge-data/bob/tok')
    expect(res.status).toBe(200)
    expect(res.body.aggregation).toBe('sum')
    expect(res.body).not.toHaveProperty('measure')
    expect(res.body).not.toHaveProperty('filter_field')
    expect(res.body).not.toHaveProperty('filter_value')
  })

  test('an unknown or withdrawn token is not found', async () => {
    vi.mocked(db.getParticipationByToken).mockResolvedValueOnce(null)
    expect((await supertest(buildApp()).get('/challenge-data/bob/missing')).status).toBe(404)
    vi.mocked(db.getParticipationByToken).mockResolvedValueOnce({
      ...participation(hoursSpec),
      status: 'withdrawn',
    })
    expect((await supertest(buildApp()).get('/challenge-data/bob/tok')).status).toBe(404)
  })
})
