import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { impactData } from '../test/impact-fixture.ts'
import { createCorrelationsRouter } from './correlations-router.ts'

vi.mock('../services/correlations/activity-impact.ts', () => ({ getActivityImpact: vi.fn() }))

const { getActivityImpact } = await import('../services/correlations/activity-impact.ts')

const buildApp = () => {
  const app = express()
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use('/correlations', createCorrelationsRouter(auth) as unknown as express.RequestHandler)
  return app
}

describe('GET /correlations/activity-impact/:activity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getActivityImpact).mockResolvedValue(impactData())
  })

  test('without start/end analyses the last period_days', async () => {
    const res = await supertest(buildApp()).get(
      '/correlations/activity-impact/yoga?activity_type=activity_type',
    )
    expect(res.status).toBe(200)
    expect(getActivityImpact).toHaveBeenCalledWith(
      'tester',
      'yoga',
      'activity_type',
      30,
      90,
      undefined,
      undefined,
      undefined,
      undefined,
    )
  })

  test('start and end fix the analysed period', async () => {
    const res = await supertest(buildApp()).get(
      '/correlations/activity-impact/yoga?activity_type=activity_type&match=exact&start=2026-01-01T00:00:00Z&end=2026-03-01T00:00:00Z',
    )
    expect(res.status).toBe(200)
    expect(getActivityImpact).toHaveBeenCalledWith(
      'tester',
      'yoga',
      'activity_type',
      30,
      90,
      undefined,
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-01-01T00:00:00Z'),
      'exact',
    )
  })

  test('400 for one bound alone or a reversed period', async () => {
    const app = buildApp()
    const base = '/correlations/activity-impact/yoga?activity_type=activity_type'
    const onlyStart = await supertest(app).get(`${base}&start=2026-01-01T00:00:00Z`)
    expect(onlyStart.status).toBe(400)
    expect(onlyStart.body).toEqual({ error: 'Give both start and end, or neither.', success: false })
    const reversed = await supertest(app).get(`${base}&start=2026-03-01T00:00:00Z&end=2026-01-01T00:00:00Z`)
    expect(reversed.status).toBe(400)
    expect(getActivityImpact).not.toHaveBeenCalled()
  })
})
