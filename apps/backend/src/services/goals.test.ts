import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as db from '../db'
import { getGoalsProgress } from './goals'
import * as settings from './settings'

// Mock the db module
vi.mock('../db', () => ({
  getDailyAggregateValue: vi.fn(),
  getDailyAggregates: vi.fn(),
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

    // For a 1d window at noon, we span 2 calendar days (yesterday and today)
    // Mock aggregate values: yesterday had 5000, today has 4672 so far
    // losingTomorrow queries yesterday separately
    vi.mocked(db.getDailyAggregateValue)
      .mockResolvedValueOnce(5000) // yesterday for current
      .mockResolvedValueOnce(4672) // today for current
      .mockResolvedValueOnce(5000) // yesterday for losingTomorrow

    const result = await getGoalsProgress('testuser')

    expect(result).toHaveLength(1)
    expect(result[0].current).toBe(9672) // 5000 + 4672
    expect(result[0].losingTomorrow).toBe(5000)
    expect(result[0].metric).toBe('steps')

    // Should use getDailyAggregateValue, not getDailyAggregates
    expect(db.getDailyAggregateValue).toHaveBeenCalled()
    expect(db.getDailyAggregates).not.toHaveBeenCalled()
  })

  test('falls back to getDailyAggregates when no aggregate value exists', async () => {
    vi.mocked(settings.getSettings).mockResolvedValue({})
    vi.mocked(settings.getEffectiveGoals).mockReturnValue([
      { id: 'goal-1', metric: 'steps', min: 10000, window: '1d' },
    ])

    // No aggregate value exists
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getDailyAggregates).mockResolvedValue([
      { avg: 4672, date: '2026-02-02', metric: 'steps', sum: 4672 },
    ])

    const result = await getGoalsProgress('testuser')

    expect(result).toHaveLength(1)
    expect(result[0].current).toBe(4672)
  })

  test('sums aggregate values across multiple days for 7d window', async () => {
    vi.mocked(settings.getSettings).mockResolvedValue({})
    vi.mocked(settings.getEffectiveGoals).mockReturnValue([
      { id: 'goal-1', metric: 'steps', min: 70000, window: '7d' },
    ])

    // For a 7d window at noon, we span 8 calendar days
    // Mock aggregate values for current sum (8 days)
    vi.mocked(db.getDailyAggregateValue)
      .mockResolvedValueOnce(10000) // Day 1 (oldest, partial)
      .mockResolvedValueOnce(12000) // Day 2
      .mockResolvedValueOnce(11000) // Day 3
      .mockResolvedValueOnce(9000) // Day 4
      .mockResolvedValueOnce(13000) // Day 5
      .mockResolvedValueOnce(8000) // Day 6
      .mockResolvedValueOnce(7000) // Day 7
      .mockResolvedValueOnce(5000) // Day 8 (today, partial)
      // losingTomorrow query for oldest day
      .mockResolvedValueOnce(10000)

    const result = await getGoalsProgress('testuser')

    expect(result).toHaveLength(1)
    // Total should be sum of all 8 days = 75000
    expect(result[0].current).toBe(75000)
    expect(result[0].losingTomorrow).toBe(10000)
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
