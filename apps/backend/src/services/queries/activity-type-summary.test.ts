import type { ActivityTypeDefinition } from '@aurboda/api-spec'

import { describe, expect, test, vi } from 'vitest'

import type { MergedActivity } from '../../db/types.ts'

import { type ActivityTypeSummaryDeps, getActivityTypeSummary } from './activity-type-summary.ts'

const activity = (
  start: string,
  minutes: number,
  data: Record<string, unknown> = {},
  activity_type = 'running',
): MergedActivity => ({
  activity_type,
  data,
  end_time: new Date(new Date(start).getTime() + minutes * 60000),
  source: 'garmin',
  start_time: new Date(start),
})

const categoryMap = new Map([['running', 'exercise']])

const deps = (
  activities: MergedActivity[],
  types: string[] = ['running'],
  displayName?: string,
): ActivityTypeSummaryDeps => ({
  buildCategoryMap: vi.fn().mockResolvedValue(categoryMap),
  expandActivityTypes: vi.fn().mockResolvedValue(types),
  getActivities: vi.fn().mockResolvedValue(activities),
  getActivityTypeDefinition: vi
    .fn()
    .mockResolvedValue(
      displayName === undefined ? null : ({ display_name: displayName } as ActivityTypeDefinition),
    ),
})

const range = { end: '2026-10-31T23:59:59.999Z', start: '2026-10-01T00:00:00.000Z' }

describe('getActivityTypeSummary', () => {
  test('counts the sessions and their duration over the range', async () => {
    const d = deps([activity('2026-10-02T07:00:00Z', 30), activity('2026-10-05T07:00:00Z', 45)])

    const summary = await getActivityTypeSummary('u', 'running', range, d)

    expect(summary).toMatchObject({ count: 2, total_minutes: 75 })
    expect(d.getActivities).toHaveBeenCalledWith(
      'u',
      ['running'],
      new Date(range.start),
      new Date(range.end),
      undefined,
      undefined,
      categoryMap,
    )
  })

  test('expands the type once and queries the expanded types as they are', async () => {
    const d = deps([], ['exercise', 'running', 'yoga'])

    await getActivityTypeSummary('u', 'exercise', range, d)

    expect(d.expandActivityTypes).toHaveBeenCalledTimes(1)
    expect(d.expandActivityTypes).toHaveBeenCalledWith('u', ['exercise'])
    expect(d.getActivities).toHaveBeenCalledTimes(1)
    expect(vi.mocked(d.getActivities).mock.calls[0]?.[1]).toEqual(['exercise', 'running', 'yoga'])
  })

  test('counts an open-ended session with zero minutes', async () => {
    const open: MergedActivity = {
      activity_type: 'running',
      source: 'garmin',
      start_time: new Date('2026-10-02T07:00:00Z'),
    }

    const summary = await getActivityTypeSummary(
      'u',
      'running',
      range,
      deps([open, activity('2026-10-05T07:00:00Z', 45)]),
    )

    expect(summary).toMatchObject({ count: 2, total_minutes: 45 })
  })

  test('sums distance and finds the best pace and the average speed', async () => {
    const summary = await getActivityTypeSummary(
      'u',
      'running',
      range,
      deps([
        activity('2026-10-02T07:00:00Z', 30, { distance: 5000 }),
        activity('2026-10-05T07:00:00Z', 60, { distance: 10000 }),
        activity('2026-10-07T07:00:00Z', 20),
      ]),
    )

    expect(summary).toMatchObject({
      avg_speed_kmh: 10,
      best_pace_sec_per_km: 360,
      count: 3,
      distance_km: 15,
      total_minutes: 110,
    })
  })

  test('leaves the distance figures null when no session has a distance', async () => {
    const summary = await getActivityTypeSummary(
      'u',
      'yoga',
      range,
      deps([activity('2026-10-02T07:00:00Z', 30)]),
    )

    expect(summary).toMatchObject({ avg_speed_kmh: null, best_pace_sec_per_km: null, distance_km: null })
    expect(summary.sleep).toBeNull()
  })

  test('keeps only the sessions matching a field filter', async () => {
    const summary = await getActivityTypeSummary(
      'u',
      'running',
      { ...range, filter_field: 'run_kind', filter_value: 'intervals' },
      deps([
        activity('2026-10-02T07:00:00Z', 30, { run_kind: 'intervals' }),
        activity('2026-10-05T07:00:00Z', 60, { run_kind: 'long' }),
      ]),
    )

    expect(summary).toMatchObject({ count: 1, total_minutes: 30 })
  })

  test('keeps the sessions with an item matching an item-path filter', async () => {
    const summary = await getActivityTypeSummary(
      'u',
      'strength_training',
      { ...range, filter_field: 'sets.exercise', filter_value: 'bench press' },
      deps([
        activity('2026-10-02T07:00:00Z', 50, {
          sets: [{ exercise: 'Squat' }, { exercise: 'Bench Press' }],
        }),
        activity('2026-10-05T07:00:00Z', 40, { sets: [{ exercise: 'Squat' }] }),
      ]),
    )

    expect(summary).toMatchObject({ count: 1, total_minutes: 50 })
  })

  test('averages the nights and their stages for sleep', async () => {
    const stages = (start: string, deepMin: number) => {
      const t = new Date(start).getTime()
      const at = (min: number) => new Date(t + min * 60000).toISOString()
      return [
        { endTime: at(15), stage: 1, startTime: at(0) },
        { endTime: at(15 + 120), stage: 4, startTime: at(15) },
        { endTime: at(135 + deepMin), stage: 5, startTime: at(135) },
        { endTime: at(135 + deepMin + 90), stage: 6, startTime: at(135 + deepMin) },
      ]
    }
    const summary = await getActivityTypeSummary(
      'u',
      'sleep',
      range,
      deps(
        [
          activity('2026-10-01T23:00:00Z', 420, { stages: stages('2026-10-01T23:00:00Z', 90) }, 'sleep'),
          activity('2026-10-02T23:00:00Z', 480, { stages: stages('2026-10-02T23:00:00Z', 61) }, 'sleep'),
          activity('2026-10-03T23:00:00Z', 450, {}, 'sleep'),
        ],
        ['sleep'],
        'Sleep',
      ),
    )

    expect(summary.activity_type_name).toBe('Sleep')
    expect(summary.sleep).toEqual({
      avg_minutes: 450,
      avg_stages: { awake_min: 15, deep_min: 76, light_min: 120, rem_min: 90 },
      best_night_minutes: 480,
    })
  })

  test('has no stage averages when no night has stages', async () => {
    const summary = await getActivityTypeSummary(
      'u',
      'sleep',
      range,
      deps([activity('2026-10-01T23:00:00Z', 420, {}, 'sleep')], ['sleep']),
    )

    expect(summary.sleep).toEqual({ avg_minutes: 420, avg_stages: null, best_night_minutes: 420 })
  })

  test('has no sleep figures for sleep without nights', async () => {
    const summary = await getActivityTypeSummary('u', 'sleep', range, deps([], ['sleep']))

    expect(summary).toMatchObject({ count: 0, sleep: null, total_minutes: 0 })
  })

  test('falls back to the type name without a display name', async () => {
    const summary = await getActivityTypeSummary('u', 'running', range, deps([]))

    expect(summary.activity_type_name).toBe('running')
  })
})
