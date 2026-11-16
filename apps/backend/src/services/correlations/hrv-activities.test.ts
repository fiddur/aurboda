import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../../db/index.ts'
import * as locations from '../locations.ts'
import { getActivityImpact } from './activity-impact.ts'
import { getHrvActivitiesCorrelation } from './hrv-activities.ts'
import { binSeries } from './impact.ts'

vi.mock('../../db', () => ({
  getActivityTypeDefinitions: vi.fn(),
  getBinnedTimeSeries: vi.fn(),
  getEffectiveActivitiesInRange: vi.fn(),
  getMealFlagsInRange: vi.fn(),
  getMealLogCompletedInRange: vi.fn(),
  getProductivity: vi.fn(),
  getTimeSeries: vi.fn(),
  listSensitivityFlags: vi.fn(),
}))

vi.mock('../locations', () => ({
  getPlaceVisits: vi.fn(),
}))

describe('getHrvActivitiesCorrelation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getMealFlagsInRange).mockResolvedValue([])
    vi.mocked(db.getMealLogCompletedInRange).mockResolvedValue([])
    vi.mocked(db.listSensitivityFlags).mockResolvedValue([])
    vi.mocked(db.getActivityTypeDefinitions).mockResolvedValue([])
    vi.mocked(db.getBinnedTimeSeries).mockImplementation(async (user, metric, start, end, binMinutes) =>
      binSeries(await db.getTimeSeries(user, metric, start, end), binMinutes),
    )
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

  const mockDevCategory = () => {
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
  }

  const devRow = async (contextMetric: 'hrv_rmssd' | 'heart_rate') => {
    const result = await getHrvActivitiesCorrelation('testuser', 7, undefined, contextMetric)
    return result.correlations.productivity.find((p) => p.category === 'Dev')
  }

  test('derives the productivity correlation from the chosen context series', async () => {
    mockDevCategory()
    const hrvDev = await devRow('hrv_rmssd')
    const hrDev = await devRow('heart_rate')

    // The coefficient flips sign with the context metric, proving it uses the
    // selected series. Means stay populated for all three either way.
    expect(hrvDev?.correlation_coefficient).toBeGreaterThan(0.9)
    expect(hrDev?.correlation_coefficient).toBeLessThan(-0.9)
    expect(hrvDev?.mean_hr).toBe(61)
    expect(hrvDev?.mean_hrv).toBe(51)
  })

  test('returns the productivity r against every metric, whatever the context metric', async () => {
    mockDevCategory()
    const hrvDev = await devRow('hrv_rmssd')
    const hrDev = await devRow('heart_rate')
    const coefficients = hrvDev?.correlation_coefficients

    expect(hrDev?.correlation_coefficients).toEqual(coefficients)
    expect(Object.keys(coefficients ?? {}).toSorted()).toEqual(['heart_rate', 'hrv_rmssd', 'stress_level'])
    expect(coefficients?.hrv_rmssd).toBeGreaterThan(0.9)
    expect(coefficients?.heart_rate).toBeLessThan(-0.9)
    // Constant stress has no variation, so no r.
    expect(coefficients?.stress_level).toBeNull()
    expect(hrvDev?.correlation_coefficient).toBe(coefficients?.hrv_rmssd)
    expect(hrDev?.correlation_coefficient).toBe(coefficients?.heart_rate)
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
      syncHomeAssistantIfNeeded: vi.fn().mockResolvedValue(undefined),
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

  test('adjusts every tested change in the response over the response', async () => {
    const base = alignedBase()
    noContext()
    const session = (type: string, i: number) => ({
      activity_type: type,
      end_time: at(base, i * 180 + 20),
      source: 'manual' as const,
      start_time: at(base, i * 180),
    })
    const meditationDiffs = [-20, -18, -21, -19]
    const readingDiffs = [1, -2, 2, -1]
    vi.mocked(db.getTimeSeries).mockImplementation(async (_u: string, metric: string) =>
      metric === 'stress_level'
        ? ([
            ...meditationDiffs.flatMap((diff, i) => [
              [at(base, i * 180 - 20), 50],
              [at(base, i * 180 + 40), 50 + diff],
            ]),
            ...readingDiffs.flatMap((diff, i) => [
              [at(base, 90 + i * 180 - 20), 40],
              [at(base, 90 + i * 180 + 40), 40 + diff],
            ]),
          ] as [Date, number][])
        : [],
    )
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
      ...meditationDiffs.map((_, i) => session('meditation', i)),
      ...readingDiffs.map((_, i) => ({
        ...session('reading', i),
        end_time: at(base, 90 + i * 180 + 20),
        start_time: at(base, 90 + i * 180),
      })),
    ])

    const result = await getHrvActivitiesCorrelation('testuser', 7)
    const effect = (type: string) =>
      result.correlations.activities.find((row) => row.activity_type === type)!.stress_effect
    const meditation = effect('meditation')
    const reading = effect('reading')

    expect(result.comparisons).toBe(2)
    expect(meditation.p_value).toBeLessThan(0.001)
    expect(reading.p_value).toBeGreaterThan(0.5)
    expect(reading.p_value_adjusted).toBe(reading.p_value)
    expect(meditation.p_value_adjusted).toBeCloseTo(2 * meditation.p_value!, 6)
    expect(result.correlations.activities[0].hrv_effect.p_value_adjusted).toBeNull()
  })

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

  describe('parent types count their subtypes', () => {
    const family = () =>
      vi.mocked(db.getActivityTypeDefinitions).mockResolvedValue([
        { display_name: 'Running', name: 'running' },
        { display_name: 'Trail running', name: 'trail_running', parent_type: 'running' },
        {
          display_name: 'Mountain trail running',
          name: 'mountain_trail_running',
          parent_type: 'trail_running',
        },
        { display_name: 'Yoga', name: 'yoga' },
      ] as Awaited<ReturnType<typeof db.getActivityTypeDefinitions>>)
    const act = (type: string, base: Date, from: number, to: number) => ({
      activity_type: type,
      end_time: at(base, to),
      source: 'manual' as const,
      start_time: at(base, from),
    })
    const rows = async () => {
      const result = await getHrvActivitiesCorrelation('testuser', 30)
      return new Map(result.correlations.activities.map((row) => [row.activity_type, row]))
    }

    beforeEach(() => {
      noContext()
      vi.mocked(db.getTimeSeries).mockResolvedValue([])
      family()
    })

    test('a parent row counts its own and its subtypes sessions, overlapping ones as one', async () => {
      const base = alignedBase()
      vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
        act('running', base, 0, 30),
        act('trail_running', base, 5, 35),
        act('trail_running', base, 300, 330),
        act('yoga', base, 600, 630),
      ])

      const byType = await rows()

      expect(byType.get('running')?.occurrences).toBe(2)
      expect(byType.get('running')?.includes_subtypes).toEqual(['trail_running'])
      expect(byType.get('trail_running')?.occurrences).toBe(2)
      expect(byType.get('trail_running')).not.toHaveProperty('includes_subtypes')
      expect(byType.get('yoga')).not.toHaveProperty('includes_subtypes')
    })

    test('a parent row appears when only subtype activities exist; a grandchild rolls up to both', async () => {
      const base = alignedBase()
      vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
        act('trail_running', base, 0, 30),
        act('mountain_trail_running', base, 300, 330),
      ])

      const byType = await rows()

      expect(byType.get('running')).toMatchObject({
        includes_subtypes: ['mountain_trail_running', 'trail_running'],
        occurrences: 2,
      })
      expect(byType.get('trail_running')).toMatchObject({
        includes_subtypes: ['mountain_trail_running'],
        occurrences: 2,
      })
      expect(byType.get('mountain_trail_running')?.occurrences).toBe(1)
    })

    test('the parent row and the exact impact of the parent agree', async () => {
      const base = alignedBase()
      vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
        act('running', base, 0, 30),
        act('trail_running', base, 5, 35),
        act('trail_running', base, 300, 330),
        act('mountain_trail_running', base, 700, 730),
      ])

      const row = (await rows()).get('running')!
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

      expect(row.occurrences).toBe(3)
      expect(impact.occurrences).toBe(row.occurrences)
    })
  })

  test('a meal row per flag, agreeing with the meal_sensitivity impact', async () => {
    const base = new Date()
    base.setDate(base.getDate() - 3)
    base.setHours(0, 0, 0, 0)
    const atMinute = (minutes: number) => new Date(base.getTime() + minutes * 60_000)
    const gluten = { created_at: base, id: 'flag-gluten', name: 'gluten', sort_order: 0, updated_at: base }
    const dairy = { created_at: base, id: 'flag-dairy', name: 'dairy', sort_order: 1, updated_at: base }
    vi.mocked(db.listSensitivityFlags).mockResolvedValue([gluten, dairy])
    vi.mocked(db.getMealFlagsInRange).mockResolvedValue(
      [100, 300, 500, 700].map((m, i) => ({
        flag_ids: i === 3 ? [] : [gluten.id],
        id: `meal-${m}`,
        time: atMinute(m),
      })),
    )
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locations.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([])
    const points = (offset: number) =>
      Array.from({ length: 300 }, (_, i) => [atMinute(i * 4 - 60), offset + ((i * 7) % 17)] as [Date, number])
    vi.mocked(db.getTimeSeries).mockImplementation(async (_u: string, metric: string) =>
      metric === 'heart_rate' ? points(60) : metric === 'stress_level' ? points(20) : points(40),
    )

    const { correlations } = await getHrvActivitiesCorrelation('testuser', 30)
    const impact = await getActivityImpact(
      'testuser',
      gluten.id,
      'meal_sensitivity',
      30,
      30,
      undefined,
      undefined,
      undefined,
      'exact',
      [],
      { tz: 'UTC' },
    )

    expect(correlations.meals.map((m) => [m.flag_id, m.flag_name, m.occurrences])).toEqual([
      [gluten.id, 'gluten', 3],
    ])
    expect(impact.activity).toBe('gluten')
    expect(impact.occurrences).toBe(3)
    expect(correlations.meals[0].hrv_effect).toEqual(impact.hrv_effect)
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

  test('an extra metric gets stats, an effect and a baseline; without extras nothing new appears', async () => {
    const base = alignedBase()
    noContext()
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
      { activity_type: 'meditation', end_time: at(base, 20), source: 'manual' as const, start_time: base },
    ])
    vi.mocked(db.getTimeSeries).mockImplementation(async (_u: string, metric: string) =>
      metric === 'body_battery'
        ? ([
            [at(base, -20), 50],
            [at(base, 5), 55],
            [at(base, 40), 60],
          ] as [Date, number][])
        : [],
    )

    const result = await getHrvActivitiesCorrelation('testuser', 7, undefined, 'hrv_rmssd', 30, [
      'body_battery',
    ])

    expect(db.getTimeSeries).toHaveBeenCalledWith(
      'testuser',
      'body_battery',
      expect.any(Date),
      expect.any(Date),
    )
    expect(result.metric_baselines).toEqual({ body_battery: 55 })
    expect(result.correlations.activities[0].metrics).toEqual({
      body_battery: {
        delta_from_baseline: 0,
        effect: expect.objectContaining({
          after_mean: 60,
          before_mean: 50,
          change: 10,
          paired_occurrences: 1,
        }),
        mean: 55,
        stddev: null,
      },
    })

    const plain = await getHrvActivitiesCorrelation('testuser', 7)
    expect(plain).not.toHaveProperty('metric_baselines')
    expect(plain.correlations.activities[0]).not.toHaveProperty('metrics')
  })

  test('productivity rows get the r of an extra metric', async () => {
    mockDevCategory()
    const result = await getHrvActivitiesCorrelation('testuser', 7, undefined, 'hrv_rmssd', 30, [
      'body_battery',
    ])
    const dev = result.correlations.productivity.find((p) => p.category === 'Dev')

    expect(dev?.metrics?.body_battery.correlation_coefficient).toBeGreaterThan(0.9)
    expect(dev?.metrics?.body_battery.correlation_coefficient).toBe(dev?.correlation_coefficients.hrv_rmssd)
  })
})
