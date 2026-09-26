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
  return { queryActivitySessions: vi.fn(), sessionsOptionsFromQuery }
})

vi.mock('../db/index.ts', () => ({}))

const queries = await import('../services/queries/index.ts')

const buildApp = () => {
  const app = express()
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
