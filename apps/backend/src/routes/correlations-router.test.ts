import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { impactData } from '../test/impact-fixture.ts'
import { createCorrelationsRouter } from './correlations-router.ts'

vi.mock('../services/correlations/activity-impact.ts', () => ({ getActivityImpact: vi.fn() }))
vi.mock('../services/correlations/hrv-activities.ts', () => ({ getHrvActivitiesCorrelation: vi.fn() }))
vi.mock('../services/correlations/impact-metrics.ts', () => ({ getImpactMetrics: vi.fn() }))

const { getActivityImpact } = await import('../services/correlations/activity-impact.ts')
const { getHrvActivitiesCorrelation } = await import('../services/correlations/hrv-activities.ts')
const { getImpactMetrics } = await import('../services/correlations/impact-metrics.ts')

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
      [],
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
      [],
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

describe('extra metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getActivityImpact).mockResolvedValue(impactData())
    vi.mocked(getHrvActivitiesCorrelation).mockResolvedValue({} as never)
  })

  test('the metrics param reaches both analyses, parsed', async () => {
    const app = buildApp()
    const impact = await supertest(app).get(
      '/correlations/activity-impact/yoga?activity_type=activity_type&metrics=body_battery,%20respiratory_rate,body_battery',
    )
    expect(impact.status).toBe(200)
    expect(vi.mocked(getActivityImpact).mock.calls[0][9]).toEqual(['body_battery', 'respiratory_rate'])

    const context = await supertest(app).get('/correlations/hrv-activities?metrics=body_battery')
    expect(context.status).toBe(200)
    expect(getHrvActivitiesCorrelation).toHaveBeenCalledWith('tester', 30, undefined, undefined, 30, [
      'body_battery',
    ])
  })

  test('400 for a cumulative metric or too many', async () => {
    const app = buildApp()
    const cumulative = await supertest(app).get(
      '/correlations/activity-impact/yoga?activity_type=activity_type&metrics=steps',
    )
    expect(cumulative.status).toBe(400)
    expect(cumulative.body).toMatchObject({ success: false })
    const tooMany = await supertest(app).get('/correlations/hrv-activities?metrics=a,b,c,d,e')
    expect(tooMany.status).toBe(400)
    expect(getActivityImpact).not.toHaveBeenCalled()
    expect(getHrvActivitiesCorrelation).not.toHaveBeenCalled()
  })
})

describe('GET /correlations/impact-metrics', () => {
  test('lists the dense metrics for the period', async () => {
    const metrics = [
      {
        coverage_hours_per_day: 24,
        label: 'Body Battery',
        metric: 'body_battery',
        samples_per_day: 288,
        unit: 'score',
      },
    ]
    vi.mocked(getImpactMetrics).mockResolvedValue(metrics)

    const res = await supertest(buildApp()).get('/correlations/impact-metrics?period_days=14')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: { metrics }, success: true })
    expect(getImpactMetrics).toHaveBeenCalledWith('tester', 14)
  })
})
