import type { ActivitySessionGroup } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { sortItemGroups } from './itemGroups'

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
