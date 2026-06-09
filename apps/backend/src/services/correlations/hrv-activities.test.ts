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

  test('echoes the context metric (defaults to hrv_rmssd)', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locations.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([])

    const def = await getHrvActivitiesCorrelation('testuser', 7)
    expect(def.context_metric).toBe('hrv_rmssd')

    const hr = await getHrvActivitiesCorrelation('testuser', 7, undefined, 'heart_rate')
    expect(hr.context_metric).toBe('heart_rate')
  })

  test('derives the productivity correlation from the chosen context series', async () => {
    const t = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000)
    // Two windows in the same category with different productivity scores, so the
    // correlation is computable and its sign depends on which series is used.
    vi.mocked(db.getProductivity).mockResolvedValue([
      {
        activity: 'vscode',
        category: 'Dev',
        duration_sec: 1800,
        end_time: t(90),
        productivity: 1,
        start_time: t(120),
      },
      {
        activity: 'vscode',
        category: 'Dev',
        duration_sec: 1800,
        end_time: t(30),
        productivity: 3,
        start_time: t(60),
      },
    ])
    vi.mocked(locations.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([])
    // HRV rises with the score (positive r); HR falls with it (negative r).
    vi.mocked(db.getTimeSeries).mockImplementation(async (_u: string, metric: string) => {
      const pts: [Date, number][] =
        metric === 'heart_rate'
          ? [
              [t(115), 70],
              [t(105), 72],
              [t(55), 50],
              [t(45), 52],
            ]
          : metric === 'stress_level'
            ? [
                [t(115), 20],
                [t(105), 20],
                [t(55), 20],
                [t(45), 20],
              ]
            : [
                [t(115), 40],
                [t(105), 42],
                [t(55), 60],
                [t(45), 62],
              ] // hrv_rmssd
      return pts
    })

    const hrv = await getHrvActivitiesCorrelation('testuser', 7, undefined, 'hrv_rmssd')
    const hr = await getHrvActivitiesCorrelation('testuser', 7, undefined, 'heart_rate')
    const hrvDev = hrv.correlations.productivity.find((p) => p.category === 'Dev')
    const hrDev = hr.correlations.productivity.find((p) => p.category === 'Dev')

    // The coefficient flips sign with the context metric, proving it uses the
    // selected series. Means stay populated for all three either way.
    expect(hrvDev?.correlation_coefficient).toBeGreaterThan(0.9)
    expect(hrDev?.correlation_coefficient).toBeLessThan(-0.9)
    expect(hrvDev?.mean_hr).toBe(61)
    expect(hrvDev?.mean_hrv).toBe(51)
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
