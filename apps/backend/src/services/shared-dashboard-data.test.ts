import type { DashboardConfig, DashboardWidget } from '@aurboda/api-spec'

import { percentChange } from '@aurboda/api-spec'
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
  getActivityTypeSummary: vi.fn(),
  getPeriodSummary: vi.fn(),
  queryActivities: vi.fn(),
  queryMetrics: vi.fn(),
}))

const { getChartData } = await import('./chart-data.ts')
const { getTrend } = await import('./trends.ts')
const { getActivityRecords } = await import('./activity-records.ts')
const { getActivityTypeSummary, getPeriodSummary, queryActivities } = await import('./queries/index.ts')
const { getBaseline } = await import('./correlations/baseline.ts')
const { getLatestSleep } = await import('./latest-sleep.ts')
const { getAllActivityTypeNames } = await import('../db/index.ts')
const { resolveDashboardData, resolvePeriodDashboard } = await import('./shared-dashboard-data.ts')

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

const october = { end: new Date('2026-10-31T23:00:00Z'), start: new Date('2026-09-30T22:00:00Z') }
const september = { end: new Date('2026-09-30T22:00:00Z'), start: new Date('2026-08-31T22:00:00Z') }
const lastMs = (d: Date) => new Date(d.getTime() - 1)

type PeriodSummary = Awaited<ReturnType<typeof getPeriodSummary>>

const summaryOf = (metric: string, avg: number): PeriodSummary =>
  ({
    metrics: [{ avg, change_from_previous_period_percent: 99, count: 5, max: avg + 1, metric }],
  }) as unknown as PeriodSummary

const metricCard = (metric: string): DashboardWidget => ({
  config: { metric, title: metric },
  id: 'card',
  type: 'metric_card',
})

describe('percentChange', () => {
  test('is the change in percent, one decimal', () => {
    expect(percentChange(110, 100)).toBe(10)
    expect(percentChange(2, 3)).toBe(-33.3)
  })

  test('is null without both figures or from zero', () => {
    expect(percentChange(null, 100)).toBeNull()
    expect(percentChange(5, null)).toBeNull()
    expect(percentChange(5, undefined)).toBeNull()
    expect(percentChange(5, 0)).toBeNull()
  })
})

describe('resolveDashboardData in a window', () => {
  beforeEach(() => {
    vi.mocked(getChartData).mockReset()
    vi.mocked(getTrend).mockReset()
    vi.mocked(getPeriodSummary).mockReset()
    vi.mocked(queryActivities).mockReset()
    vi.mocked(getBaseline).mockReset()
    vi.mocked(getLatestSleep).mockReset()
    vi.mocked(getAllActivityTypeNames).mockResolvedValue(['running', 'sleep'])
  })

  test('a metric card reports the window and its change from the previous window', async () => {
    vi.mocked(getPeriodSummary).mockImplementation(async (_user, metrics, start) =>
      summaryOf(metrics[0]!, start.getTime() === october.start.getTime() ? 110 : 100),
    )

    const data = await resolveDashboardData('alice', board(metricCard('steps')), {
      previous: september,
      window: october,
    })

    expect(data['card']).toEqual({
      data: { count: 5, max: 111, previous_value: 100, trend_percent: 10, value: 110 },
      type: 'metric_card',
    })
    expect(vi.mocked(getPeriodSummary).mock.calls).toEqual([
      ['alice', ['steps'], october.start, lastMs(october.end)],
      ['alice', ['steps'], september.start, lastMs(september.end)],
    ])
  })

  test('a baseline card becomes the window average of its metric', async () => {
    vi.mocked(getPeriodSummary).mockImplementation(async (_user, metrics) => summaryOf(metrics[0]!, 50))

    const data = await resolveDashboardData('alice', board(metricCard('rhr_7day')), { window: october })

    expect(getBaseline).not.toHaveBeenCalled()
    expect(vi.mocked(getPeriodSummary).mock.calls[0]?.[1]).toEqual(['resting_heart_rate'])
    expect(data['card']).toMatchObject({ data: { value: 50 } })
  })

  test('an activity summary counts both windows', async () => {
    const run = (start: string, minutes: number) => ({
      activity_type: 'running',
      end_time: new Date(new Date(start).getTime() + minutes * 60_000).toISOString(),
      start_time: start,
    })
    vi.mocked(queryActivities).mockImplementation(
      async (_user, _types, start) =>
        (start.getTime() === october.start.getTime()
          ? [run('2026-10-02T07:00:00Z', 30), run('2026-10-05T07:00:00Z', 60)]
          : [run('2026-09-02T07:00:00Z', 45)]) as unknown as Awaited<ReturnType<typeof queryActivities>>,
    )
    const summary: DashboardWidget = {
      config: { show_meditation: false, show_sleep: false },
      id: 'summary',
      type: 'activity_summary',
    }

    const data = await resolveDashboardData('alice', board(summary), { previous: september, window: october })

    expect(data['summary']).toEqual({
      data: {
        exercise: { count: 2, previous_count: 1, previous_total_minutes: 45, total_minutes: 90 },
        meditation: null,
        sleep: null,
      },
      type: 'activity_summary',
    })
    expect(vi.mocked(queryActivities).mock.calls[0]?.slice(2)).toEqual([october.start, lastMs(october.end)])
  })

  test('an activity type card rolls up both windows', async () => {
    const summaryFor = (count: number, sleepAvg: number) => ({
      activity_type_name: 'Sleep',
      avg_speed_kmh: null,
      best_pace_sec_per_km: null,
      count,
      distance_km: null,
      sleep: { avg_minutes: sleepAvg, avg_stages: null, best_night_minutes: sleepAvg + 30 },
      total_minutes: count * sleepAvg,
    })
    vi.mocked(getActivityTypeSummary).mockReset()
    vi.mocked(getActivityTypeSummary).mockImplementation(async (_user, _type, query) =>
      query.start === october.start.toISOString() ? summaryFor(31, 450) : summaryFor(30, 420),
    )
    const card: DashboardWidget = {
      config: { filter_field: 'location', filter_value: 'home', lookback_days: 7, pattern: 'sleep' },
      id: 'sleep',
      type: 'activity_type_card',
    }

    const data = await resolveDashboardData('alice', board(card), { previous: september, window: october })

    expect(data['sleep']).toEqual({
      data: {
        ...summaryFor(31, 450),
        previous_count: 30,
        previous_distance_km: null,
        previous_sleep_avg_minutes: 420,
        previous_total_minutes: 12600,
      },
      type: 'activity_type_card',
    })
    expect(vi.mocked(getActivityTypeSummary).mock.calls).toEqual([
      [
        'alice',
        'sleep',
        {
          end: lastMs(october.end).toISOString(),
          filter_field: 'location',
          filter_value: 'home',
          start: october.start.toISOString(),
        },
      ],
      [
        'alice',
        'sleep',
        {
          end: lastMs(september.end).toISOString(),
          filter_field: 'location',
          filter_value: 'home',
          start: september.start.toISOString(),
        },
      ],
    ])
  })

  test('charts and trends resolve over the window', async () => {
    vi.mocked(getChartData).mockResolvedValue({ buckets: [] } as Awaited<ReturnType<typeof getChartData>>)
    vi.mocked(getTrend).mockResolvedValue({ current_value: 1, history: [] } as unknown as Awaited<
      ReturnType<typeof getTrend>
    >)

    await resolveDashboardData('alice', board(combined), { window: october })

    expect(vi.mocked(getChartData).mock.calls[0]?.[1]).toMatchObject({
      end: lastMs(october.end).toISOString(),
      start: october.start.toISOString(),
    })
    expect(vi.mocked(getTrend).mock.calls[0]?.[1]).toMatchObject({
      end: lastMs(october.end),
      lookback_days: 30,
    })
  })

  test('last sleep and goal progress have no data in a window', async () => {
    const config: DashboardConfig = {
      sections: [
        {
          id: 's',
          title: 'x',
          type: 'metrics',
          widgets: [
            { config: {}, id: 'sleep', type: 'last_sleep' },
            { config: {}, id: 'goals', type: 'goal_progress' },
          ],
        },
      ],
      version: 1,
    }

    const data = await resolveDashboardData('alice', config, { window: october })

    expect(data).toEqual({
      goals: { data: null, type: 'goal_progress' },
      sleep: { data: null, type: 'last_sleep' },
    })
    expect(getLatestSleep).not.toHaveBeenCalled()
  })
})

describe('resolvePeriodDashboard', () => {
  const monthly: DashboardConfig = {
    period: { granularity: 'month' },
    sections: [{ id: 's', title: 'x', type: 'metrics', widgets: [metricCard('steps')] }],
    version: 1,
  }
  const now = new Date('2026-11-07T10:00:00Z')

  beforeEach(() => {
    vi.mocked(getPeriodSummary).mockReset()
    vi.mocked(getPeriodSummary).mockImplementation(async (_user, metrics) => summaryOf(metrics[0]!, 10))
  })

  test('defaults to the latest finished period in the owner timezone', async () => {
    const result = await resolvePeriodDashboard('alice', monthly, undefined, now)

    expect(result.period).toBe('2026-10')
    expect(result.window).toEqual({ end: '2026-10-31T23:00:00.000Z', start: '2026-09-30T22:00:00.000Z' })
    expect(result.widget_data['card']).toMatchObject({ data: { previous_value: 10, value: 10 } })
    expect(vi.mocked(getPeriodSummary).mock.calls[1]?.[2]).toEqual(september.start)
  })

  test('resolves an earlier finished period', async () => {
    const result = await resolvePeriodDashboard('alice', monthly, '2025-02', now)

    expect(result.period).toBe('2025-02')
  })

  test('rejects an unfinished, mismatched or impossible period with a 400', async () => {
    await expect(resolvePeriodDashboard('alice', monthly, '2026-11', now)).rejects.toMatchObject({
      code: 'not_finished',
      status: 400,
    })
    await expect(resolvePeriodDashboard('alice', monthly, '2026-W40', now)).rejects.toMatchObject({
      code: 'granularity_mismatch',
      status: 400,
    })
    await expect(resolvePeriodDashboard('alice', monthly, '2025-W53', now)).rejects.toMatchObject({
      code: 'invalid',
      status: 400,
    })
  })
})

describe('resolveDashboardData: activity_type_card', () => {
  test('rolls up the lookback on a rolling dashboard, without previous figures', async () => {
    const summary = {
      activity_type_name: 'Running',
      avg_speed_kmh: 10,
      best_pace_sec_per_km: 330,
      count: 4,
      distance_km: 32,
      sleep: null,
      total_minutes: 192,
    }
    vi.mocked(getActivityTypeSummary).mockReset()
    vi.mocked(getActivityTypeSummary).mockResolvedValue(summary)

    const data = await resolveDashboardData(
      'alice',
      board({ config: { pattern: 'running' }, id: 'run', type: 'activity_type_card' }),
    )

    expect(data['run']).toEqual({ data: summary, type: 'activity_type_card' })
    const query = vi.mocked(getActivityTypeSummary).mock.calls[0]?.[2]
    expect(query).not.toHaveProperty('filter_field')
    const span = new Date(query?.end ?? '').getTime() - new Date(query?.start ?? '').getTime()
    expect(Math.round(span / DAY_MS)).toBe(30)
  })
})
