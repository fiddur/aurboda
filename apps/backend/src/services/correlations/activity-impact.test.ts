import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../../db/index.ts'
import { getActivityImpact } from './activity-impact.ts'

vi.mock('../../db', () => ({
  getAllActivitiesInRange: vi.fn(),
  getProductivity: vi.fn(),
  getTimeSeries: vi.fn(),
}))

vi.mock('../locations', () => ({
  getPlaceVisits: vi.fn(),
}))

describe('getActivityImpact', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns HRV timeline for tag activity', async () => {
    const baseTime = new Date('2024-01-15T12:00:00Z')

    vi.mocked(db.getTimeSeries).mockResolvedValue([
      [new Date(baseTime.getTime() - 25 * 60 * 1000), 45], // before30
      [new Date(baseTime.getTime() - 10 * 60 * 1000), 48], // before15
      [new Date(baseTime.getTime() + 5 * 60 * 1000), 42], // during
      [new Date(baseTime.getTime() + 20 * 60 * 1000), 50], // after15
      [new Date(baseTime.getTime() + 35 * 60 * 1000), 52], // after30
    ] as [Date, number][])
    vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([
      {
        end_time: new Date(baseTime.getTime() + 10 * 60 * 1000),
        external_id: 'tag1',
        source: 'manual' as const,
        start_time: baseTime,
        activity_type: 'coffee',
      },
    ])

    const result = await getActivityImpact('testuser', 'coffee', 'tag', 30, 90)

    expect(result.activity).toBe('coffee')
    expect(result.activity_type).toBe('tag')
    expect(result.occurrences).toBe(1)
    expect(result.hrv_timeline).toBeDefined()
    expect(result.hr_timeline).toBeDefined()
    expect(result.stress_timeline).toBeDefined()
    expect(result.hrv_timeline.before30min).toBeDefined()
    expect(result.hrv_timeline.during).toBeDefined()
    expect(result.hrv_timeline.after30min).toBeDefined()
    expect(result.stress_timeline.before30min).toBeDefined()
    expect(result.stress_timeline.during).toBeDefined()
    expect(result.stress_timeline.after30min).toBeDefined()
  })

  test('returns zero occurrences when no matching tags', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([])

    const result = await getActivityImpact('testuser', 'nonexistent', 'tag', 30, 90)

    expect(result.occurrences).toBe(0)
    expect(result.avg_duration_min).toBe(0)
  })

  test('an explicit since starts the range exactly there', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([])
    const since = new Date('2026-03-01T00:00:00+01:00')
    const until = new Date('2026-04-01T00:00:00+02:00')

    await getActivityImpact('testuser', 'coffee', 'tag', 30, 31, undefined, until, since)

    expect(db.getTimeSeries).toHaveBeenCalledWith(
      'testuser',
      'hrv_rmssd',
      since,
      new Date(until.getTime() - 1),
    )
  })

  test('without since, the range reaches periodDays back from until', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([])
    const until = new Date('2026-04-01T00:00:00Z')

    await getActivityImpact('testuser', 'coffee', 'tag', 30, 31, undefined, until)

    expect(db.getTimeSeries).toHaveBeenCalledWith(
      'testuser',
      'hrv_rmssd',
      new Date('2026-03-01T00:00:00Z'),
      new Date(until.getTime() - 1),
    )
  })

  test('handles productivity category activity type', async () => {
    const baseTime = new Date('2024-01-15T12:00:00Z')

    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([
      {
        activity: 'vscode',
        category: 'Software Development',
        duration_sec: 3600,
        end_time: new Date(baseTime.getTime() + 3600000),
        productivity: 2,
        start_time: baseTime,
      },
    ])

    const result = await getActivityImpact('testuser', 'software development', 'productivity_category')

    expect(result.activity_type).toBe('productivity_category')
    expect(result.occurrences).toBe(1)
  })
})
