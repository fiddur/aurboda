import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { createActivitiesRouter } from './activities-router.ts'

// Mock the DB barrel and the queries barrel the router pulls from. Only the
// functions the GET /activities/:id plain path calls need real behaviour.
vi.mock('../db/index.ts', () => ({
  getActivityById: vi.fn(),
  getDeductionRule: vi.fn().mockResolvedValue(null),
}))

vi.mock('../services/queries/index.ts', () => ({
  computeActivityDetailMetrics: vi.fn().mockResolvedValue({}),
  getActivityFullDetail: vi.fn(),
  getCommentsMap: vi.fn(),
  parseActivityId: vi.fn(),
  parseMetricsParam: vi.fn(),
  queryActivities: vi.fn(),
  resolveActivityWindow: vi.fn(),
}))

vi.mock('../services/mutations.ts', () => ({
  addActivity: vi.fn(),
  deleteActivity: vi.fn(),
  mergeActivities: vi.fn(),
  restoreActivity: vi.fn(),
  updateActivity: vi.fn(),
}))

vi.mock('../services/fit-parser.ts', () => ({ parseFitBuffer: vi.fn() }))

const db = await import('../db/index.ts')
const queries = await import('../services/queries/index.ts')

const ACTIVITY_ID = '9d0124e7-d161-4855-a54f-fa8bdb45c4f2'

const buildApp = () => {
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use(createActivitiesRouter(auth) as unknown as express.RequestHandler)
  return app
}

describe('GET /activities/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(queries.computeActivityDetailMetrics).mockResolvedValue(
      {} as Awaited<ReturnType<typeof queries.computeActivityDetailMetrics>>,
    )
    vi.mocked(db.getActivityById).mockResolvedValue({
      activity_type: 'running',
      data: {},
      id: ACTIVITY_ID,
      source: 'garmin',
      start_time: new Date('2026-06-08T10:00:00Z'),
    } as unknown as Awaited<ReturnType<typeof db.getActivityById>>)
  })

  test('includes the user notes as comments (#794)', async () => {
    vi.mocked(queries.getCommentsMap).mockResolvedValue(
      new Map([
        [ACTIVITY_ID, [{ content: 'Tempo run — felt strong', id: 'note-1' }]],
      ]) as Awaited<ReturnType<typeof queries.getCommentsMap>>,
    )

    const res = await supertest(buildApp()).get(`/activities/${ACTIVITY_ID}`)

    expect(res.status).toBe(200)
    expect(res.body.data.comments).toEqual([{ content: 'Tempo run — felt strong', id: 'note-1' }])
    expect(vi.mocked(queries.getCommentsMap)).toHaveBeenCalledWith('tester', 'activity', [ACTIVITY_ID])
  })

  test('returns an empty comments array when the activity has no notes', async () => {
    vi.mocked(queries.getCommentsMap).mockResolvedValue(
      new Map() as Awaited<ReturnType<typeof queries.getCommentsMap>>,
    )

    const res = await supertest(buildApp()).get(`/activities/${ACTIVITY_ID}`)

    expect(res.status).toBe(200)
    expect(res.body.data.comments).toEqual([])
  })
})
