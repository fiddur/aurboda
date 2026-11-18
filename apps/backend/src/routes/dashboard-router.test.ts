import { type DashboardConfig, MUSCLE_GROUP_FILTER_NEEDS_SUMMED_MEASURE } from '@aurboda/api-spec'
import express, { type RequestHandler } from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type * as Periods from '../services/periods.ts'

vi.mock('../db/index.ts', () => ({ upsertUserSettings: vi.fn() }))
vi.mock('../services/settings.ts', () => ({ getSettings: vi.fn() }))
vi.mock('../services/shared-dashboard-data.ts', () => ({ resolveDashboardView: vi.fn() }))
vi.mock('../services/data-presence.ts', () => ({ queryDataPresence: vi.fn() }))

const { upsertUserSettings } = await import('../db/index.ts')
const { getSettings } = await import('../services/settings.ts')
const { resolveDashboardView } = await import('../services/shared-dashboard-data.ts')
const { queryDataPresence } = await import('../services/data-presence.ts')
const { PeriodError } = await vi.importActual<typeof Periods>('../services/periods.ts')
const { createDashboardRouter } = await import('./dashboard-router.ts')

const asAlice: RequestHandler = (req, _res, next) => {
  req.user = 'alice'
  next()
}

const app = () => {
  const a = express()
  a.use(express.json())
  a.use('/dashboard', createDashboardRouter(asAlice) as unknown as express.RequestHandler)
  return supertest(a)
}

const monthly: DashboardConfig = { period: { granularity: 'month' }, sections: [], version: 1 }

describe('GET /dashboard/data', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getSettings).mockResolvedValue({ dashboard: monthly } as Awaited<
      ReturnType<typeof getSettings>
    >)
  })

  test('resolves the home dashboard over the asked period', async () => {
    const view = {
      period: '2026-09',
      widget_data: {},
      window: { end: '2026-09-30T22:00:00.000Z', start: '2026-08-31T22:00:00.000Z' },
    }
    vi.mocked(resolveDashboardView).mockResolvedValue(view)

    const res = await app().get('/dashboard/data?period=2026-09')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ...view, success: true })
    expect(resolveDashboardView).toHaveBeenCalledWith('alice', monthly, '2026-09')
  })

  test('a malformed period is a 400 before resolving', async () => {
    const res = await app().get('/dashboard/data?period=October')

    expect(res.status).toBe(400)
    expect(resolveDashboardView).not.toHaveBeenCalled()
  })

  test('an unfinished period is a 400', async () => {
    vi.mocked(resolveDashboardView).mockRejectedValue(new PeriodError('not_finished'))

    const res = await app().get('/dashboard/data?period=2026-11')

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Period has not finished yet', success: false })
  })
})

describe('GET /dashboard/data-presence', () => {
  beforeEach(() => vi.clearAllMocks())

  test('answers whether each asked source ever delivered, for the signed-in user', async () => {
    const presence = { activity_types: { exercise: false }, metrics: { steps: true } }
    vi.mocked(queryDataPresence).mockResolvedValue(presence)

    const res = await app().get('/dashboard/data-presence?metrics=steps&activity_types=exercise')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ...presence, success: true })
    expect(queryDataPresence).toHaveBeenCalledWith('alice', { activity_types: 'exercise', metrics: 'steps' })
  })
})

describe('PUT /dashboard', () => {
  beforeEach(() => vi.clearAllMocks())

  const withBars = (measure: string): DashboardConfig =>
    ({
      sections: [
        {
          id: 's',
          title: 'Strength',
          type: 'charts',
          widgets: [
            {
              config: {
                bucket_size: '1w',
                filter_field: 'sets.exercise.muscle_group',
                filter_value: 'chest',
                lookback_days: 90,
                measure,
                pattern: 'strength_training',
                source_type: 'activity_type',
              },
              id: 'bar',
              type: 'bar_chart',
            },
          ],
        },
      ],
      version: 1,
    }) as DashboardConfig

  test('saves a bar chart with a valid muscle-group filter', async () => {
    const res = await app().put('/dashboard').send(withBars('set_count'))

    expect(res.status).toBe(200)
    expect(upsertUserSettings).toHaveBeenCalledOnce()
  })

  test('refuses a muscle-group filter the chart data route refuses, without saving', async () => {
    const res = await app().put('/dashboard').send(withBars('e1rm'))

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: MUSCLE_GROUP_FILTER_NEEDS_SUMMED_MEASURE, success: false })
    expect(upsertUserSettings).not.toHaveBeenCalled()
  })
})
