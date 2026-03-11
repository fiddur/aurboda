import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as db from '../db'
import { getGoalsProgress } from './goals'
import * as settings from './settings'

// Mock the db module
vi.mock('../db', () => ({
  getDailyAggregateValue: vi.fn(),
  getDailyAggregates: vi.fn(),
  getRawDailySum: vi.fn(),
  getTimeSeries: vi.fn(),
}))

// Mock the settings module
vi.mock('./settings', () => ({
  computeHrZoneSecs: vi.fn(),
  getEffectiveGoals: vi.fn(),
  getEffectiveHrZones: vi.fn(),
  getSettings: vi.fn(),
}))

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
    vi.mocked(settings.getSettings).mockResolvedValue({})
    vi.mocked(settings.getEffectiveGoals).mockReturnValue([])

    const result = await getGoalsProgress('testuser')

    expect(result).toEqual([])
  })

  test('uses getDailyAggregateValue for cumulative metrics like steps', async () => {
    vi.mocked(settings.getSettings).mockResolvedValue({})
    vi.mocked(settings.getEffectiveGoals).mockReturnValue([
      { id: 'goal-1', metric: 'steps', min: 10000, window: '1d' },
    ])

    // For a 1d window with day-based duration, we only include today (1 calendar day)
    // Mock aggregate value: today has 4672 so far
    // losingTomorrow queries today separately (same day for 1d window)
    vi.mocked(db.getDailyAggregateValue)
      .mockResolvedValueOnce(4672) // today for current
      .mockResolvedValueOnce(4672) // today for losingTomorrow

    const result = await getGoalsProgress('testuser')

    expect(result).toHaveLength(1)
    expect(result[0].current).toBe(4672) // only today
    expect(result[0].losing_tomorrow).toBe(4672) // tomorrow we lose today's steps
    expect(result[0].metric).toBe('steps')

    // Should use getDailyAggregateValue, not getDailyAggregates
    expect(db.getDailyAggregateValue).toHaveBeenCalled()
    expect(db.getDailyAggregates).not.toHaveBeenCalled()
  })

  test('falls back to getRawDailySum when no aggregate value exists for cumulative metric', async () => {
    vi.mocked(settings.getSettings).mockResolvedValue({})
    vi.mocked(settings.getEffectiveGoals).mockReturnValue([
      { id: 'goal-1', metric: 'steps', min: 10000, window: '1d' },
    ])

    // No aggregate value exists
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
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
    vi.mocked(settings.getSettings).mockResolvedValue({})
    vi.mocked(settings.getEffectiveGoals).mockReturnValue([
      { id: 'goal-1', metric: 'steps', min: 70000, window: '7d' },
    ])

    // For a 7d window with day-based duration, we include exactly 7 calendar days
    // (today + 6 previous days)
    // At 2026-02-02T12:00:00Z, this is Jan 27 through Feb 2
    vi.mocked(db.getDailyAggregateValue)
      .mockResolvedValueOnce(10000) // Jan 27 (oldest)
      .mockResolvedValueOnce(12000) // Jan 28
      .mockResolvedValueOnce(11000) // Jan 29
      .mockResolvedValueOnce(9000) // Jan 30
      .mockResolvedValueOnce(13000) // Jan 31
      .mockResolvedValueOnce(8000) // Feb 1
      .mockResolvedValueOnce(5000) // Feb 2 (today)
      // losingTomorrow query for oldest day (Jan 27)
      .mockResolvedValueOnce(10000)

    const result = await getGoalsProgress('testuser')

    expect(result).toHaveLength(1)
    // Total should be sum of all 7 days = 68000
    expect(result[0].current).toBe(68000)
    expect(result[0].losing_tomorrow).toBe(10000)
  })

  test('uses rolling time for hour-based windows (24h spans 2 calendar days at noon)', async () => {
    vi.mocked(settings.getSettings).mockResolvedValue({})
    vi.mocked(settings.getEffectiveGoals).mockReturnValue([
      { id: 'goal-1', metric: 'steps', min: 10000, window: '24h' },
    ])

    // For a 24h window at noon, we use rolling hours (not calendar days)
    // At 2026-02-02T12:00:00Z, this is yesterday 12:00 through now
    // This spans 2 calendar days: Feb 1 (partial) and Feb 2 (partial)
    vi.mocked(db.getDailyAggregateValue)
      .mockResolvedValueOnce(5000) // Feb 1 (partial)
      .mockResolvedValueOnce(4672) // Feb 2 (partial)
      // losingTomorrow query for Feb 1
      .mockResolvedValueOnce(5000)

    const result = await getGoalsProgress('testuser')

    expect(result).toHaveLength(1)
    // 24h rolling window spans 2 days
    expect(result[0].current).toBe(9672) // 5000 + 4672
    expect(result[0].losing_tomorrow).toBe(5000)
  })

  test('uses getTimeSeries for HR zone metrics', async () => {
    vi.mocked(settings.getSettings).mockResolvedValue({})
    vi.mocked(settings.getEffectiveGoals).mockReturnValue([
      { id: 'goal-1', metric: 'hr_zone_2_sec', min: 9000, window: '7d' },
    ])
    vi.mocked(settings.getEffectiveHrZones).mockResolvedValue({
      source: 'default',
      zones: { 1: 90, 2: 108, 3: 126, 4: 144, 5: 162 },
    })
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(settings.computeHrZoneSecs).mockReturnValue({ 0: 0, 1: 0, 2: 9000, 3: 0, 4: 0, 5: 0 })

    const result = await getGoalsProgress('testuser')

    expect(result).toHaveLength(1)
    expect(result[0].current).toBe(9000)
    expect(db.getTimeSeries).toHaveBeenCalledWith(
      'testuser',
      'heart_rate',
      expect.any(Date),
      expect.any(Date),
    )
  })

  test('uses getDailyAggregates for non-cumulative metrics', async () => {
    vi.mocked(settings.getSettings).mockResolvedValue({})
    vi.mocked(settings.getEffectiveGoals).mockReturnValue([
      { id: 'goal-1', metric: 'weight', min: 70, window: '1d' },
    ])
    vi.mocked(db.getDailyAggregates).mockResolvedValue([
      { avg: 72.5, date: '2026-02-02', metric: 'weight', sum: 72.5 },
    ])

    const result = await getGoalsProgress('testuser')

    expect(result).toHaveLength(1)
    // Non-cumulative metrics still use getDailyAggregates
    expect(db.getDailyAggregates).toHaveBeenCalled()
    expect(db.getDailyAggregateValue).not.toHaveBeenCalled()
  })
})
