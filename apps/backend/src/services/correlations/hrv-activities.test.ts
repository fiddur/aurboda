import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../../db/index.ts'
import * as locations from '../locations.ts'
import { getActivityImpact } from './activity-impact.ts'
import { getHrvActivitiesCorrelation } from './hrv-activities.ts'

vi.mock('../../db', () => ({
  getEffectiveActivitiesInRange: vi.fn(),
  getProductivity: vi.fn(),
  getTimeSeries: vi.fn(),
}))

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
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
      {
        activity_type: 'exercise' as const,
        end_time: new Date(yesterday.getTime() + 3600000),
        id: 'act1',
        source: 'health_connect' as const,
        start_time: yesterday,
      },
    ])
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
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
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([])

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
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([])
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
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([])
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([])

    const syncProvider = {
      syncCalendarsIfNeeded: vi.fn().mockResolvedValue(undefined),
      syncGarminIfNeeded: vi.fn().mockResolvedValue(undefined),
      syncLastFmIfNeeded: vi.fn().mockResolvedValue(undefined),
      syncGravlIfNeeded: vi.fn().mockResolvedValue(undefined),
      syncOuraIfNeeded: vi.fn().mockResolvedValue(undefined),
      syncRescueTimeIfNeeded: vi.fn().mockResolvedValue(undefined),
    }

    await getHrvActivitiesCorrelation('testuser', 30, syncProvider)

    expect(syncProvider.syncOuraIfNeeded).toHaveBeenCalledWith('testuser', 'tags')
    expect(syncProvider.syncOuraIfNeeded).toHaveBeenCalledWith('testuser', 'sessions')
    expect(syncProvider.syncRescueTimeIfNeeded).toHaveBeenCalledWith('testuser')
  })

  const BIN_MS = 5 * 60_000
  const alignedBase = () => new Date(Math.floor(Date.now() / BIN_MS) * BIN_MS - 2 * 86_400_000)
  const at = (base: Date, minutes: number) => new Date(base.getTime() + minutes * 60_000)
  const noContext = () => {
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locations.getPlaceVisits).mockResolvedValue([])
  }

  test('echoes the clamped window and returns effects on rows', async () => {
    const base = alignedBase()
    noContext()
    vi.mocked(db.getTimeSeries).mockImplementation(async (_u: string, metric: string) =>
      metric === 'stress_level'
        ? ([
            [at(base, -20), 50],
            [at(base, 40), 30],
          ] as [Date, number][])
        : [],
    )
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
      { activity_type: 'meditation', end_time: at(base, 20), source: 'manual' as const, start_time: base },
    ])

    const result = await getHrvActivitiesCorrelation('testuser', 7, undefined, 'hrv_rmssd', 45)
    expect(result.window_minutes).toBe(45)
    const row = result.correlations.activities[0]
    expect(row.stress_effect).toMatchObject({
      after_mean: 30,
      before_mean: 50,
      change: -20,
      paired_occurrences: 1,
    })
    expect(row.hrv_effect.paired_occurrences).toBe(0)
    expect(row.hr_effect.change).toBeNull()

    expect((await getHrvActivitiesCorrelation('testuser', 7)).window_minutes).toBe(30)
    expect((await getHrvActivitiesCorrelation('testuser', 7, undefined, 'hrv_rmssd', 2)).window_minutes).toBe(
      10,
    )
  })

  test('the baseline is time-weighted, so a dense burst does not dominate it', async () => {
    const base = alignedBase()
    noContext()
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([])
    const burst = Array.from(
      { length: 600 },
      (_, i) => [new Date(base.getTime() + i * 1000), 100] as [Date, number],
    )
    const sparse = Array.from({ length: 8 }, (_, i) => [at(base, 60 + i * 30), 50] as [Date, number])
    vi.mocked(db.getTimeSeries).mockImplementation(async (_u: string, metric: string) =>
      metric === 'heart_rate' ? [...burst, ...sparse] : [],
    )

    const result = await getHrvActivitiesCorrelation('testuser', 7)
    expect(result.baseline.mean_hr).toBe(60)
  })

  test('a point activity covers five minutes', async () => {
    const base = alignedBase()
    noContext()
    vi.mocked(db.getTimeSeries).mockImplementation(async (_u: string, metric: string) =>
      metric === 'heart_rate'
        ? ([
            [at(base, 2), 70],
            [at(base, 20), 90],
          ] as [Date, number][])
        : [],
    )
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
      { activity_type: 'coffee', source: 'manual' as const, start_time: base },
    ])

    const row = (await getHrvActivitiesCorrelation('testuser', 7)).correlations.activities[0]
    expect(row.mean_hr).toBe(70)
    expect(row.sample_minutes).toBe(5)
    expect(row.avg_duration_min).toBeUndefined()
    expect(row.occurrences).toBe(1)
  })

  test('the activity row and the exact impact agree', async () => {
    const base = alignedBase()
    noContext()
    const starts = [0, 180, 185, 400, 700, 1000]
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
      ...starts.map((m, i) => ({
        activity_type: 'running',
        end_time: at(base, m + 30),
        source: i % 2 === 0 ? ('garmin' as const) : ('manual' as const),
        start_time: at(base, m),
      })),
      {
        activity_type: 'running_treadmill',
        end_time: at(base, 560),
        source: 'manual' as const,
        start_time: at(base, 520),
      },
    ])
    const points = (offset: number, scale: number) =>
      Array.from(
        { length: 300 },
        (_, i) => [at(base, i * 4 - 60), offset + ((i * scale) % 17)] as [Date, number],
      )
    vi.mocked(db.getTimeSeries).mockImplementation(async (_u: string, metric: string) =>
      metric === 'heart_rate' ? points(60, 7) : metric === 'stress_level' ? points(20, 5) : points(40, 3),
    )

    const row = (await getHrvActivitiesCorrelation('testuser', 30)).correlations.activities.find(
      (a) => a.activity_type === 'running',
    )!
    const impact = await getActivityImpact(
      'testuser',
      'running',
      'activity_type',
      30,
      30,
      undefined,
      undefined,
      undefined,
      'exact',
    )

    expect(row.occurrences).toBe(impact.occurrences)
    expect(row.occurrences).toBe(5)
    expect(row.stress_effect).toEqual(impact.stress_effect)
    expect(row.hr_effect).toEqual(impact.hr_effect)
    expect(row.hrv_effect).toEqual(impact.hrv_effect)
    expect(row.mean_stress).toBe(impact.stress_timeline.during.mean)
    expect(impact.stress_effect.paired_occurrences).toBeGreaterThan(0)
  })

  test('a sample before the period but inside the window feeds the effect, not the baseline', async () => {
    const periodStart = new Date()
    periodStart.setDate(periodStart.getDate() - 7)
    periodStart.setHours(0, 0, 0, 0)
    noContext()
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
      {
        activity_type: 'yoga',
        end_time: at(periodStart, 30),
        source: 'manual' as const,
        start_time: at(periodStart, 10),
      },
    ])
    vi.mocked(db.getTimeSeries).mockImplementation(async (_u: string, metric: string) =>
      metric === 'heart_rate'
        ? ([
            [at(periodStart, -15), 80],
            [at(periodStart, 45), 60],
          ] as [Date, number][])
        : [],
    )

    const result = await getHrvActivitiesCorrelation('testuser', 7)

    expect(db.getTimeSeries).toHaveBeenCalledWith(
      'testuser',
      'heart_rate',
      at(periodStart, -30),
      expect.any(Date),
    )
    expect(result.baseline.mean_hr).toBe(60)
    expect(result.correlations.activities[0].hr_effect).toMatchObject({
      after_mean: 60,
      before_mean: 80,
      paired_occurrences: 1,
    })
  })
})
