import type { PersonActivitiesResponse } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { activitiesHeading, activityPages, activityWhen, typeChips } from './person-activities-view'

const page = (ids: string[], next_cursor?: string): PersonActivitiesResponse => ({
  data: ids.map((id) => ({ activity_type: 'walking', id, start_time: '2026-11-01T10:00:00Z' })),
  ...(next_cursor ? { next_cursor } : {}),
  success: true,
  total: 3,
})

describe('activitiesHeading', () => {
  test('carries the count, locale-formatted', () => {
    expect(activitiesHeading(1450, 'en-US')).toBe('Activities together (1,450)')
    expect(activitiesHeading(7, 'en-US')).toBe('Activities together (7)')
  })

  test('has no count when there are none', () => {
    expect(activitiesHeading(0, 'en-US')).toBe('Activities together')
  })
})

describe('typeChips', () => {
  const types = [
    { activity_type: 'walking', count: 80, type_name: 'Walking' },
    { activity_type: 'yoga', count: 30, type_name: 'Yoga' },
  ]

  test('offers All and each type, one active', () => {
    expect(typeChips(types, 'yoga')).toEqual([
      { active: false, label: 'All', type: null },
      { active: false, label: 'Walking (80)', type: 'walking' },
      { active: true, label: 'Yoga (30)', type: 'yoga' },
    ])
    expect(typeChips(types, null)[0]!.active).toBe(true)
  })

  test('offers nothing for a single type', () => {
    expect(typeChips(types.slice(0, 1), null)).toEqual([])
    expect(typeChips([], null)).toEqual([])
  })
})

describe('activityPages', () => {
  test('appends the pages and has more until the last page', () => {
    const first = activityPages([page(['a', 'b'], 'c1')])
    expect(first).toMatchObject({ hasMore: true, total: 3 })
    const all = activityPages([page(['a', 'b'], 'c1'), page(['c'])])
    expect(all.activities.map((a) => a.id)).toEqual(['a', 'b', 'c'])
    expect(all.hasMore).toBe(false)
  })

  test('has nothing before the first page arrives', () => {
    expect(activityPages([])).toEqual({ activities: [], hasMore: false, total: undefined })
  })
})

describe('activityWhen', () => {
  const now = new Date(2026, 10, 22, 12)

  test('leaves out the year of this year', () => {
    expect(activityWhen(new Date(2026, 2, 3, 9, 5), now)).toBe('Tue 3 Mar, 09:05')
  })

  test('shows the year of another year', () => {
    expect(activityWhen(new Date(2024, 2, 3, 9, 5), now)).toBe('Sun 3 Mar 2024, 09:05')
  })
})
