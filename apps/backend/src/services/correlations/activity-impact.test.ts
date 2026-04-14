import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../../db/index.ts'
import { getActivityImpact } from './activity-impact.ts'

// Mock db module
vi.mock('../../db', () => ({
  getAllActivitiesInRange: vi.fn(),
  getProductivity: vi.fn(),
  getTimeSeries: vi.fn(),
}))

// Mock locations module
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
