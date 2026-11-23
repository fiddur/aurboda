import type { ActivitySessionGroup } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { filterItemGroups, sortItemGroups } from './itemGroups'

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

describe('sortItemGroups by best set and points', () => {
  const heavy = group('Heavy', { best_set: { reps: 3, weight: 100 } })
  const heavier = group('Heavier', { best_set: { reps: 5, weight: 100 } })
  const light = group('Light', { best_set: { reps: 12, weight: 40 } })
  const bodyweight = group('Bodyweight')

  test('best set by weight, then reps, sets missing last', () => {
    expect(values(sortItemGroups([bodyweight, light, heavy, none, heavier], 'best_set'))).toEqual([
      'Heavier',
      'Heavy',
      'Light',
      'Bodyweight',
      null,
    ])
  })

  test('points from the given lookup, highest first, none last', () => {
    const points: Record<string, number> = { Heavy: 80, Light: 95 }
    const pointsOf = (g: ActivitySessionGroup) => points[String(g.value)]
    expect(values(sortItemGroups([bodyweight, heavy, none, light], 'points', pointsOf))).toEqual([
      'Light',
      'Heavy',
      'Bodyweight',
      null,
    ])
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
