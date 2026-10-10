import type { AutoshareDataFilter } from '@aurboda/api-spec'

import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { AutoshareRuleRecord } from '../db/index.ts'
import type { AutoshareGroupMember } from '../services/autoshare-deps.ts'
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
  enabled: false,
  enabled_at: null,
  id: RULE_ID,
  include_chart: false,
  include_map: false,
  included_metrics: [],
  max_duration_seconds: null,
  message: null,
  min_distance_meters: null,
  min_duration_seconds: null,
  name: 'Named yoga',
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

const buildApp = () => {
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use(createAutoshareRulesRouter(auth, previewDeps) as unknown as express.RequestHandler)
  return app
}

const named = [{ field: 'session_name', operator: 'exists' }]

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
