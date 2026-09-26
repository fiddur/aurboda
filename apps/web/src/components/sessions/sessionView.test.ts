import type { ActivitySession, ActivitySessionGroup } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  categoricalFields,
  categoricalValues,
  fieldLabel,
  formatMinutes,
  groupDurationLabel,
  groupDurationRange,
  groupHardMinutes,
  hardMinutes,
  hrDomain,
  isSameSession,
  sessionLabel,
  sortGroups,
  sortSessions,
} from './sessionView'

const zones = (z3: number, z5 = 0) => ({ 0: 60, 1: 60, 2: 60, 3: z3, 4: 0, 5: z5 })

const session = (id: string, start: string, extra: Partial<ActivitySession> = {}): ActivitySession => ({
  activity_type: 'yoga',
  fields: {},
  id,
  start_time: start,
  ...extra,
})

const group = (
  value: ActivitySessionGroup['value'],
  extra: Partial<ActivitySessionGroup> = {},
): ActivitySessionGroup => ({
  count: 1,
  first_start_time: '2026-09-01T07:00:00.000Z',
  last_start_time: '2026-09-01T07:00:00.000Z',
  session_ids: [],
  value,
  ...extra,
})

const nameField = { is_categorical: true, name: 'session_name', type: 'string' as const }

describe('schema helpers', () => {
  test('categorical fields, labels and values', () => {
    const schema = { fields: [nameField, { name: 'props', type: 'boolean' as const }] }
    expect(categoricalFields(schema)).toEqual([nameField])
    expect(categoricalFields(undefined)).toEqual([])
    expect(fieldLabel(nameField)).toBe('Session name')
    expect(fieldLabel({ label: 'Video', name: 'session_name' })).toBe('Video')

    const kind = { is_categorical: true, name: 'kind', type: 'string' as const }
    const count = { is_categorical: true, name: 'round', type: 'number' as const }
    expect(
      categoricalValues([nameField, kind, count], { kind: '  ', round: 3, session_name: ' Flow ' }),
    ).toEqual([
      { field: nameField, value: 'Flow' },
      { field: count, value: '3' },
    ])
    expect(categoricalValues([nameField], undefined)).toEqual([])
  })
})

describe('formatting', () => {
  test('minutes and group lengths', () => {
    expect(formatMinutes(26)).toBe('26 min')
    expect(formatMinutes(60)).toBe('1 h')
    expect(formatMinutes(75.4)).toBe('1 h 15 min')
    expect(groupDurationLabel(group('a', { duration_max: 30, duration_median: 26, duration_min: 20 }))).toBe(
      '26 min (20–30)',
    )
    expect(groupDurationLabel(group('a', { duration_max: 26, duration_median: 26, duration_min: 26 }))).toBe(
      '26 min',
    )
    expect(groupDurationLabel(group('a'))).toBeUndefined()
    expect(groupDurationRange(group('a', { duration_max: 30, duration_min: 20 }))).toBe('20–30')
    expect(groupDurationRange(group('a', { duration_max: 26, duration_min: 26 }))).toBeUndefined()
  })

  test('hard minutes are zone 3 and up', () => {
    expect(hardMinutes(zones(90, 30))).toBe(2)
    expect(hardMinutes(undefined)).toBeUndefined()
    expect(groupHardMinutes(group('a', { count: 3, hr_zone_secs: zones(540) }))).toBe(3)
  })

  test('a session is known by its categorical values, else its title', () => {
    expect(
      sessionLabel(session('a', 'x', { fields: { session_name: 'Flow' }, title: 'Yoga' }), [nameField]),
    ).toBe('Flow')
    expect(sessionLabel(session('a', 'x', { title: 'Yoga' }), [nameField])).toBe('Yoga')
  })
})

describe('hrDomain', () => {
  test('spans every distribution, widened to tens', () => {
    const d = (min: number, max: number) => ({ max, median: min, min, q1: min, q3: max, sample_count: 1 })
    expect(hrDomain([d(63, 118), undefined, d(80, 160)])).toEqual([60, 170])
    expect(hrDomain([d(70, 100)])).toEqual([60, 110])
    expect(hrDomain([undefined])).toBeNull()
  })
})

describe('sorting', () => {
  const sessions = [
    session('a', '2026-09-01T07:00:00Z', { avg_hr: 90, duration: 40, hr_zone_secs: zones(0) }),
    session('b', '2026-09-03T07:00:00Z', { avg_hr: 120, duration: 26, hr_zone_secs: zones(600) }),
    session('c', '2026-09-02T07:00:00Z', { duration: 10 }),
  ]

  test('sessions by date, number columns, missing values last both ways', () => {
    expect(sortSessions(sessions, 'date').map((s) => s.id)).toEqual(['b', 'c', 'a'])
    expect(sortSessions(sessions, 'duration', false).map((s) => s.id)).toEqual(['c', 'b', 'a'])
    expect(sortSessions(sessions, 'avg_hr').map((s) => s.id)).toEqual(['b', 'a', 'c'])
    expect(sortSessions(sessions, 'avg_hr', false).map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(sortSessions(sessions, 'hard_minutes').map((s) => s.id)).toEqual(['b', 'a', 'c'])
  })

  test('groups: the no-value group stays last whatever the key; name ascends', () => {
    const groups = [
      group(null, { count: 9, last_start_time: '2026-09-09T00:00:00Z' }),
      group('Yin', {
        avg_hr_median: 80,
        count: 1,
        duration_median: 40,
        last_start_time: '2026-09-02T00:00:00Z',
      }),
      group('Flow', {
        avg_hr_median: 115,
        count: 3,
        duration_median: 26,
        hr_zone_secs: zones(300),
        last_start_time: '2026-09-05T00:00:00Z',
      }),
    ]
    expect(sortGroups(groups, 'recent').map((g) => g.value)).toEqual(['Flow', 'Yin', null])
    expect(sortGroups(groups, 'count').map((g) => g.value)).toEqual(['Flow', 'Yin', null])
    expect(sortGroups(groups, 'duration').map((g) => g.value)).toEqual(['Yin', 'Flow', null])
    expect(sortGroups(groups, 'avg_hr').map((g) => g.value)).toEqual(['Flow', 'Yin', null])
    expect(sortGroups(groups, 'hard_minutes').map((g) => g.value)).toEqual(['Flow', 'Yin', null])
    expect(sortGroups(groups, 'name').map((g) => g.value)).toEqual(['Flow', 'Yin', null])
  })
})

describe('isSameSession', () => {
  test('any start inside the session counts, so a merged session matches its later sources', () => {
    const s = session('merged:a', '2026-09-03T07:00:00.000Z', { end_time: '2026-09-03T07:26:05.000Z' })
    expect(isSameSession(s, new Date('2026-09-03T07:00:00Z'))).toBe(true)
    expect(isSameSession(s, new Date('2026-09-03T07:00:05Z'))).toBe(true)
    expect(isSameSession(s, new Date('2026-09-03T08:00:00Z'))).toBe(false)
  })
})
