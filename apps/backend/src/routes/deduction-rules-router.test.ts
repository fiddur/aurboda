import type { DeductionRule } from '@aurboda/api-spec'

import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { DeductionEngineDeps } from '../services/deduction-engine.ts'

import { createDeductionRulesRouter } from './deduction-rules-router.ts'

vi.mock('../db/index.ts', () => ({
  activityTypeExists: vi.fn().mockResolvedValue(true),
  deleteDeductionRule: vi.fn(),
  deleteRuleActivities: vi.fn().mockResolvedValue({ count: 0, earliest_by_type: [] }),
  ensureActivityType: vi.fn().mockResolvedValue(true),
  getDeductionRule: vi.fn(),
  getDeductionRules: vi.fn(),
  getEnabledDeductionRules: vi.fn(),
  insertDeductionRule: vi.fn(),
  listLivePersonIds: vi.fn().mockResolvedValue([]),
  removeRuleCategoryEntries: vi.fn().mockResolvedValue(0),
  updateDeductionRule: vi.fn(),
}))

vi.mock('../services/deduction-engine.ts', () => ({
  evaluateAllRules: vi.fn().mockResolvedValue({ activities_created: 3 }),
}))

vi.mock('../services/training-load/dirty.ts', () => ({ markWorkoutHoursDirty: vi.fn() }))

const db = await import('../db/index.ts')
const { markWorkoutHoursDirty } = await import('../services/training-load/dirty.ts')
const { evaluateAllRules } = await import('../services/deduction-engine.ts')

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
    vi.mocked(db.ensureActivityType).mockResolvedValue(true)
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
    vi.mocked(db.ensureActivityType).mockResolvedValue(true)
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

describe('deduction-rules output_category', () => {
  const categoryBody = (over: Record<string, unknown> = {}) => ({
    conditions: [
      {
        activity_type: 'running',
        feature: 'low_hr_fraction',
        kind: 'activity_feature',
        operator: 'gte',
        value: 0.85,
      },
    ],
    mode: 'enrich',
    name: 'Low-HR run',
    output_activity_type: 'running',
    output_category: 'low_hr',
    ...over,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.activityTypeExists).mockResolvedValue(true)
    vi.mocked(db.ensureActivityType).mockResolvedValue(true)
    vi.mocked(db.insertDeductionRule).mockImplementation(async (_user, input) => rule(input))
  })

  test('stores it on an enrich rule with an activity_feature condition', async () => {
    const res = await supertest(buildApp()).post('/').send(categoryBody())
    expect(res.status).toBe(201)
    expect(vi.mocked(db.insertDeductionRule).mock.calls[0]?.[1]).toMatchObject({
      conditions: [{ feature: 'low_hr_fraction', kind: 'activity_feature' }],
      output_category: 'low_hr',
    })
  })

  test.each([['create'], ['retype']])('rejects it in %s mode', async (mode) => {
    const res = await supertest(buildApp())
      .post('/')
      .send(categoryBody({ conditions: [{ activity_type: 'running', kind: 'activity' }], mode }))
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/output_category requires mode "enrich"/)
    expect(db.insertDeductionRule).not.toHaveBeenCalled()
  })

  test('rejects a category that is not snake_case', async () => {
    const res = await supertest(buildApp())
      .post('/')
      .send(categoryBody({ output_category: 'Low HR' }))
    expect(res.status).toBe(400)
    expect(db.insertDeductionRule).not.toHaveBeenCalled()
  })

  test('switching a categorising rule out of enrich mode is rejected', async () => {
    vi.mocked(db.getDeductionRule).mockResolvedValue(rule({ output_category: 'low_hr' }))
    const res = await supertest(buildApp()).patch(`/${RULE_ID}`).send({ mode: 'create' })
    expect(res.status).toBe(400)
    expect(db.updateDeductionRule).not.toHaveBeenCalled()
  })

  test('null clears it', async () => {
    vi.mocked(db.getDeductionRule).mockResolvedValue(rule({ output_category: 'low_hr' }))
    vi.mocked(db.updateDeductionRule).mockResolvedValue(rule())
    const res = await supertest(buildApp()).patch(`/${RULE_ID}`).send({ output_category: null })
    expect(res.status).toBe(200)
    expect(vi.mocked(db.updateDeductionRule).mock.calls[0]?.[2]).toEqual({ output_category: null })
  })
})

describe('PATCH /deduction-rules/:id run-category cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.activityTypeExists).mockResolvedValue(true)
    vi.mocked(db.ensureActivityType).mockResolvedValue(true)
  })

  test('clearing the category removes the rule entries', async () => {
    vi.mocked(db.getDeductionRule).mockResolvedValue(rule({ output_category: 'low_hr' }))
    vi.mocked(db.updateDeductionRule).mockResolvedValue(rule())
    await supertest(buildApp()).patch(`/${RULE_ID}`).send({ output_category: null })
    expect(db.removeRuleCategoryEntries).toHaveBeenCalledExactlyOnceWith('tester', RULE_ID)
  })

  test('an edit that keeps the category keeps the entries', async () => {
    vi.mocked(db.getDeductionRule).mockResolvedValue(rule({ output_category: 'low_hr' }))
    vi.mocked(db.updateDeductionRule).mockResolvedValue(rule({ name: 'x', output_category: 'low_hr' }))
    await supertest(buildApp()).patch(`/${RULE_ID}`).send({ name: 'x' })
    expect(db.removeRuleCategoryEntries).not.toHaveBeenCalled()
  })
})

describe('deduction-rules output_activity_type from the built-in catalogue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.activityTypeExists).mockResolvedValue(false)
    vi.mocked(db.ensureActivityType).mockResolvedValue(true)
    vi.mocked(db.insertDeductionRule).mockImplementation(async (_user, input) => rule(input))
  })

  test('creating a rule adopts the output type', async () => {
    const res = await supertest(buildApp())
      .post('/')
      .send(body({ output_activity_type: 'sauna' }))
    expect(res.status).toBe(201)
    expect(db.ensureActivityType).toHaveBeenCalledWith('tester', 'sauna')
  })

  test('creating a rule with a type that is neither the user’s nor in the catalogue fails', async () => {
    vi.mocked(db.ensureActivityType).mockResolvedValue(false)
    const res = await supertest(buildApp())
      .post('/')
      .send(body({ output_activity_type: 'not_a_type' }))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Unknown activity type: "not_a_type"')
    expect(db.insertDeductionRule).not.toHaveBeenCalled()
  })

  test('updating a rule adopts the output type', async () => {
    vi.mocked(db.getDeductionRule).mockResolvedValue(rule())
    vi.mocked(db.updateDeductionRule).mockResolvedValue(rule({ output_activity_type: 'sauna' }))
    const res = await supertest(buildApp()).patch(`/${RULE_ID}`).send({ output_activity_type: 'sauna' })
    expect(res.status).toBe(200)
    expect(db.ensureActivityType).toHaveBeenCalledWith('tester', 'sauna')
  })

  test('a preview accepts a catalogue type without adopting it', async () => {
    const res = await supertest(buildApp())
      .post('/preview')
      .send(body({ output_activity_type: 'sauna' }))
    expect(res.status).toBe(200)
    expect(res.body.would_affect).toBe(3)
    expect(db.ensureActivityType).not.toHaveBeenCalled()
  })

  test('a preview refuses a type outside the catalogue', async () => {
    const res = await supertest(buildApp())
      .post('/preview')
      .send(body({ output_activity_type: 'not_a_type' }))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Unknown activity type: "not_a_type"')
  })

  test('a preview without a rule id runs under the preview id', async () => {
    const res = await supertest(buildApp())
      .post('/preview')
      .send(body({ output_activity_type: 'sauna' }))
    expect(res.status).toBe(200)
    expect(db.getDeductionRule).not.toHaveBeenCalled()
    expect(vi.mocked(evaluateAllRules).mock.calls[0]?.[1][0]?.id).toBe('preview')
  })

  test('a preview of an edit runs under the saved rule id, so it reads what that rule decided', async () => {
    vi.mocked(db.getDeductionRule).mockResolvedValue(rule())
    const res = await supertest(buildApp())
      .post('/preview')
      .send(body({ output_activity_type: 'sauna', rule_id: RULE_ID }))
    expect(res.status).toBe(200)
    expect(db.getDeductionRule).toHaveBeenCalledWith('tester', RULE_ID)
    expect(vi.mocked(evaluateAllRules).mock.calls[0]?.[1][0]?.id).toBe(RULE_ID)
  })

  test('a preview of an edit of an unknown rule is a 404', async () => {
    vi.mocked(db.getDeductionRule).mockResolvedValue(null)
    const res = await supertest(buildApp())
      .post('/preview')
      .send(body({ output_activity_type: 'sauna', rule_id: RULE_ID }))
    expect(res.status).toBe(404)
    expect(evaluateAllRules).not.toHaveBeenCalled()
  })

  test('a preview with a malformed rule id is a 400', async () => {
    const res = await supertest(buildApp())
      .post('/preview')
      .send(body({ output_activity_type: 'sauna', rule_id: 'not-a-uuid' }))
    expect(res.status).toBe(400)
    expect(evaluateAllRules).not.toHaveBeenCalled()
  })
})

describe("removing a rule's activities marks the training load hours dirty", () => {
  const earliest_by_type = [{ activity_type: 'running', start_time: new Date('2026-06-01T08:00:00Z') }]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.deleteRuleActivities).mockResolvedValue({ count: 2, earliest_by_type })
  })

  test('deleting the rule', async () => {
    vi.mocked(db.deleteDeductionRule).mockResolvedValue(true)
    const res = await supertest(buildApp()).delete(`/${RULE_ID}`)
    expect(res.status).toBe(200)
    expect(db.deleteRuleActivities).toHaveBeenCalledExactlyOnceWith('tester', RULE_ID)
    expect(markWorkoutHoursDirty).toHaveBeenCalledExactlyOnceWith('tester', earliest_by_type)
  })

  test('disabling the rule', async () => {
    vi.mocked(db.getDeductionRule).mockResolvedValue(rule())
    vi.mocked(db.updateDeductionRule).mockResolvedValue(rule({ enabled: false }))
    const res = await supertest(buildApp()).patch(`/${RULE_ID}`).send({ enabled: false })
    expect(res.status).toBe(200)
    expect(markWorkoutHoursDirty).toHaveBeenCalledExactlyOnceWith('tester', earliest_by_type)
  })
})

describe('output_people', () => {
  const ANNA = '11111111-1111-4111-8111-111111111111'
  const GONE = '22222222-2222-4222-8222-222222222222'
  const peopleBody = (output_people: unknown) => body({ output_people, output_title_field: undefined })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.activityTypeExists).mockResolvedValue(true)
    vi.mocked(db.ensureActivityType).mockResolvedValue(true)
    vi.mocked(db.insertDeductionRule).mockImplementation(async (_user, input) => rule(input))
    vi.mocked(db.listLivePersonIds).mockImplementation(async (_user, ids) => ids.filter((id) => id === ANNA))
  })

  test('stores the people of a rule with nothing else to write', async () => {
    const res = await supertest(buildApp())
      .post('/')
      .send(peopleBody([ANNA]))
    expect(res.status).toBe(201)
    expect(vi.mocked(db.insertDeductionRule).mock.calls[0]?.[1].output_people).toEqual([ANNA])
  })

  test('an unknown person is a 400 naming the id', async () => {
    const res = await supertest(buildApp())
      .post('/')
      .send(peopleBody([ANNA, GONE]))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe(`Unknown people: ${GONE}`)
    expect(db.insertDeductionRule).not.toHaveBeenCalled()
  })

  test('an update with an unknown person is a 400 too', async () => {
    vi.mocked(db.getDeductionRule).mockResolvedValue(rule())
    const res = await supertest(buildApp())
      .patch(`/${RULE_ID}`)
      .send({ output_people: [GONE] })
    expect(res.status).toBe(400)
    expect(db.updateDeductionRule).not.toHaveBeenCalled()
  })

  test('null clears them', async () => {
    vi.mocked(db.getDeductionRule).mockResolvedValue(rule({ output_people: [ANNA] }))
    vi.mocked(db.updateDeductionRule).mockResolvedValue(rule())
    const res = await supertest(buildApp()).patch(`/${RULE_ID}`).send({ output_people: null })
    expect(res.status).toBe(200)
    expect(vi.mocked(db.updateDeductionRule).mock.calls[0]?.[2].output_people).toBeNull()
  })

  test.each([
    ['empty', []],
    ['a repeated person', [ANNA, ANNA]],
    ['not a uuid', ['anna']],
    [
      'more than 20',
      Array.from({ length: 21 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`),
    ],
  ])('the schema rejects %s', async (_label, output_people) => {
    const res = await supertest(buildApp()).post('/').send(peopleBody(output_people))
    expect(res.status).toBe(400)
    expect(db.insertDeductionRule).not.toHaveBeenCalled()
  })

  test('a preview with an unknown person is a 400', async () => {
    const res = await supertest(buildApp())
      .post('/preview')
      .send(peopleBody([GONE]))
    expect(res.status).toBe(400)
  })
})
