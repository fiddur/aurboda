import type { DashboardConfig } from '@aurboda/api-spec'

import express, { type RequestHandler } from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type * as Periods from '../services/periods.ts'

vi.mock('../db/index.ts', () => ({ upsertUserSettings: vi.fn() }))
vi.mock('../services/settings.ts', () => ({ getSettings: vi.fn() }))
vi.mock('../services/shared-dashboard-data.ts', () => ({ resolveDashboardView: vi.fn() }))

const { getSettings } = await import('../services/settings.ts')
const { resolveDashboardView } = await import('../services/shared-dashboard-data.ts')
const { PeriodError } = await vi.importActual<typeof Periods>('../services/periods.ts')
const { createDashboardRouter } = await import('./dashboard-router.ts')

const asAlice: RequestHandler = (req, _res, next) => {
  req.user = 'alice'
  next()
}

const app = () => {
  const a = express()
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
