import type { GoalHistoryDay } from '@aurboda/api-spec'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { MergedActivity } from '../db/types.ts'

import * as db from '../db/index.ts'
import {
  dayKeysEndingAt,
  foldMonths,
  getGoalHistory,
  goalStatus,
  rollingMaxSeries,
  rollingSeries,
  summarize,
  utcDayKey,
  windowDays,
} from './goal-history.ts'
import * as measureSeries from './queries/activity-measure-series.ts'
import * as settings from './settings.ts'
import * as trends from './trends.ts'

vi.mock('../db', () => ({
  getDailyAggregates: vi.fn(),
  getDailyAggregateValues: vi.fn(),
  getHrZoneSecs: vi.fn(),
  getRawDailySums: vi.fn(),
}))

vi.mock('./settings', () => ({
  getEffectiveGoals: vi.fn(),
  getEffectiveHrZones: vi.fn(),
}))

vi.mock('./queries/activity-measure-series', async (importOriginal) => ({
  ...(await importOriginal<typeof measureSeries>()),
  queryMeasuredActivities: vi.fn(),
}))

vi.mock('./trends', () => ({
  getTrend: vi.fn(),
}))

vi.mock('./custom-metrics', () => ({
  getCustomMetrics: vi.fn(async () => [{ aggregation: 'sum', name: 'ibuprofen_mg', unit: 'mg' }]),
}))

const day = (date: string, status: GoalHistoryDay['status'], partial = false): GoalHistoryDay => ({
  date,
  partial,
  status,
  value: 0,
})

describe('windowDays', () => {
  test.each([
    ['1d', 1],
    ['7d', 7],
    ['2w', 14],
    ['1M', 30],
    ['24h', 1],
    ['36h', 2],
    ['30m', 1],
    ['90s', 1],
  ])('%s → %i days', (window, expected) => {
    expect(windowDays(window)).toBe(expected)
  })
})

describe('utcDayKey and dayKeysEndingAt', () => {
  test('keys are UTC days', () => {
    expect(utcDayKey(new Date('2026-02-02T23:30:00-02:00'))).toBe('2026-02-03')
  })

  test('consecutive keys ending with today, across a month edge', () => {
    expect(dayKeysEndingAt(new Date('2026-03-02T12:00:00Z'), 4)).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ])
  })
})

describe('goalStatus', () => {
  test('min only', () => {
    expect(goalStatus(9, 10)).toBe('below')
    expect(goalStatus(10, 10)).toBe('met')
    expect(goalStatus(11, 10)).toBe('met')
  })

  test('max only', () => {
    expect(goalStatus(0, undefined, 5)).toBe('met')
    expect(goalStatus(5, undefined, 5)).toBe('met')
    expect(goalStatus(5.1, undefined, 5)).toBe('over')
  })

  test('min and max', () => {
    expect(goalStatus(2, 3, 6)).toBe('below')
    expect(goalStatus(3, 3, 6)).toBe('met')
    expect(goalStatus(6, 3, 6)).toBe('met')
    expect(goalStatus(7, 3, 6)).toBe('over')
  })
})

describe('rollingSeries', () => {
  test('sums the window ending at each day, missing days are 0, today partial', () => {
    const daily = new Map([
      ['2026-01-29', 100],
      ['2026-01-30', 10],
      ['2026-02-01', 1],
      ['2026-02-02', 1000],
    ])
    const result = rollingSeries(daily, ['2026-01-31', '2026-02-01', '2026-02-02'], 3, '2026-02-02')
    expect(result).toEqual([
      { contribution: 0, date: '2026-01-31', partial: false, value: 110 },
      { contribution: 1, date: '2026-02-01', partial: false, value: 11 },
      { contribution: 1000, date: '2026-02-02', partial: true, value: 1001 },
    ])
  })

  test('a 1-day window is the day itself', () => {
    const daily = new Map([['2026-02-01', 5]])
    expect(rollingSeries(daily, ['2026-02-01'], 1, '2026-02-02')).toEqual([
      { contribution: 5, date: '2026-02-01', partial: false, value: 5 },
    ])
  })
})

describe('rollingMaxSeries', () => {
  test('the best day in the window ending at each day; contribution the day’s own best', () => {
    const daily = new Map([
      ['2026-01-29', 100],
      ['2026-01-30', 90],
      ['2026-02-02', 95],
    ])
    expect(rollingMaxSeries(daily, ['2026-01-31', '2026-02-01', '2026-02-02'], 3, '2026-02-02')).toEqual([
      { contribution: 0, date: '2026-01-31', partial: false, value: 100 },
      { contribution: 0, date: '2026-02-01', partial: false, value: 90 },
      { contribution: 95, date: '2026-02-02', partial: true, value: 95 },
    ])
  })

  test('no day in the window: 0', () => {
    expect(rollingMaxSeries(new Map(), ['2026-02-01'], 7, '2026-02-02')).toEqual([
      { contribution: 0, date: '2026-02-01', partial: false, value: 0 },
    ])
  })
})

describe('summarize', () => {
  test('counts completed days only', () => {
    expect(
      summarize([day('2026-02-01', 'met'), day('2026-02-02', 'over'), day('2026-02-03', 'below', true)]),
    ).toEqual({ days_below: 0, days_met: 1, days_over: 1, days_total: 2 })
  })
})

describe('foldMonths', () => {
  test('groups by month, current month partial, today not counted', () => {
    expect(
      foldMonths([
        day('2026-01-30', 'met'),
        day('2026-01-31', 'below'),
        day('2026-02-01', 'over'),
        day('2026-02-02', 'met'),
        day('2026-02-03', 'met', true),
      ]),
    ).toEqual([
      { days_below: 1, days_met: 1, days_over: 0, days_total: 2, month: '2026-01', partial: false },
      { days_below: 0, days_met: 1, days_over: 1, days_total: 2, month: '2026-02', partial: true },
    ])
  })

  test('a month holding only today appears with zero counts', () => {
    expect(foldMonths([day('2026-01-31', 'met'), day('2026-02-01', 'met', true)])).toEqual([
      { days_below: 0, days_met: 1, days_over: 0, days_total: 1, month: '2026-01', partial: false },
      { days_below: 0, days_met: 0, days_over: 0, days_total: 0, month: '2026-02', partial: true },
    ])
  })
})

describe('getGoalHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-02T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('unknown goal id → null', async () => {
    vi.mocked(settings.getEffectiveGoals).mockResolvedValue([])
    expect(await getGoalHistory('u', 'missing', { bucket: 'day', lookback_days: 30 })).toBeNull()
  })

  test('hr zone goal, day bucket: per-day zone seconds summed over the window', async () => {
    vi.mocked(settings.getEffectiveGoals).mockResolvedValue([
      { goal_type: 'metric', id: 'g1', metric: 'hr_zone_2_sec', min: 100, window: '2d' },
    ])
    vi.mocked(settings.getEffectiveHrZones).mockResolvedValue({
      source: 'default',
      zones: { 1: 90, 2: 108, 3: 126, 4: 144, 5: 162 },
    })
    const secs = (z2: number) => ({ 0: 0, 1: 0, 2: z2, 3: 0, 4: 0, 5: 0 })
    vi.mocked(db.getHrZoneSecs).mockResolvedValue([
      { bucket_start: new Date('2026-01-30T00:00:00Z'), sample_count: 1, secs: secs(60) },
      { bucket_start: new Date('2026-01-31T00:00:00Z'), sample_count: 1, secs: secs(50) },
      { bucket_start: new Date('2026-02-02T00:00:00Z'), sample_count: 1, secs: secs(200) },
    ])

    const result = await getGoalHistory('u', 'g1', { bucket: 'day', lookback_days: 2 })

    expect(db.getHrZoneSecs).toHaveBeenCalledWith(
      'u',
      new Date('2026-01-30T00:00:00Z'),
      new Date('2026-02-02T12:00:00Z'),
      { 1: 90, 2: 108, 3: 126, 4: 144, 5: 162 },
      '1d',
      'UTC',
    )
    expect(result).toEqual({
      bucket: 'day',
      days: [
        { contribution: 50, date: '2026-01-31', partial: false, status: 'met', value: 110 },
        { contribution: 0, date: '2026-02-01', partial: false, status: 'below', value: 50 },
        { contribution: 200, date: '2026-02-02', partial: true, status: 'met', value: 200 },
      ],
      goal: { goal_type: 'metric', id: 'g1', metric: 'hr_zone_2_sec', min: 100, window: '2d' },
      max: undefined,
      min: 100,
      success: true,
      summary: { days_below: 1, days_met: 1, days_over: 0, days_total: 2 },
      unit: 'sec',
    })
  })

  test('hr zone goal, month bucket: months instead of days', async () => {
    vi.mocked(settings.getEffectiveGoals).mockResolvedValue([
      { goal_type: 'metric', id: 'g1', max: 100, metric: 'hr_zone_5_sec', window: '1d' },
    ])
    vi.mocked(settings.getEffectiveHrZones).mockResolvedValue({
      source: 'default',
      zones: { 1: 90, 2: 108, 3: 126, 4: 144, 5: 162 },
    })
    vi.mocked(db.getHrZoneSecs).mockResolvedValue([
      {
        bucket_start: new Date('2026-01-31T00:00:00Z'),
        sample_count: 1,
        secs: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 500 },
      },
    ])

    const result = await getGoalHistory('u', 'g1', { bucket: 'month', lookback_days: 3 })

    expect(result?.days).toBeUndefined()
    expect(result?.months).toEqual([
      { days_below: 0, days_met: 1, days_over: 1, days_total: 2, month: '2026-01', partial: false },
      { days_below: 0, days_met: 1, days_over: 0, days_total: 1, month: '2026-02', partial: true },
    ])
    expect(result?.summary).toEqual({ days_below: 0, days_met: 2, days_over: 1, days_total: 3 })
  })

  test('steps goal uses the deduplicated daily aggregates', async () => {
    vi.mocked(settings.getEffectiveGoals).mockResolvedValue([
      { goal_type: 'metric', id: 'g1', metric: 'steps', min: 10000, window: '1d' },
    ])
    vi.mocked(db.getDailyAggregateValues).mockResolvedValue(
      new Map([
        ['2026-02-01', 12000],
        ['2026-02-02', 3000],
      ]),
    )

    const result = await getGoalHistory('u', 'g1', { bucket: 'day', lookback_days: 1 })

    expect(db.getDailyAggregateValues).toHaveBeenCalledWith(
      'u',
      'steps',
      new Date('2026-02-01T00:00:00Z'),
      new Date('2026-02-02T12:00:00Z'),
    )
    expect(db.getDailyAggregates).not.toHaveBeenCalled()
    expect(result?.days).toEqual([
      { contribution: 12000, date: '2026-02-01', partial: false, status: 'met', value: 12000 },
      { contribution: 3000, date: '2026-02-02', partial: true, status: 'below', value: 3000 },
    ])
    expect(result?.unit).toBe('count')
  })

  test('steps goal falls back to all-source per-day raw sums when no aggregates exist', async () => {
    vi.mocked(settings.getEffectiveGoals).mockResolvedValue([
      { goal_type: 'metric', id: 'g1', metric: 'steps', min: 10000, window: '1d' },
    ])
    vi.mocked(db.getDailyAggregateValues).mockResolvedValue(new Map())
    vi.mocked(db.getRawDailySums).mockResolvedValue([{ date: '2026-02-01', sum: 11000 }])

    const result = await getGoalHistory('u', 'g1', { bucket: 'day', lookback_days: 1 })

    expect(db.getRawDailySums).toHaveBeenCalledWith(
      'u',
      'steps',
      new Date('2026-02-01T00:00:00Z'),
      new Date('2026-02-02T12:00:00Z'),
    )
    expect(db.getDailyAggregates).not.toHaveBeenCalled()
    expect(result?.days?.map((d) => d.value)).toEqual([11000, 0])
  })

  test('non-cumulative metric sums daily aggregates', async () => {
    vi.mocked(settings.getEffectiveGoals).mockResolvedValue([
      { goal_type: 'metric', id: 'g1', metric: 'weight', min: 70, window: '1d' },
    ])
    vi.mocked(db.getDailyAggregates).mockResolvedValue([
      { avg: 72, date: '2026-02-02', metric: 'weight', sum: 72 },
    ])

    const result = await getGoalHistory('u', 'g1', { bucket: 'day', lookback_days: 1 })

    expect(db.getDailyAggregateValues).not.toHaveBeenCalled()
    expect(result?.days?.map((d) => d.value)).toEqual([0, 72])
  })

  test('trend goal maps the EMA history', async () => {
    const goal = {
      aggregation: 'count' as const,
      display_period: 'monthly' as const,
      goal_type: 'trend' as const,
      half_life_days: 30,
      id: 'g-trend',
      max: 0.7,
      pattern: 'coffee',
      source_type: 'activity_type' as const,
    }
    vi.mocked(settings.getEffectiveGoals).mockResolvedValue([goal])
    vi.mocked(trends.getTrend).mockResolvedValue({
      aggregation: 'count',
      current_value: 0.5,
      display_period: 'monthly',
      display_unit: 'per month',
      half_life_days: 30,
      history: [
        { date: '2026-02-01', value: 0.8 },
        { date: '2026-02-02', value: 0.5 },
      ],
      lookback_days: 1,
      pattern: 'coffee',
      source_type: 'activity_type',
    })

    const result = await getGoalHistory('u', 'g-trend', { bucket: 'day', lookback_days: 1 })

    expect(trends.getTrend).toHaveBeenCalledWith('u', {
      aggregation: 'count',
      custom_metrics: [{ aggregation: 'sum', name: 'ibuprofen_mg', unit: 'mg' }],
      display_period: 'monthly',
      half_life_days: 30,
      lookback_days: 1,
      pattern: 'coffee',
      source_type: 'activity_type',
    })
    expect(result).toEqual({
      bucket: 'day',
      days: [
        { date: '2026-02-01', partial: false, status: 'over', value: 0.8 },
        { date: '2026-02-02', partial: true, status: 'met', value: 0.5 },
      ],
      goal,
      max: 0.7,
      min: undefined,
      success: true,
      summary: { days_below: 0, days_met: 0, days_over: 1, days_total: 1 },
      unit: 'per month',
    })
  })

  describe('measure goals', () => {
    const session = (startIso: string, measures: Record<string, number>): measureSeries.MeasuredActivity => ({
      activity: {
        activity_type: 'strength_training',
        id: startIso,
        source: 'gravl',
        start_time: new Date(startIso),
      } as MergedActivity,
      id: startIso,
      measures,
    })

    beforeEach(() => {
      vi.mocked(measureSeries.queryMeasuredActivities).mockResolvedValue([
        session('2026-01-30T08:00:00Z', { e1rm: 100, volume: 3000 }),
        session('2026-01-30T18:00:00Z', { e1rm: 90, volume: 2000 }),
        session('2026-02-01T18:00:00Z', { volume: 1000 }),
        session('2026-02-02T08:00:00Z', { e1rm: 95, volume: 500 }),
      ])
    })

    test('max: the rolling best, fetched from the first day’s window start with the goal’s filter', async () => {
      const goal = {
        activity_type: 'strength_training',
        aggregation: 'max' as const,
        filter_field: 'sets.exercise',
        filter_value: 'Bench Press',
        goal_type: 'measure' as const,
        id: 'g-measure',
        measure: 'e1rm' as const,
        min: 96,
        window: '2d',
      }
      vi.mocked(settings.getEffectiveGoals).mockResolvedValue([goal])

      const result = await getGoalHistory('u', 'g-measure', { bucket: 'day', lookback_days: 3 })

      expect(measureSeries.queryMeasuredActivities).toHaveBeenCalledWith(
        'u',
        'strength_training',
        new Date('2026-01-29T00:00:00Z'),
        new Date('2026-02-02T12:00:00Z'),
        { field: 'sets.exercise', value: 'Bench Press' },
      )
      expect(result?.unit).toBe('kg')
      expect(result?.days).toEqual([
        { contribution: 100, date: '2026-01-30', partial: false, status: 'met', value: 100 },
        { contribution: 0, date: '2026-01-31', partial: false, status: 'met', value: 100 },
        { contribution: 0, date: '2026-02-01', partial: false, status: 'below', value: 0 },
        { contribution: 95, date: '2026-02-02', partial: true, status: 'below', value: 95 },
      ])
    })

    test('sum: the rolling total of the day sums', async () => {
      vi.mocked(settings.getEffectiveGoals).mockResolvedValue([
        {
          activity_type: 'strength_training',
          aggregation: 'sum',
          goal_type: 'measure',
          id: 'g-volume',
          measure: 'volume',
          min: 4000,
          window: '2d',
        },
      ])

      const result = await getGoalHistory('u', 'g-volume', { bucket: 'day', lookback_days: 2 })

      expect(vi.mocked(measureSeries.queryMeasuredActivities).mock.calls[0]?.[4]).toBeUndefined()
      expect(result?.days?.map((d) => [d.date, d.contribution, d.value, d.status])).toEqual([
        ['2026-01-31', 0, 5000, 'met'],
        ['2026-02-01', 1000, 1000, 'below'],
        ['2026-02-02', 500, 1500, 'below'],
      ])
    })
  })
})
