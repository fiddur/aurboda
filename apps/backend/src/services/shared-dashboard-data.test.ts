import type { DashboardConfig, DashboardWidget } from '@aurboda/api-spec'

import { barChartConfigSchema, percentChange, trendChartConfigSchema } from '@aurboda/api-spec'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type * as ActivityRecords from './activity-records.ts'

vi.mock('../db/index.ts', () => ({}))
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
  getPlacesSummary: vi.fn(),
  getTopApps: vi.fn(),
  getTopMedia: vi.fn(),
  queryMetrics: vi.fn(),
}))

const { getChartData } = await import('./chart-data.ts')
const { getTrend } = await import('./trends.ts')
const { getActivityRecords } = await import('./activity-records.ts')
const { getActivityTypeSummary, getPeriodSummary, getPlacesSummary, getTopApps, getTopMedia } =
  await import('./queries/index.ts')
const { getBaseline } = await import('./correlations/baseline.ts')
const { getLatestSleep } = await import('./latest-sleep.ts')
const { resolveDashboardData, resolvePeriodDashboard, sinceLookbackDays, sinceRange } =
  await import('./shared-dashboard-data.ts')

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

describe('sinceLookbackDays', () => {
  test('counts whole calendar days in the owner timezone, at least one', () => {
    const now = new Date('2026-11-11T12:00:00Z')
    expect(sinceLookbackDays('2026-11-01', 'Europe/Stockholm', now)).toBe(10)
    expect(sinceLookbackDays('2026-11-11', 'Europe/Stockholm', now)).toBe(1)
    expect(sinceLookbackDays('2026-10-20', 'Europe/Stockholm', now)).toBe(22)
  })

  test('takes today from the timezone, not UTC', () => {
    const lateEvening = new Date('2026-11-11T23:30:00Z')
    expect(sinceLookbackDays('2026-11-01', 'UTC', lateEvening)).toBe(10)
    expect(sinceLookbackDays('2026-11-01', 'Europe/Stockholm', lateEvening)).toBe(11)
  })

  test('a since date later than today counts as today', () => {
    const now = new Date('2026-11-11T12:00:00Z')
    expect(sinceLookbackDays('2027-06-01', 'Europe/Stockholm', now)).toBe(1)
  })
})

describe('sinceRange', () => {
  const now = new Date('2026-11-11T12:00:00Z')

  test("runs from the date's midnight in the timezone to now", () => {
    expect(sinceRange('2026-03-01', 'Europe/Stockholm', now)).toEqual({
      end: now,
      start: new Date('2026-02-28T23:00:00.000Z'),
    })
  })

  test("a since date later than today starts at today's midnight, never after the end", () => {
    expect(sinceRange('2027-06-01', 'Europe/Stockholm', now)).toEqual({
      end: now,
      start: new Date('2026-11-10T23:00:00.000Z'),
    })
  })
})

describe('chart widget since', () => {
  const trend = { pattern: 'coffee', source_type: 'activity_type' } as const
  const bars = { ...trend, bucket_size: '1w', lookback_days: 30 } as const

  test('accepts a date from 1970-01-01 on', () => {
    expect(trendChartConfigSchema.safeParse({ ...trend, since: '1970-01-01' }).success).toBe(true)
    expect(barChartConfigSchema.safeParse({ ...bars, since: '2026-03-01' }).success).toBe(true)
  })

  test('refuses an earlier date with a clear message', () => {
    for (const since of ['1969-12-31', '0099-01-01', '0000-01-01']) {
      const trendResult = trendChartConfigSchema.safeParse({ ...trend, since })
      expect(trendResult.success).toBe(false)
      expect(trendResult.error?.issues[0]?.message).toBe('since must be 1970-01-01 or later')
      expect(barChartConfigSchema.safeParse({ ...bars, since }).success).toBe(false)
    }
  })
})

describe('resolveDashboardData: a chart with a since date', () => {
  beforeEach(() => {
    vi.mocked(getChartData).mockReset()
    vi.mocked(getChartData).mockResolvedValue({ buckets: [] } as unknown as Awaited<
      ReturnType<typeof getChartData>
    >)
    vi.mocked(getTrend).mockReset()
    vi.mocked(getTrend).mockResolvedValue({ current_value: 1, history: [] } as unknown as Awaited<
      ReturnType<typeof getTrend>
    >)
  })

  test("bars start at the date's midnight in the owner timezone, whatever lookback_days says", async () => {
    await resolveDashboardData(
      'alice',
      board({
        config: {
          bucket_size: '1w',
          lookback_days: 30,
          pattern: 'coffee',
          since: '2026-03-01',
          source_type: 'activity_type',
        },
        id: 'bars',
        type: 'bar_chart',
      }),
    )

    const query = vi.mocked(getChartData).mock.calls[0]?.[1]
    expect(query?.start).toBe('2026-02-28T23:00:00.000Z')
    expect(Math.abs(new Date(query?.end ?? '').getTime() - Date.now())).toBeLessThan(60_000)
  })

  test('a trend looks back the days from the date to today', async () => {
    await resolveDashboardData(
      'alice',
      board({
        config: { lookback_days: 30, pattern: 'coffee', since: '2026-03-01', source_type: 'activity_type' },
        id: 'trend',
        type: 'trend_chart',
      }),
    )

    expect(vi.mocked(getTrend).mock.calls[0]?.[1]).toMatchObject({
      lookback_days: sinceLookbackDays('2026-03-01', 'Europe/Stockholm'),
    })
  })

  test('without a since date the lookback is unchanged', async () => {
    await resolveDashboardData(
      'alice',
      board({
        config: { lookback_days: 30, pattern: 'coffee', source_type: 'activity_type' },
        id: 'trend',
        type: 'trend_chart',
      }),
    )

    expect(vi.mocked(getTrend).mock.calls[0]?.[1]).toMatchObject({ lookback_days: 30 })
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
    vi.mocked(getActivityTypeSummary).mockReset()
    vi.mocked(getBaseline).mockReset()
    vi.mocked(getLatestSleep).mockReset()
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

  const rollUp = (count: number, total_minutes: number, sleepAvg?: number) => ({
    activity_type_name: 'x',
    avg_speed_kmh: null,
    best_pace_sec_per_km: null,
    count,
    distance_km: null,
    sleep: sleepAvg === undefined ? null : { avg_minutes: sleepAvg, avg_stages: null, best_night_minutes: 0 },
    total_minutes,
  })

  test('an activity summary rolls up the workout type tree over both windows', async () => {
    vi.mocked(getActivityTypeSummary).mockImplementation(async (_user, _type, query) =>
      query.start === october.start.toISOString() ? rollUp(2, 90) : rollUp(1, 45),
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
    expect(vi.mocked(getActivityTypeSummary).mock.calls).toEqual([
      ['alice', 'exercise', { end: lastMs(october.end).toISOString(), start: october.start.toISOString() }],
      [
        'alice',
        'exercise',
        { end: lastMs(september.end).toISOString(), start: september.start.toISOString() },
      ],
    ])
  })

  test('an activity summary counts sleep and meditation in both windows', async () => {
    vi.mocked(getActivityTypeSummary).mockImplementation(async (_user, type, query) => {
      const current = query.start === october.start.toISOString()
      if (type === 'sleep') return current ? rollUp(2, 900, 450) : rollUp(1, 360, 360)
      if (type === 'meditation') return current ? rollUp(1, 20) : rollUp(0, 0)
      return rollUp(0, 0)
    })
    const summary: DashboardWidget = { config: {}, id: 'summary', type: 'activity_summary' }

    const data = await resolveDashboardData('alice', board(summary), { previous: september, window: october })

    expect(data['summary']).toEqual({
      data: {
        exercise: { count: 0, previous_count: 0, previous_total_minutes: 0, total_minutes: 0 },
        meditation: { count: 1, previous_count: 0, previous_total_minutes: 0, total_minutes: 20 },
        sleep: { avg_hours: 7.5, count: 2, previous_avg_hours: 6, previous_count: 1 },
      },
      type: 'activity_summary',
    })
  })

  test('an activity summary agrees with the activity type card over the same window (#1560)', async () => {
    vi.mocked(getActivityTypeSummary).mockImplementation(async (_user, type) =>
      type === 'meditation' ? rollUp(83, 1071) : rollUp(0, 0),
    )
    const config: DashboardConfig = {
      sections: [
        {
          id: 's',
          title: 'x',
          type: 'metrics',
          widgets: [
            { config: { show_sleep: false, show_workouts: false }, id: 'summary', type: 'activity_summary' },
            { config: { pattern: 'meditation' }, id: 'card', type: 'activity_type_card' },
          ],
        },
      ],
      version: 1,
    }

    const data = await resolveDashboardData('alice', config, { window: october })

    const meditationCalls = vi
      .mocked(getActivityTypeSummary)
      .mock.calls.filter(([, type]) => type === 'meditation')
    expect(meditationCalls).toHaveLength(2)
    expect(meditationCalls[0]).toEqual(meditationCalls[1])
    expect(data['summary']).toMatchObject({ data: { meditation: { count: 83, total_minutes: 1071 } } })
    expect(data['card']).toMatchObject({ data: { count: 83, total_minutes: 1071 } })
  })

  test('an activity summary queries only the visible parts', async () => {
    vi.mocked(getActivityTypeSummary).mockResolvedValue(rollUp(0, 0))
    const summary: DashboardWidget = {
      config: { show_meditation: true, show_sleep: false, show_workouts: false },
      id: 'summary',
      type: 'activity_summary',
    }

    await resolveDashboardData('alice', board(summary), { window: october })

    expect(vi.mocked(getActivityTypeSummary).mock.calls.map(([, type]) => type)).toEqual(['meditation'])
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

describe('resolveDashboardData: top_list_card and places_card', () => {
  test('a music top list reports both windows', async () => {
    vi.mocked(getTopMedia).mockReset()
    vi.mocked(getTopMedia).mockImplementation(async (_user, range) =>
      range.start.getTime() === october.start.getTime()
        ? { distinct: 506, items: [{ name: 'Bach', plays: 120 }], total_plays: 1760 }
        : { distinct: 400, items: [], total_plays: 1500 },
    )
    const card: DashboardWidget = {
      config: { limit: 3, source: 'media_album' },
      id: 'music',
      type: 'top_list_card',
    }

    const data = await resolveDashboardData('alice', board(card), { previous: september, window: october })

    expect(data['music']).toEqual({
      data: {
        distinct: 506,
        items: [{ count: 120, name: 'Bach' }],
        per_day: null,
        previous_total: 1500,
        total: 1760,
        unit: 'plays',
      },
      type: 'top_list_card',
    })
    expect(vi.mocked(getTopMedia).mock.calls).toEqual([
      ['alice', { end: lastMs(october.end), start: october.start }, 'album', 3, undefined],
      ['alice', { end: lastMs(september.end), start: september.start }, 'album', 3, undefined],
    ])
  })

  test('a music top list passes its media source on for both windows', async () => {
    vi.mocked(getTopMedia).mockReset()
    vi.mocked(getTopMedia).mockResolvedValue({ distinct: 0, items: [], total_plays: 0 })
    const card: DashboardWidget = {
      config: { limit: 5, media_source: 'lastfm', source: 'media_track' },
      id: 'scrobbles',
      type: 'top_list_card',
    }

    await resolveDashboardData('alice', board(card), { previous: september, window: october })

    expect(vi.mocked(getTopMedia).mock.calls).toEqual([
      ['alice', { end: lastMs(october.end), start: october.start }, 'track', 5, 'lastfm'],
      ['alice', { end: lastMs(september.end), start: september.start }, 'track', 5, 'lastfm'],
    ])
  })

  test('a screen-time top list reports hours per day over the 31-day window', async () => {
    vi.mocked(getTopApps).mockReset()
    vi.mocked(getTopApps).mockImplementation(async (_user, range) =>
      range.start.getTime() === october.start.getTime()
        ? { distinct_apps: 42, items: [{ hours: 60.5, name: 'Firefox' }], total_hours: 151 }
        : { distinct_apps: 40, items: [], total_hours: 120 },
    )
    const card: DashboardWidget = {
      config: { limit: 3, source: 'screentime_app' },
      id: 'apps',
      type: 'top_list_card',
    }

    const data = await resolveDashboardData('alice', board(card), { previous: september, window: october })

    expect(data['apps']).toEqual({
      data: {
        distinct: 42,
        items: [{ count: 60.5, name: 'Firefox' }],
        per_day: 4.9,
        previous_total: 120,
        total: 151,
        unit: 'hours',
      },
      type: 'top_list_card',
    })
  })

  test('a places top list counts visits over the lookback, without previous figures', async () => {
    vi.mocked(getPlacesSummary).mockReset()
    vi.mocked(getPlacesSummary).mockResolvedValue({
      distinct_places: 12,
      nights_away: 2,
      nights_by_place: [
        { name: 'Home', nights: 28 },
        { name: 'Cabin', nights: 2 },
      ],
      nights_elsewhere: 0,
      nights_home: 28,
      nights_no_data: 0,
      places: [
        { hours: 600, name: 'Home', nights: 28, visits: 30 },
        { hours: 80, name: 'Office', nights: 0, visits: 10 },
      ],
      visits: 55,
    })
    const card: DashboardWidget = {
      config: { limit: 1, source: 'place' },
      id: 'places',
      type: 'top_list_card',
    }

    const data = await resolveDashboardData('alice', board(card))

    expect(data['places']).toEqual({
      data: { distinct: 12, items: [{ count: 30, name: 'Home' }], per_day: null, total: 55, unit: 'visits' },
      type: 'top_list_card',
    })
    const params = vi.mocked(getPlacesSummary).mock.calls[0]?.[1]
    expect(params?.tz).toBe('Europe/Stockholm')
    const span = (params?.end.getTime() ?? 0) - (params?.start.getTime() ?? 0)
    expect(Math.round(span / DAY_MS)).toBe(30)
  })

  test('a places card reports both windows with its home', async () => {
    const summaryFor = (nights_away: number, distinct_places: number, visits: number) => ({
      distinct_places,
      nights_away,
      nights_by_place: [
        { name: 'Home', nights: 31 - nights_away },
        { name: 'Cabin', nights: nights_away - 1 },
      ],
      nights_elsewhere: 1,
      nights_home: 31 - nights_away,
      nights_no_data: 0,
      places: [{ hours: 600, name: 'Home', nights: 31 - nights_away, visits: 30 }],
      visits,
    })
    vi.mocked(getPlacesSummary).mockReset()
    vi.mocked(getPlacesSummary).mockImplementation(async (_user, params) =>
      params.start.getTime() === october.start.getTime() ? summaryFor(3, 12, 55) : summaryFor(5, 9, 40),
    )
    const card: DashboardWidget = {
      config: { home_location: 'Flat', title: 'Places' },
      id: 'where',
      type: 'places_card',
    }

    const data = await resolveDashboardData('alice', board(card), { previous: september, window: october })

    expect(data['where']).toEqual({
      data: {
        ...summaryFor(3, 12, 55),
        previous_distinct_places: 9,
        previous_nights_away: 5,
        previous_nights_by_place: summaryFor(5, 9, 40).nights_by_place,
        previous_nights_elsewhere: 1,
        previous_visits: 40,
      },
      type: 'places_card',
    })
    expect(vi.mocked(getPlacesSummary).mock.calls[0]).toEqual([
      'alice',
      { end: lastMs(october.end), homeName: 'Flat', start: october.start, tz: 'Europe/Stockholm' },
    ])
  })
})
