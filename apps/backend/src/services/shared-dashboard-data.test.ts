import type { DashboardConfig, DashboardWidget } from '@aurboda/api-spec'

import { beforeEach, describe, expect, test, vi } from 'vitest'

import type * as ActivityRecords from './activity-records.ts'

vi.mock('../db/index.ts', () => ({ getAllActivityTypeNames: vi.fn() }))
vi.mock('./chart-data.ts', () => ({ getChartData: vi.fn() }))
vi.mock('./trends.ts', () => ({ getTrend: vi.fn() }))
vi.mock('./custom-metrics.ts', () => ({ getCustomMetrics: vi.fn().mockResolvedValue([]) }))
vi.mock('./settings.ts', () => ({
  getEffectiveHrZones: vi.fn(),
  getUserTimezone: vi.fn().mockResolvedValue('Europe/Stockholm'),
}))
vi.mock('./activity-records.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof ActivityRecords>()),
  getActivityRecords: vi.fn(),
}))
vi.mock('./correlations/activity-impact.ts', () => ({ getActivityImpact: vi.fn() }))
vi.mock('./correlations/baseline.ts', () => ({ getBaseline: vi.fn() }))
vi.mock('./goals.ts', () => ({ getGoalsProgress: vi.fn() }))
vi.mock('./latest-sleep.ts', () => ({ getLatestSleep: vi.fn() }))
vi.mock('./queries/index.ts', () => ({
  getPeriodSummary: vi.fn(),
  queryActivities: vi.fn(),
  queryMetrics: vi.fn(),
}))

const { getChartData } = await import('./chart-data.ts')
const { getTrend } = await import('./trends.ts')
const { getActivityRecords } = await import('./activity-records.ts')
const { resolveDashboardData } = await import('./shared-dashboard-data.ts')

const board = (widget: DashboardWidget): DashboardConfig => ({
  sections: [{ id: 's', title: 'x', type: 'charts', widgets: [widget] }],
  version: 1,
})

const filter = { filter_field: 'sets.exercise', filter_value: 'Bench Press' }

const combined: DashboardWidget = {
  config: {
    layers: [
      {
        aggregation: 'max',
        bucket_size: '1w',
        kind: 'bars',
        measure: 'e1rm',
        pattern: 'strength_training',
        source_type: 'activity_type',
        ...filter,
      },
      {
        color: '#f97316',
        half_life_days: 120,
        kind: 'trend',
        measure: 'e1rm',
        pattern: 'strength_training',
        source_type: 'activity_type',
        ...filter,
      },
    ],
    lookback_days: 90,
  },
  id: 'combined',
  type: 'combined_chart',
}

const DAY_MS = 86_400_000

describe('resolveDashboardData: combined_chart', () => {
  beforeEach(() => {
    vi.mocked(getChartData).mockReset()
    vi.mocked(getTrend).mockReset()
  })

  test('resolves each layer in order over the shared lookback', async () => {
    vi.mocked(getChartData).mockResolvedValue({
      buckets: [{ bucket_start: '2026-03-02T00:00:00.000Z', value: 99 }],
    } as Awaited<ReturnType<typeof getChartData>>)
    vi.mocked(getTrend).mockResolvedValue({
      current_value: 98,
      history: [{ date: '2026-03-01', value: 99 }],
    } as Awaited<ReturnType<typeof getTrend>>)

    const data = await resolveDashboardData('alice', board(combined))

    expect(data['combined']).toEqual({
      data: {
        layers: [
          { data: { buckets: [{ bucket_start: '2026-03-02T00:00:00.000Z', value: 99 }] }, kind: 'bars' },
          { data: { current_value: 98, history: [{ date: '2026-03-01', value: 99 }] }, kind: 'trend' },
        ],
      },
      type: 'combined_chart',
    })
    const chartQuery = vi.mocked(getChartData).mock.calls[0]?.[1]
    expect(chartQuery).toMatchObject({
      aggregation: 'max',
      bucket_size: '1w',
      measure: 'e1rm',
      pattern: 'strength_training',
      source_type: 'activity_type',
      tz: 'Europe/Stockholm',
      ...filter,
    })
    const span = new Date(chartQuery?.end ?? '').getTime() - new Date(chartQuery?.start ?? '').getTime()
    expect(Math.round(span / DAY_MS)).toBe(90)
    expect(vi.mocked(getTrend).mock.calls[0]?.[1]).toMatchObject({
      half_life_days: 120,
      lookback_days: 90,
      measure: 'e1rm',
      pattern: 'strength_training',
      source_type: 'activity_type',
      ...filter,
    })
  })

  test('a layer that fails resolves to null without failing the others', async () => {
    vi.mocked(getChartData).mockResolvedValue({
      buckets: [{ bucket_start: '2026-03-02T00:00:00.000Z', value: 99 }],
    } as Awaited<ReturnType<typeof getChartData>>)
    vi.mocked(getTrend).mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const data = await resolveDashboardData('alice', board(combined))

    expect(data['combined']).toEqual({
      data: {
        layers: [
          { data: { buckets: [{ bucket_start: '2026-03-02T00:00:00.000Z', value: 99 }] }, kind: 'bars' },
          { data: null, kind: 'trend' },
        ],
      },
      type: 'combined_chart',
    })
  })
})

describe('resolveDashboardData: record_card', () => {
  const record = (lookback_days?: number): DashboardWidget => ({
    config: {
      measure: 'max_weight',
      pattern: 'strength_training',
      source_type: 'activity_type',
      ...filter,
      ...(lookback_days ? { lookback_days } : {}),
    },
    id: 'record',
    type: 'record_card',
  })

  beforeEach(() => {
    vi.mocked(getActivityRecords).mockReset()
    vi.mocked(getActivityRecords).mockResolvedValue({
      activity_type: 'strength_training',
      records: [
        { measure: 'e1rm', session_id: 'a3', start_time: '2026-03-01T08:00:00.000Z', value: 99 },
        {
          measure: 'max_weight',
          session_id: 'a3',
          set: { reps: 3, weight: 90 },
          start_time: '2026-03-01T08:00:00.000Z',
          value: 90,
        },
      ],
    })
  })

  test('picks the configured measure and strips the session id, over all time by default', async () => {
    const data = await resolveDashboardData('alice', board(record()))

    expect(data['record']).toEqual({
      data: {
        record: {
          measure: 'max_weight',
          set: { reps: 3, weight: 90 },
          start_time: '2026-03-01T08:00:00.000Z',
          value: 90,
        },
      },
      type: 'record_card',
    })
    expect(getActivityRecords).toHaveBeenCalledWith('alice', 'strength_training', filter)
  })

  test('a lookback starts the records that many days ago', async () => {
    await resolveDashboardData('alice', board(record(30)))

    const query = vi.mocked(getActivityRecords).mock.calls[0]?.[2]
    expect(query).toMatchObject(filter)
    const ago = Date.now() - new Date(query?.start ?? '').getTime()
    expect(Math.round(ago / DAY_MS)).toBe(30)
  })

  test('no record of the measure gives a null record', async () => {
    vi.mocked(getActivityRecords).mockResolvedValue({ activity_type: 'strength_training', records: [] })

    const data = await resolveDashboardData('alice', board(record()))

    expect(data['record']).toEqual({ data: { record: null }, type: 'record_card' })
  })
})
