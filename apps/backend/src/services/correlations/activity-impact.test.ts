import type { ActivityTypeDefinition } from '@aurboda/api-spec'

import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { MergedActivity } from '../../db/types.ts'

import * as db from '../../db/index.ts'
import * as settings from '../settings.ts'
import { getActivityImpact, type ImpactSlicing } from './activity-impact.ts'

vi.mock('../../db', () => ({
  expandActivityTypes: vi.fn(),
  getActivityTypeDefinitions: vi.fn(),
  getEffectiveActivitiesInRange: vi.fn(),
  getProductivity: vi.fn(),
  getTimeSeries: vi.fn(),
}))

vi.mock('../locations', () => ({
  getPlaceVisits: vi.fn(),
}))

vi.mock('../settings', () => ({
  getUserTimezone: vi.fn(),
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

  test('extra metrics get an effect and bucket stats; without them nothing new appears', async () => {
    const base = new Date('2024-01-15T12:00:00Z')
    vi.mocked(db.getTimeSeries).mockImplementation(async (_u: string, metric: string) =>
      metric === 'respiratory_rate'
        ? ([
            [at(base, -20), 16],
            [at(base, 10), 12],
            [at(base, 40), 14],
          ] as [Date, number][])
        : [],
    )
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
      { activity_type: 'yoga', end_time: at(base, 30), source: 'manual' as const, start_time: base },
    ])

    const result = await getActivityImpact(
      'testuser',
      'yoga',
      'activity_type',
      30,
      90,
      undefined,
      undefined,
      undefined,
      'contains',
      ['respiratory_rate', 'body_battery'],
    )

    expect(result.metric_effects?.respiratory_rate).toMatchObject({
      after_mean: 14,
      before_mean: 16,
      change: -2,
      paired_occurrences: 1,
    })
    expect(result.metric_effects?.body_battery.paired_occurrences).toBe(0)
    expect(result.timeline.map((b) => b.metrics?.respiratory_rate.mean)).toEqual([16, null, 12, 14, null])
    expect(result.stress_effect.paired_occurrences).toBe(0)

    const plain = await getActivityImpact('testuser', 'yoga', 'activity_type', 30, 90)
    expect(plain).not.toHaveProperty('metric_effects')
    expect(plain.timeline.every((b) => !('metrics' in b))).toBe(true)
  })
})

describe('getActivityImpact slicing', () => {
  const since = new Date('2024-01-01T00:00:00Z')
  const until = new Date('2024-02-01T00:00:00Z')
  const day = (d: number, hour = 12) => new Date(Date.UTC(2024, 0, d, hour))
  const mins = (base: Date, m: number) => new Date(base.getTime() + m * 60_000)
  const yoga = (start: Date, minutes: number, data?: Record<string, unknown>): MergedActivity => ({
    activity_type: 'yoga',
    end_time: mins(start, minutes),
    source: 'manual' as const,
    start_time: start,
    ...(data ? { data } : {}),
  })
  const impact = (slicing: ImpactSlicing, windowMinutes = 30) =>
    getActivityImpact(
      'testuser',
      'yoga',
      'activity_type',
      windowMinutes,
      31,
      undefined,
      until,
      since,
      'contains',
      [],
      slicing,
    )

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.expandActivityTypes).mockResolvedValue(['sleep', 'nap'])
    vi.mocked(db.getActivityTypeDefinitions).mockResolvedValue([])
    vi.mocked(settings.getUserTimezone).mockResolvedValue('UTC')
  })

  test('without slicing the result only gains total_occurrences', async () => {
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([yoga(day(15), 20), yoga(day(16), 20)])

    const result = await impact({})

    expect(result.total_occurrences).toBe(2)
    expect(result.occurrences).toBe(2)
    expect(result).not.toHaveProperty('breakdown')
    expect(result).not.toHaveProperty('dimensions')
    expect(db.getEffectiveActivitiesInRange).toHaveBeenCalledTimes(1)
    expect(db.getEffectiveActivitiesInRange).toHaveBeenCalledWith(
      'testuser',
      since,
      new Date(until.getTime() - 1),
    )
    expect(db.expandActivityTypes).not.toHaveBeenCalled()
    expect(settings.getUserTimezone).not.toHaveBeenCalled()
  })

  test('a duration breakdown analyses each group; the whole stays as it was', async () => {
    vi.mocked(db.getTimeSeries).mockImplementation(async (_u: string, metric: string) =>
      metric === 'stress_level'
        ? ([
            [mins(day(15), -20), 50],
            [mins(day(15), 20), 30],
            [mins(day(17), -20), 60],
            [mins(day(17), 70), 40],
          ] as [Date, number][])
        : [],
    )
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
      yoga(day(15), 10),
      yoga(day(16), 12),
      yoga(day(17), 60),
    ])

    const plain = await impact({})
    const result = await impact({ breakdown: 'duration' })

    expect(result.breakdown?.dimension).toBe('duration')
    expect(result.breakdown?.label).toBe('Length')
    expect(result.breakdown?.omitted_groups).toBe(0)
    expect(
      result.breakdown?.groups.map((g) => [
        g.key,
        g.label,
        g.occurrences,
        g.avg_duration_min,
        g.timeline.length,
      ]),
    ).toEqual([
      ['0-15', 'Under 15 min', 2, 11, 5],
      ['60-', '60 min or more', 1, 60, 5],
    ])
    expect(result.breakdown?.groups[0].stress_effect).toMatchObject({ change: -20, paired_occurrences: 1 })
    expect(result.breakdown?.groups[1].stress_effect).toMatchObject({ change: -20, paired_occurrences: 1 })
    const { breakdown: _, ...whole } = result
    expect(whole).toEqual(plain)
  })

  test('a duration filter keeps the short session, still clipped by the long one it drops', async () => {
    vi.mocked(db.getTimeSeries).mockImplementation(async (_u: string, metric: string) =>
      metric === 'stress_level'
        ? ([
            [mins(day(15), -20), 50],
            [mins(day(15), 20), 30],
            [mins(day(15), 50), 90],
          ] as [Date, number][])
        : [],
    )
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
      yoga(day(15), 10),
      yoga(mins(day(15), 40), 60),
    ])

    const result = await impact({ filters: [{ dimension: 'duration', keys: ['0-15'] }] }, 60)

    expect(result.total_occurrences).toBe(2)
    expect(result.occurrences).toBe(1)
    expect(result.avg_duration_min).toBe(10)
    expect(result.stress_effect).toMatchObject({ after_mean: 30, before_mean: 50, paired_occurrences: 1 })
  })

  test('a field breakdown puts a merged session with two values in both groups', async () => {
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
      yoga(day(15), 20, { session_name: 'Morning flow' }),
      yoga(mins(day(15), 25), 15, { session_name: 'Evening stretch' }),
      yoga(day(16), 20, { session_name: 'Morning flow' }),
    ])

    const result = await impact({ breakdown: 'field:session_name' })

    expect(result.occurrences).toBe(2)
    expect(result.breakdown?.label).toBe('Session Name')
    expect(result.breakdown?.groups.map((g) => [g.key, g.occurrences])).toEqual([
      ['Morning flow', 2],
      ['Evening stretch', 1],
    ])
  })

  test('a sleep filter drops a session followed by a nap, over an extended fetch', async () => {
    const nap: MergedActivity = {
      activity_type: 'nap',
      end_time: mins(day(15), 90),
      source: 'manual' as const,
      start_time: mins(day(15), 40),
    }
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
      yoga(mins(since, -120), 30),
      yoga(day(15), 30),
      nap,
      yoga(day(16), 30),
    ])

    const result = await impact({ filters: [{ dimension: 'sleep', keys: ['none'] }] })

    expect(result.total_occurrences).toBe(2)
    expect(result.occurrences).toBe(1)
    expect(db.getEffectiveActivitiesInRange).toHaveBeenCalledTimes(1)
    expect(db.getEffectiveActivitiesInRange).toHaveBeenCalledWith(
      'testuser',
      new Date(since.getTime() - 30 * 60_000 - 86_400_000),
      new Date(until.getTime() - 1 + 30 * 60_000),
    )
    expect(db.expandActivityTypes).toHaveBeenCalledWith('testuser', ['sleep', 'nap'])
  })

  test('include_dimensions lists every dimension with counts before filters', async () => {
    const definition = {
      data_schema: {
        fields: [
          { is_categorical: true, label: 'Session', name: 'session_name', type: 'string' },
          {
            item_fields: [{ is_categorical: true, name: 'exercise', type: 'string' }],
            name: 'sets',
            type: 'list',
          },
        ],
      },
      name: 'yoga',
    } as ActivityTypeDefinition
    vi.mocked(db.getActivityTypeDefinitions).mockResolvedValue([definition])
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
      yoga(day(15, 7), 10, { session_name: 'Morning flow', sets: [{ exercise: 'Plank' }] }),
      yoga(day(16, 19), 40),
    ])

    const result = await impact({
      filters: [{ dimension: 'duration', keys: ['0-15'] }],
      includeDimensions: true,
    })

    expect(result.occurrences).toBe(1)
    expect(result.dimensions?.map((d) => d.dimension)).toEqual([
      'duration',
      'time_of_day',
      'sleep',
      'field:session_name',
      'field:sets.exercise',
    ])
    expect(result.dimensions?.[0].groups.map((g) => [g.key, g.occurrences])).toEqual([
      ['0-15', 1],
      ['15-30', 0],
      ['30-60', 1],
      ['60-', 0],
    ])
    expect(result.dimensions?.[1].groups.map((g) => [g.key, g.occurrences])).toEqual([
      ['0-6', 0],
      ['6-12', 1],
      ['12-18', 0],
      ['18-0', 1],
    ])
    expect(result.dimensions?.[2].groups).toEqual([
      { key: 'none', label: 'No sleep in the window', occurrences: 2 },
    ])
    expect(result.dimensions?.[3]).toEqual({
      dimension: 'field:session_name',
      groups: [
        { key: 'Morning flow', label: 'Morning flow', occurrences: 1 },
        { key: '(none)', label: 'No value', occurrences: 1 },
      ],
      label: 'Session',
      omitted_groups: 0,
    })
    expect(result.dimensions?.[4].label).toBe('Exercise')
    expect(result.dimensions?.[4].groups.map((g) => [g.key, g.label])).toEqual([
      ['plank', 'Plank'],
      ['(none)', 'No value'],
    ])
  })

  test('time of day uses the given timezone, else the user setting', async () => {
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
      yoga(new Date('2024-01-15T05:30:00Z'), 20),
    ])

    const stockholm = await impact({ breakdown: 'time_of_day', tz: 'Europe/Stockholm' })
    expect(stockholm.breakdown?.groups.map((g) => g.key)).toEqual(['6-12'])
    expect(settings.getUserTimezone).not.toHaveBeenCalled()

    const user = await impact({ breakdown: 'time_of_day' })
    expect(user.breakdown?.groups.map((g) => g.key)).toEqual(['0-6'])
    expect(settings.getUserTimezone).toHaveBeenCalledWith('testuser')
  })

  test('a breakdown past the cap reports the groups it left out', async () => {
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue(
      Array.from({ length: 14 }, (_, i) => yoga(day(i + 2), 20, { session_name: `Flow ${i}` })),
    )

    const result = await impact({ breakdown: 'field:session_name' })

    expect(result.breakdown?.groups).toHaveLength(12)
    expect(result.breakdown?.omitted_groups).toBe(2)
  })
})
