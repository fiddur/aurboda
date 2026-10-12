import type { DeductionRule } from '@aurboda/api-spec'

import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { DeductionEngineDeps } from '../services/deduction-engine.ts'

import { createDeductionRulesRouter } from './deduction-rules-router.ts'

vi.mock('../db/index.ts', () => ({
  activityTypeExists: vi.fn().mockResolvedValue(true),
  deleteDeductionRule: vi.fn(),
  deleteRuleActivities: vi.fn(),
  getDeductionRule: vi.fn(),
  getDeductionRules: vi.fn(),
  getEnabledDeductionRules: vi.fn(),
  insertDeductionRule: vi.fn(),
  updateDeductionRule: vi.fn(),
}))

const db = await import('../db/index.ts')

const RULE_ID = '0f8b2a39-1d0e-4c64-9d8c-6b3b3c2f7a01'

const rule = (over: Partial<DeductionRule> = {}): DeductionRule => ({
  conditions: [{ activity_type: 'yoga', kind: 'activity' }],
  enabled: true,
  id: RULE_ID,
  mode: 'enrich',
  name: 'Yoga title',
  output_activity_type: 'yoga',
  priority: 0,
  ...over,
})

const buildApp = () => {
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  const router = createDeductionRulesRouter(auth, {} as DeductionEngineDeps)
  app.use(router as unknown as express.RequestHandler)
  return app
}

const body = (over: Record<string, unknown> = {}) => ({
  conditions: [{ activity_type: 'yoga', kind: 'activity' }],
  mode: 'enrich',
  name: 'Yoga title',
  output_activity_type: 'yoga',
  output_title_field: 'session_name',
  ...over,
})

describe('POST /deduction-rules output_title_field', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.activityTypeExists).mockResolvedValue(true)
    vi.mocked(db.insertDeductionRule).mockImplementation(async (_user, input) => rule(input))
  })

  test('stores it on an enrich rule', async () => {
    const res = await supertest(buildApp()).post('/').send(body())
    expect(res.status).toBe(201)
    expect(vi.mocked(db.insertDeductionRule).mock.calls[0]?.[1].output_title_field).toBe('session_name')
    expect(res.body.data.output_title_field).toBe('session_name')
  })

  test.each([
    ['create', {}],
    ['retype', { mode: 'retype' }],
  ])('rejects it in %s mode', async (_label, over) => {
    const { mode: _mode, ...rest } = body()
    const res = await supertest(buildApp())
      .post('/')
      .send({ ...rest, ...over })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/output_title_field requires mode "enrich"/)
    expect(db.insertDeductionRule).not.toHaveBeenCalled()
  })

  test.each([['Session Name'], ['1st'], ['']])('rejects the field name %j', async (field) => {
    const res = await supertest(buildApp())
      .post('/')
      .send(body({ output_title_field: field }))
    expect(res.status).toBe(400)
    expect(db.insertDeductionRule).not.toHaveBeenCalled()
  })
})

describe('PATCH /deduction-rules/:id output_title_field', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.activityTypeExists).mockResolvedValue(true)
  })

  test('null clears it', async () => {
    vi.mocked(db.getDeductionRule).mockResolvedValue(rule({ output_title_field: 'session_name' }))
    vi.mocked(db.updateDeductionRule).mockResolvedValue(rule())
    const res = await supertest(buildApp()).patch(`/${RULE_ID}`).send({ output_title_field: null })
    expect(res.status).toBe(200)
    expect(vi.mocked(db.updateDeductionRule).mock.calls[0]?.[2]).toEqual({ output_title_field: null })
  })

  test('switching a titling rule out of enrich mode is rejected', async () => {
    vi.mocked(db.getDeductionRule).mockResolvedValue(rule({ output_title_field: 'session_name' }))
    const res = await supertest(buildApp()).patch(`/${RULE_ID}`).send({ mode: 'create' })
    expect(res.status).toBe(400)
    expect(db.updateDeductionRule).not.toHaveBeenCalled()
  })

  test('rejects an invalid field name', async () => {
    const res = await supertest(buildApp()).patch(`/${RULE_ID}`).send({ output_title_field: 'Session Name' })
    expect(res.status).toBe(400)
    expect(db.updateDeductionRule).not.toHaveBeenCalled()
  })
})
