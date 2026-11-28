import { type DashboardConfig, JOURNAL_AGGREGATION_ERROR, JOURNAL_MEASURE_ERROR } from '@aurboda/api-spec'
import express, { type RequestHandler } from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../db/index.ts', () => ({
  createSharedDashboard: vi.fn(),
  deleteSharedDashboard: vi.fn(),
  getSharedDashboardById: vi.fn(),
  listSharedDashboards: vi.fn(),
  updateSharedDashboard: vi.fn(),
}))
vi.mock('../services/settings.ts', () => ({ getSettings: vi.fn(), getUserTimezone: vi.fn() }))
vi.mock('../services/shared-dashboard-data.ts', () => ({ resolveDashboardView: vi.fn() }))

const { createSharedDashboard, getSharedDashboardById, updateSharedDashboard } =
  await import('../db/index.ts')
const { createSharedDashboardsRouter } = await import('./shared-dashboards-router.ts')

const asAlice: RequestHandler = (req, _res, next) => {
  req.user = 'alice'
  next()
}

const app = () => {
  const a = express()
  a.use(express.json())
  a.use(
    '/shared-dashboards',
    createSharedDashboardsRouter(asAlice, 'https://aurboda.test') as unknown as express.RequestHandler,
  )
  return supertest(a)
}

const journalBars = (config: Record<string, unknown>): DashboardConfig =>
  ({
    sections: [
      {
        id: 's',
        title: 'Journal',
        type: 'charts',
        widgets: [
          {
            config: { bucket_size: '1w', lookback_days: 90, source_type: 'journal', ...config },
            id: 'bar',
            type: 'bar_chart',
          },
        ],
      },
    ],
    version: 1,
  }) as DashboardConfig

const ID = '00000000-0000-4000-8000-000000000001'

describe('a journal chart saved on a shared dashboard', () => {
  beforeEach(() => vi.clearAllMocks())

  test('POST refuses a journal chart the chart data route refuses, without creating', async () => {
    const res = await app()
      .post('/shared-dashboards')
      .send({ config: journalBars({ aggregation: 'mean' }), name: 'Journal' })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: JOURNAL_AGGREGATION_ERROR, success: false })
    expect(createSharedDashboard).not.toHaveBeenCalled()
  })

  test('PUT refuses a journal chart the chart data route refuses, without updating', async () => {
    vi.mocked(getSharedDashboardById).mockResolvedValue({ id: ID } as Awaited<
      ReturnType<typeof getSharedDashboardById>
    >)

    const res = await app()
      .put(`/shared-dashboards/${ID}`)
      .send({ config: journalBars({ measure: 'volume' }) })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: JOURNAL_MEASURE_ERROR, success: false })
    expect(updateSharedDashboard).not.toHaveBeenCalled()
  })
})
