import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { createActivityTypesRouter } from './activity-types-router.ts'

vi.mock('../services/activity-type-definitions.ts', () => ({
  addActivityTypeDefinition: vi.fn(),
  deleteActivityTypeDefinition: vi.fn(),
  listActivityTypeDefinitions: vi.fn(),
  mergeActivityType: vi.fn(),
  renameActivityTypeDefinition: vi.fn(),
  updateActivityTypeDefinition: vi.fn(),
}))

vi.mock('../services/queries/index.ts', async () => {
  const { sessionsOptionsFromQuery } = await import('../services/queries/activity-sessions.ts')
  return { queryActivityFieldValues: vi.fn(), queryActivitySessions: vi.fn(), sessionsOptionsFromQuery }
})

vi.mock('../db/index.ts', () => ({}))

const queries = await import('../services/queries/index.ts')
const service = await import('../services/activity-type-definitions.ts')

const buildApp = () => {
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use('/activity-types', createActivityTypesRouter(auth) as unknown as express.RequestHandler)
  return app
}

describe('GET /activity-types/:name/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(queries.queryActivitySessions).mockResolvedValue({ activity_type: 'yoga', sessions: [] })
  })

  test('maps the query onto the service options', async () => {
    const res = await supertest(buildApp()).get('/activity-types/yoga/sessions').query({
      filter_field: 'session_name',
      filter_value: 'Mobility Flow, with Ember',
      group_by: 'session_name',
      start: '2026-01-01T00:00:00Z',
    })

    expect(res.status).toBe(200)
    expect(queries.queryActivitySessions).toHaveBeenCalledWith('tester', 'yoga', {
      end: undefined,
      filter: { field: 'session_name', value: 'Mobility Flow, with Ember' },
      groupBy: 'session_name',
      start: new Date('2026-01-01T00:00:00Z'),
    })
  })

  test('400s on a filter field without a value', async () => {
    const res = await supertest(buildApp()).get('/activity-types/yoga/sessions?filter_field=session_name')

    expect(res.status).toBe(400)
    expect(queries.queryActivitySessions).not.toHaveBeenCalled()
  })
})

describe('GET /activity-types/:name/field-values', () => {
  beforeEach(() => vi.clearAllMocks())

  test('returns the values of the field', async () => {
    const data = {
      activity_type: 'yoga',
      field: 'session_name',
      values: [{ count: 2, last_used: '2026-10-01T07:00:00.000Z', value: 'Flow' }],
    }
    vi.mocked(queries.queryActivityFieldValues).mockResolvedValue(data)

    const res = await supertest(buildApp()).get('/activity-types/yoga/field-values?field=session_name')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data, success: true })
    expect(queries.queryActivityFieldValues).toHaveBeenCalledWith('tester', 'yoga', 'session_name')
  })

  test('400s on a missing or malformed field name', async () => {
    const app = buildApp()
    expect((await supertest(app).get('/activity-types/yoga/field-values')).status).toBe(400)
    expect((await supertest(app).get("/activity-types/yoga/field-values?field=a'b")).status).toBe(400)
    expect(queries.queryActivityFieldValues).not.toHaveBeenCalled()
  })
})

describe('POST /activity-types', () => {
  beforeEach(() => vi.clearAllMocks())

  test('passes aliases through to the service', async () => {
    vi.mocked(service.addActivityTypeDefinition).mockResolvedValue({
      data: {
        aliases: ['sauna', 'bastu'],
        color: '#6b7280',
        display_category: 'other',
        display_name: 'Sauna',
        is_builtin: false,
        name: 'sauna',
        show_on_timeline: true,
      },
      success: true,
    })

    const res = await supertest(buildApp())
      .post('/activity-types')
      .send({ aliases: ['bastu'], display_category: 'other', display_name: 'Sauna', name: 'sauna' })

    expect(res.status).toBe(201)
    expect(service.addActivityTypeDefinition).toHaveBeenCalledWith(
      'tester',
      expect.objectContaining({ aliases: ['bastu'], name: 'sauna' }),
    )
  })
})
