import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../../db/index.ts'
import { getActivityImpact } from './activity-impact.ts'

vi.mock('../../db', () => ({
  getEffectiveActivitiesInRange: vi.fn(),
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
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
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
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([])

    const result = await getActivityImpact('testuser', 'nonexistent', 'tag', 30, 90)

    expect(result.occurrences).toBe(0)
    expect(result.avg_duration_min).toBe(0)
  })

  test('an explicit since starts the range exactly there', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([])
    const since = new Date('2026-03-01T00:00:00+01:00')
    const until = new Date('2026-04-01T00:00:00+02:00')

    await getActivityImpact('testuser', 'coffee', 'tag', 30, 31, undefined, until, since)

    expect(db.getTimeSeries).toHaveBeenCalledWith(
      'testuser',
      'hrv_rmssd',
      new Date(since.getTime() - 30 * 60_000),
      new Date(until.getTime() - 1 + 30 * 60_000),
    )
    expect(db.getEffectiveActivitiesInRange).toHaveBeenCalledWith(
      'testuser',
      since,
      new Date(until.getTime() - 1),
    )
  })

  test('without since, the range reaches periodDays back from until', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([])
    const until = new Date('2026-04-01T00:00:00Z')

    await getActivityImpact('testuser', 'coffee', 'tag', 30, 31, undefined, until)

    expect(db.getTimeSeries).toHaveBeenCalledWith(
      'testuser',
      'hrv_rmssd',
      new Date('2026-02-28T23:30:00Z'),
      new Date(until.getTime() - 1 + 30 * 60_000),
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

  const at = (base: Date, minutes: number) => new Date(base.getTime() + minutes * 60_000)

  test("match 'exact' excludes longer names that the default contains", async () => {
    const base = new Date('2024-01-15T12:00:00Z')
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
      { activity_type: 'running', end_time: at(base, 30), source: 'manual' as const, start_time: base },
      {
        activity_type: 'running_treadmill',
        end_time: at(base, 330),
        source: 'manual' as const,
        start_time: at(base, 300),
      },
    ])

    const contains = await getActivityImpact('testuser', 'running', 'activity_type', 30, 90)
    const exact = await getActivityImpact(
      'testuser',
      'running',
      'activity_type',
      30,
      90,
      undefined,
      undefined,
      undefined,
      'exact',
    )

    expect(contains.occurrences).toBe(2)
    expect(exact.occurrences).toBe(1)
  })

  test('the same session from two sources is one occurrence', async () => {
    const base = new Date('2024-01-15T12:00:00Z')
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
      { activity_type: 'yoga', end_time: at(base, 60), source: 'garmin' as const, start_time: base },
      {
        activity_type: 'yoga',
        end_time: at(base, 61),
        source: 'health_connect' as const,
        start_time: at(base, 1),
      },
    ])

    const result = await getActivityImpact('testuser', 'yoga', 'activity_type', 30, 90)

    expect(result.occurrences).toBe(1)
    expect(result.avg_duration_min).toBe(61)
  })

  test('returns the paired effects and the clamped window', async () => {
    const base = new Date('2024-01-15T12:00:00Z')
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

    const result = await getActivityImpact('testuser', 'meditation', 'activity_type', 30, 90)
    expect(result.window_minutes).toBe(30)
    expect(result.stress_effect).toMatchObject({
      after_mean: 30,
      before_mean: 50,
      change: -20,
      paired_occurrences: 1,
    })
    expect(result.hrv_effect.paired_occurrences).toBe(0)
    expect(result.hr_effect.change).toBeNull()

    const clamped = await getActivityImpact('testuser', 'meditation', 'activity_type', 1, 90)
    expect(clamped.window_minutes).toBe(10)
    expect(clamped.stress_effect.paired_occurrences).toBe(0)
  })

  test('the series reaches one window past each end of the period', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([])
    const since = new Date('2026-03-01T00:00:00Z')
    const until = new Date('2026-04-01T00:00:00Z')

    await getActivityImpact('testuser', 'yoga', 'activity_type', 240, 31, undefined, until, since)

    for (const metric of ['hrv_rmssd', 'heart_rate', 'stress_level']) {
      expect(db.getTimeSeries).toHaveBeenCalledWith(
        'testuser',
        metric,
        new Date('2026-02-28T20:00:00Z'),
        new Date(until.getTime() - 1 + 240 * 60_000),
      )
    }
  })

  test('the timeline lists the buckets in time order for the chosen window', async () => {
    const base = new Date('2024-01-15T12:00:00Z')
    vi.mocked(db.getTimeSeries).mockImplementation(async (_u: string, metric: string) =>
      metric === 'stress_level'
        ? ([
            [at(base, -150), 40],
            [at(base, 10), 30],
            [at(base, 100), 20],
          ] as [Date, number][])
        : [],
    )
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
      { activity_type: 'yoga', end_time: at(base, 30), source: 'manual' as const, start_time: base },
    ])

    const short = await getActivityImpact('testuser', 'yoga', 'activity_type', 30, 90)
    expect(short.timeline.map((b) => [b.phase, b.start_offset_minutes, b.end_offset_minutes])).toEqual([
      ['before', -30, -15],
      ['before', -15, 0],
      ['during', 0, 0],
      ['after', 0, 15],
      ['after', 15, 30],
    ])

    const long = await getActivityImpact('testuser', 'yoga', 'activity_type', 240, 90)
    expect(long.window_minutes).toBe(240)
    expect(long.timeline.map((b) => b.phase)).toEqual([
      'before',
      'before',
      'before',
      'before',
      'during',
      'after',
      'after',
      'after',
      'after',
    ])
    expect(long.timeline.map((b) => b.start_offset_minutes)).toEqual([
      -240, -180, -120, -60, 0, 0, 60, 120, 180,
    ])
    expect(long.timeline.map((b) => b.stress.mean)).toEqual([null, 40, null, null, 30, null, 20, null, null])
  })
})
