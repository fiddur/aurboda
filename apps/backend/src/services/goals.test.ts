import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../db/index.ts'
import { getGoalsProgress, getWidgetGoalsProgress } from './goals.ts'
import * as settings from './settings.ts'
import * as trends from './trends.ts'

vi.mock('../db', () => ({
  getDailyAggregates: vi.fn(),
  getDailyAggregateValues: vi.fn(),
  getGoals: vi.fn(),
  getHrZoneSecs: vi.fn(),
  getRawDailySum: vi.fn(),
}))

vi.mock('./settings', () => ({
  getEffectiveGoals: vi.fn(),
  getEffectiveHrZones: vi.fn(),
}))

vi.mock('./trends', () => ({
  getTrend: vi.fn(),
}))

/** Stands in for the DB: the per-day values of `perDay` whose UTC day falls in `[start's day, end's day]`. */
const fakeDailyValues =
  (perDay: Record<string, number>) =>
  async (_user: string, _metric: string, start: Date, end: Date): Promise<Map<string, number>> => {
    const from = start.toISOString().slice(0, 10)
    const to = end.toISOString().slice(0, 10)
    return new Map(Object.entries(perDay).filter(([day]) => day >= from && day <= to))
  }

describe('getGoalsProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-02T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('returns empty array when no goals', async () => {
    vi.mocked(settings.getEffectiveGoals).mockResolvedValue([])

    const result = await getGoalsProgress('testuser')

    expect(result).toEqual([])
  })

  test('uses getDailyAggregateValues for cumulative metrics like steps', async () => {
    vi.mocked(settings.getEffectiveGoals).mockResolvedValue([
      { goal_type: 'metric', id: 'goal-1', metric: 'steps', min: 10000, window: '1d' },
    ])

    // For a 1d window with day-based duration, we only include today (1 calendar day);
    // losingTomorrow queries today separately (same day for 1d window)
    vi.mocked(db.getDailyAggregateValues).mockImplementation(
      fakeDailyValues({ '2026-02-01': 9999, '2026-02-02': 4672 }),
    )

    const result = await getGoalsProgress('testuser')

    expect(result).toHaveLength(1)
    expect(result[0].current).toBe(4672) // only today
    expect((result[0] as { losing_tomorrow: number }).losing_tomorrow).toBe(4672)
    expect((result[0] as { metric: string }).metric).toBe('steps')

    // One range query per sum, not one per day, and not getDailyAggregates
    expect(db.getDailyAggregateValues).toHaveBeenCalledTimes(2)
    expect(db.getDailyAggregates).not.toHaveBeenCalled()
  })

  test('falls back to getRawDailySum when no aggregate value exists for cumulative metric', async () => {
    vi.mocked(settings.getEffectiveGoals).mockResolvedValue([
      { goal_type: 'metric', id: 'goal-1', metric: 'steps', min: 10000, window: '1d' },
    ])

    // No aggregate value exists
    vi.mocked(db.getDailyAggregateValues).mockResolvedValue(new Map())
    // getRawDailySum queries ALL sources as fallback
    vi.mocked(db.getRawDailySum)
      .mockResolvedValueOnce(4672) // current window
      .mockResolvedValueOnce(4672) // losingTomorrow window

    const result = await getGoalsProgress('testuser')

    expect(result).toHaveLength(1)
    expect(result[0].current).toBe(4672)
    // Should use getRawDailySum as fallback, not getDailyAggregates
    expect(db.getRawDailySum).toHaveBeenCalled()
    expect(db.getDailyAggregates).not.toHaveBeenCalled()
  })

  test('sums aggregate values across multiple days for 7d window', async () => {
    vi.mocked(settings.getEffectiveGoals).mockResolvedValue([
      { goal_type: 'metric', id: 'goal-1', metric: 'steps', min: 70000, window: '7d' },
    ])

    // For a 7d window with day-based duration, we include exactly 7 calendar days
    // (today + 6 previous days)
    // At 2026-02-02T12:00:00Z, this is Jan 27 through Feb 2; Jan 26 is outside the window
    // and Jan 29 has no value
    vi.mocked(db.getDailyAggregateValues).mockImplementation(
      fakeDailyValues({
        '2026-01-26': 99999,
        '2026-01-27': 10000,
        '2026-01-28': 12000,
        '2026-01-30': 20000,
        '2026-01-31': 13000,
        '2026-02-01': 8000,
        '2026-02-02': 5000,
      }),
    )

    const result = await getGoalsProgress('testuser')

    expect(result).toHaveLength(1)
    // Sum of the days present in the window = 68000
    expect(result[0].current).toBe(68000)
    expect((result[0] as { losing_tomorrow: number }).losing_tomorrow).toBe(10000)
  })

  test('uses rolling time for hour-based windows (24h spans 2 calendar days at noon)', async () => {
    vi.mocked(settings.getEffectiveGoals).mockResolvedValue([
      { goal_type: 'metric', id: 'goal-1', metric: 'steps', min: 10000, window: '24h' },
    ])

    // For a 24h window at noon, we use rolling hours (not calendar days)
    // At 2026-02-02T12:00:00Z, this is yesterday 12:00 through now
    // This spans 2 calendar days: Feb 1 (partial) and Feb 2 (partial)
    vi.mocked(db.getDailyAggregateValues).mockImplementation(
      fakeDailyValues({ '2026-01-31': 99999, '2026-02-01': 5000, '2026-02-02': 4672 }),
    )

    const result = await getGoalsProgress('testuser')

    expect(result).toHaveLength(1)
    // 24h rolling window spans 2 days
    expect(result[0].current).toBe(9672) // 5000 + 4672
    expect((result[0] as { losing_tomorrow: number }).losing_tomorrow).toBe(5000)
  })

  test('uses getHrZoneSecs for HR zone metrics', async () => {
    vi.mocked(settings.getEffectiveGoals).mockResolvedValue([
      { goal_type: 'metric', id: 'goal-1', metric: 'hr_zone_2_sec', min: 9000, window: '7d' },
    ])
    vi.mocked(settings.getEffectiveHrZones).mockResolvedValue({
      source: 'default',
      zones: { 1: 90, 2: 108, 3: 126, 4: 144, 5: 162 },
    })
    vi.mocked(db.getHrZoneSecs)
      .mockResolvedValueOnce([
        { bucket_start: null, sample_count: 10, secs: { 0: 0, 1: 0, 2: 9000, 3: 0, 4: 0, 5: 0 } },
      ])
      .mockResolvedValueOnce([])

    const result = await getGoalsProgress('testuser')

    expect(result).toHaveLength(1)
    expect(result[0].current).toBe(9000)
    // No samples on the oldest day → no row → 0
    expect((result[0] as { losing_tomorrow: number }).losing_tomorrow).toBe(0)
    expect(db.getHrZoneSecs).toHaveBeenCalledWith('testuser', expect.any(Date), expect.any(Date), {
      1: 90,
      2: 108,
      3: 126,
      4: 144,
      5: 162,
    })
  })

  test('returns goals in configured order', async () => {
    vi.mocked(settings.getEffectiveGoals).mockResolvedValue([
      {
        aggregation: 'count',
        display_period: 'monthly',
        goal_type: 'trend',
        half_life_days: 30,
        id: 'slow-trend',
        pattern: 'x',
        source_type: 'activity_type',
      },
      { goal_type: 'metric', id: 'fast-metric', metric: 'steps', min: 1, window: '1d' },
    ])
    vi.mocked(trends.getTrend).mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                aggregation: 'count',
                current_value: 1,
                display_period: 'monthly',
                display_unit: 'per month',
                half_life_days: 30,
                history: [],
                lookback_days: 90,
                pattern: 'x',
                source_type: 'activity_type',
              }),
            50,
          ),
        ),
    )
    vi.mocked(db.getDailyAggregateValues).mockImplementation(fakeDailyValues({ '2026-02-02': 1 }))

    const pending = getGoalsProgress('testuser')
    await vi.advanceTimersByTimeAsync(50)
    const result = await pending

    expect(result.map((g) => g.id)).toEqual(['slow-trend', 'fast-metric'])
  })

  test('computes trend goal progress using getTrend', async () => {
    vi.mocked(settings.getEffectiveGoals).mockResolvedValue([
      {
        aggregation: 'count',
        display_period: 'monthly',
        goal_type: 'trend',
        half_life_days: 30,
        id: 'goal-trend-1',
        max: 0.7,
        pattern: 'ejaculation',
        source_type: 'activity_type',
      },
    ])

    vi.mocked(trends.getTrend).mockResolvedValue({
      aggregation: 'count',
      current_value: 0.85,
      display_period: 'monthly',
      display_unit: 'per month',
      half_life_days: 30,
      history: [],
      lookback_days: 90,
      pattern: 'ejaculation',
      source_type: 'activity_type',
    })

    const result = await getGoalsProgress('testuser')

    expect(result).toHaveLength(1)
    expect(result[0].goal_type).toBe('trend')
    expect(result[0].current).toBe(0.85)
    expect(result[0].max).toBe(0.7)
    expect((result[0] as { pattern: string }).pattern).toBe('ejaculation')
    expect((result[0] as { display_unit: string }).display_unit).toBe('per month')

    expect(trends.getTrend).toHaveBeenCalledWith('testuser', {
      aggregation: 'count',
      display_period: 'monthly',
      half_life_days: 30,
      lookback_days: 90,
      pattern: 'ejaculation',
      source_type: 'activity_type',
    })

    // Should not touch the db directly for trend goals
    expect(db.getDailyAggregateValues).not.toHaveBeenCalled()
    expect(db.getDailyAggregates).not.toHaveBeenCalled()
  })

  test('uses getDailyAggregates for non-cumulative metrics', async () => {
    vi.mocked(settings.getEffectiveGoals).mockResolvedValue([
      { goal_type: 'metric', id: 'goal-1', metric: 'weight', min: 70, window: '1d' },
    ])
    vi.mocked(db.getDailyAggregates).mockResolvedValue([
      { avg: 72.5, date: '2026-02-02', metric: 'weight', sum: 72.5 },
    ])

    const result = await getGoalsProgress('testuser')

    expect(result).toHaveLength(1)
    // Non-cumulative metrics still use getDailyAggregates
    expect(db.getDailyAggregates).toHaveBeenCalled()
    expect(db.getDailyAggregateValues).not.toHaveBeenCalled()
  })
})

describe('getWidgetGoalsProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-02T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('returns flat widget format for metric goals', async () => {
    vi.mocked(settings.getEffectiveGoals).mockResolvedValue([
      { goal_type: 'metric', id: 'goal-1', metric: 'steps', min: 70000, window: '7d' },
    ])
    vi.mocked(db.getDailyAggregateValues).mockImplementation(
      fakeDailyValues({
        '2026-01-27': 10000,
        '2026-01-28': 10000,
        '2026-01-29': 10000,
        '2026-01-30': 10000,
        '2026-01-31': 10000,
        '2026-02-01': 10000,
        '2026-02-02': 10000,
      }),
    )

    const result = await getWidgetGoalsProgress('testuser')

    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('steps')
    expect(result[0].unit).toBe('count')
    expect(result[0].min).toBe(70000)
    expect(result[0].losing_tomorrow).toBeGreaterThanOrEqual(0)
  })

  test('returns flat widget format for trend goals', async () => {
    vi.mocked(settings.getEffectiveGoals).mockResolvedValue([
      {
        aggregation: 'count' as const,
        display_period: 'monthly' as const,
        goal_type: 'trend' as const,
        half_life_days: 30,
        id: 'goal-trend-1',
        max: 0.7,
        pattern: 'ejaculation',
        source_type: 'activity_type' as const,
      },
    ])
    vi.mocked(trends.getTrend).mockResolvedValue({
      aggregation: 'count',
      current_value: 0.5,
      display_period: 'monthly',
      display_unit: 'per month',
      half_life_days: 30,
      history: [],
      lookback_days: 90,
      pattern: 'ejaculation',
      source_type: 'activity_type',
    })

    const result = await getWidgetGoalsProgress('testuser')

    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('ejaculation')
    expect(result[0].current).toBe(0.5)
    expect(result[0].max).toBe(0.7)
    expect(result[0].unit).toBe('per month')
    expect(result[0].losing_tomorrow).toBe(0)
  })
})
