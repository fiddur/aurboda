import type { AutoshareDataFilter } from '@aurboda/api-spec'

import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { AutoshareRuleRecord } from '../db/index.ts'
import type { AutoshareGroupMember } from '../services/autoshare-deps.ts'
import type { SkipAutoshare } from '../services/autoshare-skip.ts'
import type { AutosharePreviewDeps } from '../services/autoshare.ts'

import { createAutoshareRulesRouter } from './autoshare-rules-router.ts'

vi.mock('../db/index.ts', () => ({
  countAutosharePostsByRule: vi.fn(),
  deleteAutoshareRule: vi.fn(),
  getAutoshareRules: vi.fn(),
  insertAutoshareRule: vi.fn(),
  updateAutoshareRule: vi.fn(),
}))

vi.mock('../services/audit-log.ts', () => ({ auditWarn: vi.fn() }))

const db = await import('../db/index.ts')

const RULE_ID = '9d0124e7-d161-4855-a54f-fa8bdb45c4f2'
const T0 = new Date('2026-08-01T00:00:00Z')

const record = (over: Partial<AutoshareRuleRecord> = {}): AutoshareRuleRecord => ({
  activity_types: ['yoga'],
  created_at: T0,
  data_filters: [],
  delay_minutes: 10,
  enabled: false,
  enabled_at: null,
  id: RULE_ID,
  include_chart: false,
  include_map: false,
  include_exercises: false,
  included_metrics: [],
  max_age_hours: 24,
  max_duration_seconds: null,
  message: null,
  min_distance_meters: null,
  min_duration_seconds: null,
  name: 'Named yoga',
  tags: null,
  series_metrics: [],
  source: null,
  updated_at: T0,
  visibility: 'followers',
  ...over,
})

const yogaMember = (id: string, data: Record<string, unknown> | null): AutoshareGroupMember => ({
  activity: { activity_type: 'yoga', id, source: 'aurboda', start_time: T0 },
  activity_type: 'yoga',
  created_at: T0,
  data,
  detail_pending: false,
  superseded_by: null,
  end_time: new Date(T0.getTime() + 3_600_000),
  id,
  source: 'aurboda',
  start_time: T0,
  title: null,
})

const previewDeps: AutosharePreviewDeps<AutoshareGroupMember> = {
  distanceMeters: async () => undefined,
  getGroup: async (_user, candidate) => [candidate as AutoshareGroupMember],
  listCandidates: async () => [yogaMember('named', { session_name: 'Yin' }), yogaMember('unnamed', null)],
  resolveWindow: async (_user, anchor) => ({
    activity_type: anchor.activity_type,
    end_time: anchor.end_time,
    start_time: anchor.start_time,
  }),
}

const skipped: SkipAutoshare = async (_user, activityId) => ({
  activity_ids: [activityId],
  status: 'skipped',
})

const buildApp = (skip: SkipAutoshare = skipped) => {
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use(createAutoshareRulesRouter(auth, previewDeps, skip) as unknown as express.RequestHandler)
  return app
}

const named = [{ field: 'session_name', operator: 'exists' }]

describe('autoshare rule tags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.insertAutoshareRule).mockImplementation(async (_user, input) => record(input))
    vi.mocked(db.updateAutoshareRule).mockImplementation(async (_user, _id, patch) => record(patch))
  })

  test('stores given tags normalised, absent ones as null (use the defaults)', async () => {
    const res = await supertest(buildApp())
      .post('/')
      .send({ name: 'Yoga', tags: ['#Yoga', 'yoga', 'Calm'] })
    expect(res.status).toBe(200)
    expect(vi.mocked(db.insertAutoshareRule).mock.calls[0]?.[1].tags).toEqual(['yoga', 'calm'])
    expect(res.body.rule.tags).toEqual(['yoga', 'calm'])
    await supertest(buildApp()).post('/').send({ name: 'Plain' })
    expect(vi.mocked(db.insertAutoshareRule).mock.calls[1]?.[1].tags).toBeNull()
  })

  test('an update normalises tags, null returns to the defaults, absent leaves them', async () => {
    await supertest(buildApp())
      .patch(`/${RULE_ID}`)
      .send({ tags: ['#Run'] })
    await supertest(buildApp()).patch(`/${RULE_ID}`).send({ tags: null })
    await supertest(buildApp()).patch(`/${RULE_ID}`).send({ name: 'x' })
    const patches = vi.mocked(db.updateAutoshareRule).mock.calls.map((call) => call[2])
    expect(patches[0]?.tags).toEqual(['run'])
    expect(patches[1]?.tags).toBeNull()
    expect(patches[2]).not.toHaveProperty('tags')
  })

  test('rejects an invalid tag', async () => {
    const res = await supertest(buildApp())
      .post('/')
      .send({ name: 'Bad', tags: ['two words'] })
    expect(res.status).toBe(400)
  })
})

describe('POST /autoshare-rules data_filters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.insertAutoshareRule).mockImplementation(async (_user, input) => record(input))
  })

  test('passes the filters to the insert and returns them', async () => {
    const res = await supertest(buildApp())
      .post('/')
      .send({ activity_types: ['yoga'], data_filters: named, name: 'Named yoga' })
    expect(res.status).toBe(200)
    expect(vi.mocked(db.insertAutoshareRule).mock.calls[0]?.[1].data_filters).toEqual(named)
    expect(res.body.rule.data_filters).toEqual(named)
  })

  test('defaults to no filters', async () => {
    const res = await supertest(buildApp()).post('/').send({ name: 'Anything' })
    expect(res.status).toBe(200)
    expect(vi.mocked(db.insertAutoshareRule).mock.calls[0]?.[1].data_filters).toEqual([])
  })

  test.each([
    ['eq without a value', [{ field: 'session_name', operator: 'eq' }]],
    ['neq without a value', [{ field: 'session_name', operator: 'neq' }]],
    ['a field name that is not a data key', [{ field: 'Session Name', operator: 'exists' }]],
    ['an unknown operator', [{ field: 'session_name', operator: 'contains', value: 'x' }]],
  ])('rejects %s', async (_label, filters) => {
    const res = await supertest(buildApp()).post('/').send({ data_filters: filters, name: 'Bad' })
    expect(res.status).toBe(400)
    expect(db.insertAutoshareRule).not.toHaveBeenCalled()
  })
})

describe('PATCH /autoshare-rules/:id data_filters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('replaces the list', async () => {
    const filters: AutoshareDataFilter[] = [{ field: 'session_name', operator: 'eq', value: 'Yin yoga' }]
    vi.mocked(db.updateAutoshareRule).mockResolvedValue(record({ data_filters: filters }))
    const res = await supertest(buildApp()).patch(`/${RULE_ID}`).send({ data_filters: filters })
    expect(res.status).toBe(200)
    expect(vi.mocked(db.updateAutoshareRule).mock.calls[0]?.[2]).toEqual({ data_filters: filters })
    expect(res.body.rule.data_filters).toEqual(filters)
  })

  test('rejects eq without a value', async () => {
    const res = await supertest(buildApp())
      .patch(`/${RULE_ID}`)
      .send({ data_filters: [{ field: 'session_name', operator: 'eq' }] })
    expect(res.status).toBe(400)
    expect(db.updateAutoshareRule).not.toHaveBeenCalled()
  })
})

describe('POST /autoshare-rules/preview data_filters', () => {
  test('counts only the activities the filters let through', async () => {
    const withFilters = await supertest(buildApp())
      .post('/preview')
      .send({ activity_types: ['yoga'], data_filters: named, name: 'Named yoga' })
    expect(withFilters.body.would_match).toBe(1)

    const without = await supertest(buildApp())
      .post('/preview')
      .send({ activity_types: ['yoga'], name: 'All yoga' })
    expect(without.body.would_match).toBe(2)
  })
})

describe('autoshare rule max_age_hours', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.insertAutoshareRule).mockImplementation(async (_user, input) => record(input))
  })

  test('defaults to 24 hours on create', async () => {
    const res = await supertest(buildApp()).post('/').send({ name: 'Anything' })
    expect(res.status).toBe(200)
    expect(vi.mocked(db.insertAutoshareRule).mock.calls[0]?.[1].max_age_hours).toBe(24)
    expect(res.body.rule.max_age_hours).toBe(24)
  })

  test('passes a given value to the insert', async () => {
    const res = await supertest(buildApp()).post('/').send({ max_age_hours: 72, name: 'Three days' })
    expect(res.status).toBe(200)
    expect(vi.mocked(db.insertAutoshareRule).mock.calls[0]?.[1].max_age_hours).toBe(72)
  })

  test.each([0, -1, 1.5, 8761])('rejects %s on create', async (value) => {
    const res = await supertest(buildApp()).post('/').send({ max_age_hours: value, name: 'Bad' })
    expect(res.status).toBe(400)
    expect(db.insertAutoshareRule).not.toHaveBeenCalled()
  })

  test('is optional on update, and validated when given', async () => {
    vi.mocked(db.updateAutoshareRule).mockResolvedValue(record({ max_age_hours: 48 }))
    const res = await supertest(buildApp()).patch(`/${RULE_ID}`).send({ max_age_hours: 48 })
    expect(res.status).toBe(200)
    expect(vi.mocked(db.updateAutoshareRule).mock.calls[0]?.[2]).toEqual({ max_age_hours: 48 })

    const bad = await supertest(buildApp()).patch(`/${RULE_ID}`).send({ max_age_hours: 0 })
    expect(bad.status).toBe(400)
  })
})

describe('autoshare rule delay_minutes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.insertAutoshareRule).mockImplementation(async (_user, input) => record(input))
  })

  test('defaults to 10 minutes on create and is returned', async () => {
    const res = await supertest(buildApp()).post('/').send({ name: 'Anything' })
    expect(res.status).toBe(200)
    expect(vi.mocked(db.insertAutoshareRule).mock.calls[0]?.[1].delay_minutes).toBe(10)
    expect(res.body.rule.delay_minutes).toBe(10)
  })

  test.each([9, 1441, 12.5])('rejects %s on create', async (value) => {
    const res = await supertest(buildApp()).post('/').send({ delay_minutes: value, name: 'Bad' })
    expect(res.status).toBe(400)
  })

  test('is optional on update, and validated when given', async () => {
    vi.mocked(db.updateAutoshareRule).mockResolvedValue(record({ delay_minutes: 30 }))
    const res = await supertest(buildApp()).patch(`/${RULE_ID}`).send({ delay_minutes: 30 })
    expect(res.status).toBe(200)
    expect(vi.mocked(db.updateAutoshareRule).mock.calls[0]?.[2]).toEqual({ delay_minutes: 30 })
    expect((await supertest(buildApp()).patch(`/${RULE_ID}`).send({ delay_minutes: 5 })).status).toBe(400)
  })
})

describe('POST /autoshare-rules/skips', () => {
  const ACTIVITY_ID = '3f1c2b9e-8a4d-4c1e-9f6a-2b7d5e8c1a03'

  test('skips the activity and its merge group', async () => {
    const calls: string[] = []
    const res = await supertest(
      buildApp(async (_user, id) => {
        calls.push(id)
        return { activity_ids: [id, 'other'], status: 'skipped' }
      }),
    )
      .post('/skips')
      .send({ activity_id: ACTIVITY_ID })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ activity_ids: [ACTIVITY_ID, 'other'], success: true })
    expect(calls).toEqual([ACTIVITY_ID])
  })

  test('404s for a missing activity', async () => {
    const res = await supertest(buildApp(async () => ({ status: 'not_found' })))
      .post('/skips')
      .send({ activity_id: ACTIVITY_ID })
    expect(res.status).toBe(404)
  })

  test('409s when the activity is already shared', async () => {
    const res = await supertest(buildApp(async () => ({ post_id: 'p', status: 'already_shared' })))
      .post('/skips')
      .send({ activity_id: ACTIVITY_ID })
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'This activity is already shared', success: false })
  })

  test('400s without a uuid activity_id', async () => {
    expect((await supertest(buildApp()).post('/skips').send({ activity_id: 'x' })).status).toBe(400)
  })
})
