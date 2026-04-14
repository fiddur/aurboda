import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../../db/index.ts'
import * as locations from '../locations.ts'
import { getHrvActivitiesCorrelation } from './hrv-activities.ts'

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

describe('getHrvActivitiesCorrelation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns correlations for productivity, locations, activities and tags', async () => {
    const now = new Date()
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    vi.mocked(db.getTimeSeries).mockResolvedValue([
      [yesterday, 45] as [Date, number],
      [now, 50] as [Date, number],
    ])
    vi.mocked(db.getProductivity).mockResolvedValue([
      {
        activity: 'vscode',
        category: 'Software Development',
        duration_sec: 3600,
        end_time: new Date(yesterday.getTime() + 3600000),
        productivity: 2,
        start_time: yesterday,
      },
    ])
    vi.mocked(locations.getPlaceVisits).mockResolvedValue([
      {
        duration_minutes: 60,
        end_time: new Date(yesterday.getTime() + 3600000),
        lat: 59.33,
        lon: 18.07,
        name: 'Office',
        source: 'named' as const,
        start_time: yesterday,
      },
    ])
    vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([
      {
        activity_type: 'exercise' as const,
        end_time: new Date(yesterday.getTime() + 3600000),
        id: 'act1',
        source: 'health_connect' as const,
        start_time: yesterday,
      },
    ])
    vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([
      {
        end_time: new Date(yesterday.getTime() + 300000),
        external_id: 'tag1',
        source: 'manual' as const,
        start_time: yesterday,
        activity_type: 'coffee',
      },
    ])

    const result = await getHrvActivitiesCorrelation('testuser', 7)

    expect(result.period.days).toBe(7)
    expect(result.baseline).toBeDefined()
    expect(result.correlations.productivity).toBeInstanceOf(Array)
    expect(result.correlations.locations).toBeInstanceOf(Array)
    expect(result.correlations.activities).toBeInstanceOf(Array)
  })

  test('calls sync provider when provided', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locations.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([])
    vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([])

    const syncProvider = {
      syncCalendarsIfNeeded: vi.fn().mockResolvedValue(undefined),
      syncGarminIfNeeded: vi.fn().mockResolvedValue(undefined),
      syncLastFmIfNeeded: vi.fn().mockResolvedValue(undefined),
      syncOuraIfNeeded: vi.fn().mockResolvedValue(undefined),
      syncRescueTimeIfNeeded: vi.fn().mockResolvedValue(undefined),
    }

    await getHrvActivitiesCorrelation('testuser', 30, syncProvider)

    expect(syncProvider.syncOuraIfNeeded).toHaveBeenCalledWith('testuser', 'tags')
    expect(syncProvider.syncOuraIfNeeded).toHaveBeenCalledWith('testuser', 'sessions')
    expect(syncProvider.syncRescueTimeIfNeeded).toHaveBeenCalledWith('testuser')
  })
})
