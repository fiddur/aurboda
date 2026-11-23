import type { ActivitySessionGroup, StrengthScore, StrengthScoreLift } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { filterItemGroups, groupPoints, pointsByExercise, sortItemGroups } from './itemGroups'

const group = (
  value: ActivitySessionGroup['value'],
  extra: Partial<ActivitySessionGroup> = {},
): ActivitySessionGroup => ({
  avg_hr_count: 0,
  count: 1,
  first_start_time: '2026-09-01T07:00:00.000Z',
  last_start_time: '2026-09-01T07:00:00.000Z',
  session_ids: [],
  value,
  ...extra,
})

const bench = group('Bench Press', {
  count: 10,
  last_start_time: '2026-09-20T07:00:00.000Z',
  measures: { e1rm: 102.5, max_weight: 90, volume: 9000 },
})
const squat = group('squat', {
  count: 4,
  last_start_time: '2026-09-25T07:00:00.000Z',
  measures: { e1rm: 140, max_weight: 120, volume: 12000 },
})
const plank = group('Plank', {
  count: 6,
  last_start_time: '2026-09-10T07:00:00.000Z',
  measures: { max_time: 90, set_count: 12 },
})
const none = group(null, { count: 20, last_start_time: '2026-09-30T07:00:00.000Z' })
const groups = [bench, none, squat, plank]

const values = (gs: ActivitySessionGroup[]) => gs.map((g) => g.value)

describe('sortItemGroups', () => {
  test('recently done first, the no-value group last', () => {
    expect(values(sortItemGroups(groups, 'recent'))).toEqual(['squat', 'Bench Press', 'Plank', null])
  })

  test('most done', () => {
    expect(values(sortItemGroups(groups, 'count'))).toEqual(['Bench Press', 'Plank', 'squat', null])
  })

  test('measures descending, groups without the measure after those with it', () => {
    expect(values(sortItemGroups(groups, 'e1rm'))).toEqual(['squat', 'Bench Press', 'Plank', null])
    expect(values(sortItemGroups(groups, 'max_weight'))).toEqual(['squat', 'Bench Press', 'Plank', null])
    expect(values(sortItemGroups(groups, 'volume'))).toEqual(['squat', 'Bench Press', 'Plank', null])
  })

  test('name ascending, ignoring case', () => {
    expect(values(sortItemGroups(groups, 'name'))).toEqual(['Bench Press', 'Plank', 'squat', null])
  })

  test('does not mutate its input', () => {
    sortItemGroups(groups, 'name')
    expect(values(groups)).toEqual(['Bench Press', null, 'squat', 'Plank'])
  })
})

describe('filterItemGroups', () => {
  test('keeps every group while the query is blank', () => {
    expect(filterItemGroups(groups, '')).toBe(groups)
    expect(filterItemGroups(groups, '   ')).toBe(groups)
  })

  test('matches a substring of the value, ignoring case, and hides the no-value group', () => {
    expect(values(filterItemGroups(groups, 'PRESS'))).toEqual(['Bench Press'])
    expect(values(filterItemGroups(groups, 'S'))).toEqual(['Bench Press', 'squat'])
  })

  test('matches nothing', () => {
    expect(filterItemGroups(groups, 'deadlift')).toEqual([])
  })
})

const lift = (value: string | undefined, score: number | null): StrengthScoreLift => ({
  best:
    value === undefined
      ? undefined
      : {
          activity_type: 'strength_training',
          catalog_key: value.toLowerCase(),
          e1rm: 100,
          reps: 5,
          session_id: 's1',
          start_time: '2026-09-01T07:00:00.000Z',
          value,
          weight: 85,
        },
  catalog_keys: [],
  counted: true,
  lift: value ?? 'none',
  name: value ?? 'None',
  score,
})

const score = (...lifts: StrengthScoreLift[][]): StrengthScore => ({
  at: '2026-09-30T07:00:00.000Z',
  field: 'sets.exercise',
  groups: lifts.map((ls) => ({ group: 'chest', lifts: ls, muscle_groups: [], name: 'Chest', score: null })),
  missing: [],
  score: null,
  window_days: 90,
})

describe('pointsByExercise', () => {
  test('points by exercise, trimmed and lowercased, the highest of several lifts', () => {
    const points = pointsByExercise(
      score([lift('Bench Press', 80), lift(' Squat ', 95)], [lift('bench press', 92), lift('Dips', 60)]),
    )
    expect([...points]).toEqual([
      ['bench press', 92],
      ['squat', 95],
      ['dips', 60],
    ])
  })

  test('lifts without a best set or a score count for nothing', () => {
    expect(pointsByExercise(score([lift(undefined, null), lift('Bench Press', null)])).size).toBe(0)
  })

  test('no score at all', () => {
    expect(pointsByExercise(null).size).toBe(0)
    expect(pointsByExercise(undefined).size).toBe(0)
  })
})

describe('points', () => {
  const points = pointsByExercise(score([lift('bench press', 80), lift('SQUAT', 95)]))

  test('a row gets the points of its exercise, ignoring case; none for the no-value group', () => {
    expect(groupPoints(bench, points)).toBe(80)
    expect(groupPoints(squat, points)).toBe(95)
    expect(groupPoints(plank, points)).toBeUndefined()
    expect(groupPoints(none, points)).toBeUndefined()
    expect(groupPoints(bench, undefined)).toBeUndefined()
  })

  test('sorts by points descending, rows without points after those with them', () => {
    expect(values(sortItemGroups(groups, 'points', points))).toEqual(['squat', 'Bench Press', 'Plank', null])
    expect(values(sortItemGroups([plank, bench, squat], 'points', new Map([['bench press', 50]])))).toEqual([
      'Bench Press',
      'Plank',
      'squat',
    ])
  })
})
