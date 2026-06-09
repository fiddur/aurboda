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

  test('correlates productivity against the chosen context metric', async () => {
    const t = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000)
    // One productivity window; productivity score is constant so r is null, but
    // the point is that the *chosen* metric's series feeds the correlation.
    vi.mocked(db.getProductivity).mockResolvedValue([
      {
        activity: 'vscode',
        category: 'Dev',
        duration_sec: 3600,
        end_time: t(0),
        productivity: 2,
        start_time: t(60),
      },
    ])
    vi.mocked(locations.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([])
    // Distinct series per metric so we can tell which one was used for the means.
    vi.mocked(db.getTimeSeries).mockImplementation(async (_u: string, metric: string) => {
      const at = [t(50), t(40), t(30)]
      if (metric === 'heart_rate') return at.map((d) => [d, 62] as [Date, number])
      if (metric === 'stress_level') return at.map((d) => [d, 20] as [Date, number])
      return at.map((d) => [d, 45] as [Date, number]) // hrv_rmssd
    })

    const result = await getHrvActivitiesCorrelation('testuser', 7, undefined, 'heart_rate')
    expect(result.context_metric).toBe('heart_rate')
    // All three metric means are still populated for the table.
    const dev = result.correlations.productivity.find((p) => p.category === 'Dev')
    expect(dev?.mean_hr).toBe(62)
    expect(dev?.mean_hrv).toBe(45)
    expect(dev?.mean_stress).toBe(20)
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
