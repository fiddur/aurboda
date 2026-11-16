import type { ActivityTypeDefinition } from '@aurboda/api-spec'

import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { MergedActivity } from '../../db/types.ts'

import * as db from '../../db/index.ts'
import * as settings from '../settings.ts'
import {
  getActivityImpact,
  type ImpactSlicing,
  listedDimensions,
  mealOccurrences,
} from './activity-impact.ts'
import { BIN_MINUTES, binSeries } from './impact.ts'
import { benjaminiHochberg } from './stats.ts'

const rawPoints = vi.fn<(user: string, metric: string) => Promise<[Date, number][]>>()

vi.mock('../../db', () => ({
  expandActivityTypes: vi.fn(),
  getActivityTypeDefinitions: vi.fn(),
  getBinnedTimeSeries: vi.fn(),
  getEffectiveActivitiesInRange: vi.fn(),
  getMealFlagsInRange: vi.fn(),
  getMealLogCompletedInRange: vi.fn(),
  getProductivity: vi.fn(),
  listSensitivityFlags: vi.fn(),
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
    vi.mocked(db.getActivityTypeDefinitions).mockResolvedValue([])
    vi.mocked(db.getBinnedTimeSeries).mockImplementation(async (user, metric, _start, _end, binMinutes) =>
      binSeries(await rawPoints(user, metric), binMinutes),
    )
  })

  test('returns HRV timeline for tag activity', async () => {
    const baseTime = new Date('2024-01-15T12:00:00Z')

    rawPoints.mockResolvedValue([
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
    rawPoints.mockResolvedValue([])
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([])

    const result = await getActivityImpact('testuser', 'nonexistent', 'tag', 30, 90)

    expect(result.occurrences).toBe(0)
    expect(result.avg_duration_min).toBe(0)
  })

  test('an explicit since starts the range exactly there', async () => {
    rawPoints.mockResolvedValue([])
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([])
    const since = new Date('2026-03-01T00:00:00+01:00')
    const until = new Date('2026-04-01T00:00:00+02:00')

    await getActivityImpact('testuser', 'coffee', 'tag', 30, 31, undefined, until, since)

    expect(db.getBinnedTimeSeries).toHaveBeenCalledWith(
      'testuser',
      'hrv_rmssd',
      new Date(since.getTime() - 30 * 60_000),
      new Date(until.getTime() - 1 + 30 * 60_000),
      BIN_MINUTES,
    )
    expect(db.getEffectiveActivitiesInRange).toHaveBeenCalledWith(
      'testuser',
      since,
      new Date(until.getTime() - 1),
    )
  })

  test('without since, the range reaches periodDays back from until', async () => {
    rawPoints.mockResolvedValue([])
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([])
    const until = new Date('2026-04-01T00:00:00Z')

    await getActivityImpact('testuser', 'coffee', 'tag', 30, 31, undefined, until)

    expect(db.getBinnedTimeSeries).toHaveBeenCalledWith(
      'testuser',
      'hrv_rmssd',
      new Date('2026-02-28T23:30:00Z'),
      new Date(until.getTime() - 1 + 30 * 60_000),
      BIN_MINUTES,
    )
  })

  test('handles productivity category activity type', async () => {
    const baseTime = new Date('2024-01-15T12:00:00Z')

    rawPoints.mockResolvedValue([])
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
    rawPoints.mockResolvedValue([])
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
    rawPoints.mockResolvedValue([])
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
    rawPoints.mockImplementation(async (_u: string, metric: string) =>
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
    rawPoints.mockResolvedValue([])
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([])
    const since = new Date('2026-03-01T00:00:00Z')
    const until = new Date('2026-04-01T00:00:00Z')

    await getActivityImpact('testuser', 'yoga', 'activity_type', 240, 31, undefined, until, since)

    for (const metric of ['hrv_rmssd', 'heart_rate', 'stress_level']) {
      expect(db.getBinnedTimeSeries).toHaveBeenCalledWith(
        'testuser',
        metric,
        new Date('2026-02-28T20:00:00Z'),
        new Date(until.getTime() - 1 + 240 * 60_000),
        BIN_MINUTES,
      )
    }
  })

  test('the timeline lists the buckets in time order for the chosen window', async () => {
    const base = new Date('2024-01-15T12:00:00Z')
    rawPoints.mockImplementation(async (_u: string, metric: string) =>
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
    rawPoints.mockImplementation(async (_u: string, metric: string) =>
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
    rawPoints.mockResolvedValue([])
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
    rawPoints.mockImplementation(async (_u: string, metric: string) =>
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

  test('adjusts the whole and every group over one family', async () => {
    const short = [-20, -18, -21, -19]
    const long = [1, -2, 2, -1]
    rawPoints.mockImplementation(async (_u: string, metric: string) =>
      metric === 'stress_level'
        ? ([
            ...short.flatMap((diff, i) => [
              [mins(day(2 + i), -20), 50],
              [mins(day(2 + i), 20), 50 + diff],
            ]),
            ...long.flatMap((diff, i) => [
              [mins(day(10 + i), -20), 50],
              [mins(day(10 + i), 70), 50 + diff],
            ]),
          ] as [Date, number][])
        : [],
    )
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
      ...short.map((_, i) => yoga(day(2 + i), 10)),
      ...long.map((_, i) => yoga(day(10 + i), 60)),
    ])

    const result = await impact({ breakdown: 'duration' })
    const effects = [result.stress_effect, ...result.breakdown!.groups.map((g) => g.stress_effect)]

    expect(result.comparisons).toBe(3)
    expect(effects.map((e) => e.p_value_adjusted)).toEqual(
      benjaminiHochberg(effects.map((e) => e.p_value!)).map((p) => Math.round(p * 10_000) / 10_000),
    )
    expect(result.hrv_effect.p_value_adjusted).toBeNull()
  })

  test('a duration filter keeps the short session, still clipped by the long one it drops', async () => {
    rawPoints.mockImplementation(async (_u: string, metric: string) =>
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

  const inRange = (activities: MergedActivity[]) =>
    vi
      .mocked(db.getEffectiveActivitiesInRange)
      .mockImplementation(async (_u, start, end) =>
        activities.filter((a) => a.start_time >= start && a.start_time <= end),
      )

  test('a sleep filter drops a session followed by a nap, sleeps read over an extended range', async () => {
    const nap: MergedActivity = {
      activity_type: 'nap',
      end_time: mins(day(15), 90),
      source: 'manual' as const,
      start_time: mins(day(15), 40),
    }
    inRange([yoga(mins(since, -120), 30), yoga(day(15), 30), nap, yoga(day(16), 30)])

    const result = await impact({ filters: [{ dimension: 'sleep', keys: ['none'] }] })

    expect(result.total_occurrences).toBe(2)
    expect(result.occurrences).toBe(1)
    expect(db.getEffectiveActivitiesInRange).toHaveBeenCalledTimes(2)
    expect(db.getEffectiveActivitiesInRange).toHaveBeenCalledWith(
      'testuser',
      since,
      new Date(until.getTime() - 1),
    )
    expect(db.getEffectiveActivitiesInRange).toHaveBeenCalledWith(
      'testuser',
      new Date(since.getTime() - 30 * 60_000 - 86_400_000),
      new Date(until.getTime() - 1 + 30 * 60_000),
    )
    expect(db.expandActivityTypes).toHaveBeenCalledWith('testuser', ['sleep', 'nap'])
  })

  test('a merge group straddling the start of the period counts the same with or without sleep', async () => {
    const inside = yoga(mins(since, 5), 30)
    const straddling = { ...yoga(mins(since, -10), 45), source: 'garmin' as const }
    vi.mocked(db.getEffectiveActivitiesInRange).mockImplementation(async (_u, start) =>
      start < since ? [straddling, yoga(day(16), 30)] : [inside, yoga(day(16), 30)],
    )

    const plain = await impact({})
    const withSleep = await impact({ breakdown: 'sleep' })

    expect(plain.total_occurrences).toBe(2)
    expect(withSleep.total_occurrences).toBe(plain.total_occurrences)
    expect(withSleep.breakdown?.groups.reduce((sum, g) => sum + g.occurrences, 0)).toBe(2)
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

  describe('a parent type counts its subtypes', () => {
    const run = (type: string, start: Date, minutes = 30): MergedActivity => ({
      activity_type: type,
      end_time: mins(start, minutes),
      source: 'manual' as const,
      start_time: start,
    })
    const exact = (activity: string, slicing: ImpactSlicing = {}) =>
      getActivityImpact(
        'testuser',
        activity,
        'activity_type',
        30,
        31,
        undefined,
        until,
        since,
        'exact',
        [],
        slicing,
      )

    beforeEach(() => {
      vi.mocked(db.getActivityTypeDefinitions).mockResolvedValue([
        { display_name: 'Running', name: 'running' } as ActivityTypeDefinition,
        {
          display_name: 'Trail running',
          name: 'trail_running',
          parent_type: 'running',
        } as ActivityTypeDefinition,
      ])
    })

    test("match 'exact' on the parent includes subtype occurrences, a subtype request not the parent's", async () => {
      vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
        run('running', day(10)),
        run('trail_running', day(11)),
        run('trail_running', day(12)),
      ])

      expect((await exact('running')).occurrences).toBe(3)
      expect((await exact('trail_running')).occurrences).toBe(2)
      expect(db.getActivityTypeDefinitions).toHaveBeenCalledTimes(2)
    })

    test('a type breakdown splits the parent by subtype, with display names', async () => {
      vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
        run('running', day(10)),
        run('trail_running', day(11)),
        run('trail_running', day(12)),
      ])

      const result = await exact('running', { breakdown: 'type', includeDimensions: true })

      expect(result.breakdown?.groups.map((g) => [g.key, g.label, g.occurrences])).toEqual([
        ['trail_running', 'Trail running', 2],
        ['running', 'Running', 1],
      ])
      expect(result.dimensions?.map((d) => d.dimension)).toEqual(['duration', 'time_of_day', 'sleep', 'type'])
    })

    test('a one-type split is not listed but a type filter or breakdown still works', async () => {
      vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
        run('trail_running', day(11)),
        run('trail_running', day(12)),
      ])

      const listed = await exact('running', { includeDimensions: true })
      expect(listed.dimensions?.map((d) => d.dimension)).toEqual(['duration', 'time_of_day', 'sleep'])

      const filtered = await exact('running', {
        breakdown: 'type',
        filters: [{ dimension: 'type', keys: ['trail_running'] }],
      })
      expect(filtered.occurrences).toBe(2)
      expect(filtered.breakdown?.groups.map((g) => g.key)).toEqual(['trail_running'])
    })

    test('analysing sleep, a subtype of sleep is the analysed activity, not sleep around it', async () => {
      vi.mocked(db.getActivityTypeDefinitions).mockResolvedValue([
        { display_name: 'Sleep', name: 'sleep' } as ActivityTypeDefinition,
        { display_name: 'Nap', name: 'nap', parent_type: 'sleep' } as ActivityTypeDefinition,
      ])
      vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
        run('sleep', day(10), 60),
        run('nap', mins(day(10), 75), 20),
      ])

      const result = await exact('sleep', { breakdown: 'sleep' })

      expect(result.total_occurrences).toBe(2)
      expect(result.breakdown?.groups.map((g) => [g.key, g.occurrences])).toEqual([['none', 2]])
    })
  })

  test('a year breakdown uses the local year and lists only when there are two', async () => {
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
      yoga(new Date('2023-12-31T23:30:00Z'), 20),
      yoga(day(15), 20),
    ])
    const wide = (slicing: ImpactSlicing) =>
      getActivityImpact(
        'testuser',
        'yoga',
        'activity_type',
        30,
        3650,
        undefined,
        until,
        new Date('2023-12-01T00:00:00Z'),
        'contains',
        [],
        slicing,
      )

    const utc = await wide({ breakdown: 'year', includeDimensions: true })
    expect(utc.breakdown?.groups.map((g) => [g.key, g.occurrences])).toEqual([
      ['2023', 1],
      ['2024', 1],
    ])
    expect(utc.dimensions?.map((d) => d.dimension)).toContain('year')
    expect(settings.getUserTimezone).toHaveBeenCalledWith('testuser')

    const stockholm = await wide({ breakdown: 'year', includeDimensions: true, tz: 'Europe/Stockholm' })
    expect(stockholm.breakdown?.groups.map((g) => [g.key, g.occurrences])).toEqual([['2024', 2]])
    expect(stockholm.dimensions?.map((d) => d.dimension)).not.toContain('year')
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

describe('listedDimensions', () => {
  test('type only for activities and tags, year for every kind', () => {
    const all = ['duration', 'time_of_day', 'sleep', 'type', 'year']
    expect(listedDimensions('activity_type', undefined)).toEqual(all)
    expect(listedDimensions('tag', undefined)).toEqual(all)
    for (const kind of ['location', 'productivity_category', 'productivity_app'] as const) {
      expect(listedDimensions(kind, undefined)).toEqual(['duration', 'time_of_day', 'sleep', 'year'])
    }
  })
})

describe('meal_sensitivity impact', () => {
  const since = new Date('2024-01-01T00:00:00Z')
  const until = new Date('2024-02-01T00:00:00Z')
  const GLUTEN = 'flag-gluten'
  const at = (iso: string) => new Date(iso)
  const meal = (iso: string, flag_ids: string[]) => ({ flag_ids, id: iso, time: at(iso) })
  const meals = [
    meal('2024-01-10T08:00:00Z', [GLUTEN]),
    meal('2024-01-10T12:00:00Z', []),
    meal('2024-01-11T12:00:00Z', []),
    meal('2024-01-12T08:00:00Z', [GLUTEN]),
    meal('2024-01-12T18:00:00Z', ['flag-dairy']),
  ]
  const impact = (slicing: ImpactSlicing = {}) =>
    getActivityImpact(
      'testuser',
      GLUTEN,
      'meal_sensitivity',
      30,
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
    vi.mocked(db.getBinnedTimeSeries).mockImplementation(async (user, metric, _start, _end, binMinutes) =>
      binSeries(await rawPoints(user, metric), binMinutes),
    )
    vi.mocked(db.getMealFlagsInRange).mockResolvedValue(meals)
    vi.mocked(db.getMealLogCompletedInRange).mockResolvedValue(['2024-01-10', '2024-01-12'])
    vi.mocked(db.listSensitivityFlags).mockResolvedValue([
      { created_at: since, id: GLUTEN, name: 'gluten', sort_order: 0, updated_at: since },
    ])
    vi.mocked(db.expandActivityTypes).mockResolvedValue(['sleep', 'nap'])
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([])
    vi.mocked(settings.getUserTimezone).mockResolvedValue('UTC')
  })

  test('mealOccurrences: flagged meals, and unflagged meals only on completed days as the comparison', () => {
    const { comparison, flagged } = mealOccurrences(meals, GLUTEN, ['2024-01-10', '2024-01-12'], 'UTC')
    const t = (iso: string) => at(iso).getTime()
    expect(flagged).toEqual([
      { end: t('2024-01-10T08:00:00Z'), start: t('2024-01-10T08:00:00Z') },
      { end: t('2024-01-12T08:00:00Z'), start: t('2024-01-12T08:00:00Z') },
    ])
    expect(comparison.map((o) => o.start)).toEqual([t('2024-01-10T12:00:00Z'), t('2024-01-12T18:00:00Z')])
  })

  test('the completed day is the meal time in the given timezone', () => {
    const late = [meal('2024-01-11T23:30:00Z', [])]
    expect(mealOccurrences(late, GLUTEN, ['2024-01-12'], 'Europe/Stockholm').comparison).toHaveLength(1)
    expect(mealOccurrences(late, GLUTEN, ['2024-01-12'], 'UTC').comparison).toHaveLength(0)
  })

  test('each flagged meal is a point session; the comparison and the flag name come along', async () => {
    rawPoints.mockResolvedValue([])
    const result = await impact()

    expect(result.activity).toBe('gluten')
    expect(result.activity_type).toBe('meal_sensitivity')
    expect(result.occurrences).toBe(2)
    expect(result.avg_duration_min).toBe(5)
    expect(result.comparison?.occurrences).toBe(2)
    expect(result.comparison?.timeline).toHaveLength(result.timeline.length)
    expect(db.getEffectiveActivitiesInRange).not.toHaveBeenCalled()
  })

  test("the comparison's effects join the p-value family", async () => {
    const around = (iso: string, before: number, after: number): [Date, number][] =>
      [-25, -20, -15, -10]
        .map((m): [Date, number] => [new Date(at(iso).getTime() + m * 60_000), before])
        .concat(
          [10, 15, 20, 25].map((m): [Date, number] => [new Date(at(iso).getTime() + m * 60_000), after]),
        )
    vi.mocked(db.getMealFlagsInRange).mockResolvedValue(
      [1, 2, 3, 4, 5, 6].flatMap((d) => [
        meal(`2024-01-1${d}T08:00:00Z`, [GLUTEN]),
        meal(`2024-01-1${d}T12:00:00Z`, []),
      ]),
    )
    vi.mocked(db.getMealLogCompletedInRange).mockResolvedValue([1, 2, 3, 4, 5, 6].map((d) => `2024-01-1${d}`))
    rawPoints.mockImplementation(async (_u, metric) =>
      metric === 'stress_level'
        ? [1, 2, 3, 4, 5, 6].flatMap((d) => [
            ...around(`2024-01-1${d}T08:00:00Z`, 30, 40 + d),
            ...around(`2024-01-1${d}T12:00:00Z`, 30, 30 + d),
          ])
        : [],
    )

    const result = await impact()

    expect(result.comparisons).toBe(2)
    expect(result.stress_effect.p_value_adjusted).not.toBeNull()
    expect(result.comparison?.stress_effect.p_value_adjusted).not.toBeNull()
  })

  test('lists only the time-of-day, sleep and year dimensions, year only with two years or more', async () => {
    rawPoints.mockResolvedValue([])
    const result = await impact({ includeDimensions: true })
    expect(result.dimensions?.map((d) => d.dimension)).toEqual(['time_of_day', 'sleep'])
    expect(listedDimensions('meal_sensitivity', undefined)).toEqual(['time_of_day', 'sleep', 'year'])
  })
})
