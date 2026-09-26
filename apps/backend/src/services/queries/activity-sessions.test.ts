import type { ActivityTypeDefinition } from '@aurboda/api-spec'

import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { MergedActivity } from '../../db/types.ts'

import * as db from '../../db/index.ts'
import {
  buildSessions,
  fieldValue,
  groupKey,
  groupSessions,
  queryActivitySessions,
  sessionsOptionsFromQuery,
} from './activity-sessions.ts'

vi.mock('../../db', () => ({
  expandActivityTypes: vi.fn().mockImplementation((_user: string, types: string[]) => Promise.resolve(types)),
  getActivities: vi.fn(),
  getActivityTypeDefinitions: vi.fn(),
  getHrZoneSecsForWindows: vi.fn(),
  getValueHistogramsForWindows: vi.fn(),
  getUserSettings: vi.fn().mockResolvedValue(null),
}))

const at = (iso: string) => new Date(iso)

const activity = (
  id: string,
  startIso: string,
  minutes: number,
  data?: Record<string, unknown>,
  extra: Partial<MergedActivity> = {},
): MergedActivity => ({
  activity_type: 'yoga',
  data,
  end_time: new Date(at(startIso).getTime() + minutes * 60_000),
  id,
  source: 'garmin',
  start_time: at(startIso),
  ...extra,
})

const dist = (min: number, q1: number, median: number, q3: number, max: number, avg = median) => ({
  avg,
  max,
  median,
  min,
  q1,
  q3,
  sample_count: 10,
})

const zones = (z1: number, z2: number) => ({ 0: 0, 1: z1, 2: z2, 3: 0, 4: 0, 5: 0 })

const yogaDef: ActivityTypeDefinition = {
  aliases: [],
  color: '#000000',
  data_schema: {
    fields: [
      { is_categorical: true, name: 'session_name', type: 'string' },
      { name: 'props', type: 'boolean' },
    ],
  },
  display_category: 'exercise',
  display_name: 'Yoga',
  is_builtin: true,
  name: 'yoga',
  show_on_timeline: true,
}

describe('fieldValue', () => {
  test('keeps non-empty trimmed strings, finite numbers and booleans', () => {
    expect(fieldValue('  Flow ')).toBe('Flow')
    expect(fieldValue('   ')).toBeUndefined()
    expect(fieldValue(3)).toBe(3)
    expect(fieldValue(Number.NaN)).toBeUndefined()
    expect(fieldValue(false)).toBe(false)
    expect(fieldValue(null)).toBeUndefined()
    expect(fieldValue({ a: 1 })).toBeUndefined()
  })
})

describe('sessionsOptionsFromQuery', () => {
  test('maps dates, the group field and the (none) filter', () => {
    expect(
      sessionsOptionsFromQuery({
        filter_field: 'session_name',
        filter_value: '(none)',
        group_by: 'session_name',
        start: '2026-01-01T00:00:00Z',
      }),
    ).toEqual({
      end: undefined,
      filter: { field: 'session_name', value: null },
      groupBy: 'session_name',
      start: at('2026-01-01T00:00:00Z'),
    })
    expect(sessionsOptionsFromQuery({ filter_field: 'x', filter_value: 'a' }).filter).toEqual({
      field: 'x',
      value: 'a',
    })
  })
})

describe('buildSessions', () => {
  test('newest first, with schema fields, zones, and HR from data before samples', () => {
    const older = activity('a', '2026-09-01T07:00:00Z', 26, {
      average_hr: 120,
      max_hr: 160,
      props: true,
      session_name: 'Mobility Flow',
      unrelated: 'x',
    })
    const newer = activity(
      'b',
      '2026-09-02T07:00:00Z',
      40,
      { calories: 90, session_name: '' },
      { source_ids: ['b', 'c'] },
    )

    const sessions = buildSessions(
      [older, newer],
      ['session_name', 'props'],
      new Map([[older, zones(60, 120)]]),
      new Map([
        ['a', dist(80, 100, 110, 130, 170)],
        ['merged:b', dist(60, 70.04, 75.26, 80, 114, 76.4)],
      ]),
    )

    expect(sessions.map((s) => s.id)).toEqual(['merged:b', 'a'])
    expect(sessions[1]).toMatchObject({
      avg_hr: 120,
      duration: 26,
      fields: { props: true, session_name: 'Mobility Flow' },
      hr: { max: 170, median: 110, min: 80, q1: 100, q3: 130, sample_count: 10 },
      hr_zone_secs: zones(60, 120),
      max_hr: 160,
    })
    expect(sessions[0]).toMatchObject({
      avg_hr: 76,
      calories: 90,
      duration: 40,
      fields: {},
      hr: { median: 75.3, q1: 70 },
      max_hr: 114,
    })
    expect(sessions[0]!.hr_zone_secs).toBeUndefined()
  })

  test('an open-ended session has no duration and no HR, and a NULL title is omitted', () => {
    const [session] = buildSessions(
      [
        {
          ...activity('a', '2026-09-01T07:00:00Z', 0),
          end_time: undefined,
          title: null as unknown as string,
        },
      ],
      [],
      new Map(),
      new Map(),
    )
    expect(session).toMatchObject({ duration: undefined, hr: undefined, id: 'a' })
    expect(session).toHaveProperty('title', undefined)
  })
})

describe('groupSessions', () => {
  const sessions = buildSessions(
    [
      activity('1', '2026-09-01T07:00:00Z', 20, { average_hr: 100, max_hr: 130, session_name: 'Flow' }),
      activity('2', '2026-09-03T07:00:00Z', 30, { average_hr: 120, max_hr: 150, session_name: 'Flow' }),
      activity('3', '2026-09-05T07:00:00Z', 26, { average_hr: 115, max_hr: 140, session_name: 'Flow' }),
      activity('4', '2026-09-02T07:00:00Z', 40, { average_hr: 80, session_name: 'Yin' }),
      activity('5', '2026-09-06T07:00:00Z', 10, {}),
    ],
    ['session_name'],
    new Map(),
    new Map(),
  ).map((s) => (s.id === '1' || s.id === '2' ? { ...s, hr_zone_secs: zones(60, s.id === '1' ? 0 : 30) } : s))

  test('one group per value, most recently done first, the no-value group last', () => {
    const groups = groupSessions(
      sessions,
      'session_name',
      new Map([[groupKey('Flow'), dist(70, 95, 110, 125, 150)]]),
    )

    expect(groups.map((g) => g.value)).toEqual(['Flow', 'Yin', null])
    expect(groups[0]).toEqual({
      avg_hr_median: 115,
      count: 3,
      duration_max: 30,
      duration_median: 26,
      duration_min: 20,
      first_start_time: '2026-09-01T07:00:00.000Z',
      hr: { max: 150, median: 110, min: 70, q1: 95, q3: 125, sample_count: 10 },
      hr_zone_secs: { 0: 0, 1: 120, 2: 30, 3: 0, 4: 0, 5: 0 },
      last_start_time: '2026-09-05T07:00:00.000Z',
      max_hr: 150,
      session_ids: ['3', '2', '1'],
      value: 'Flow',
    })
    expect(groups[1]).toMatchObject({ count: 1, duration_median: 40, hr: undefined, hr_zone_secs: undefined })
    expect(groups[1]!.max_hr).toBeUndefined()
    expect(groups[2]).toMatchObject({ count: 1, session_ids: ['5'], value: null })
  })

  test('even counts take the mean of the middle two', () => {
    const [flow] = groupSessions(
      sessions.filter((s) => s.id !== '3'),
      'session_name',
      new Map(),
    )
    expect(flow).toMatchObject({ avg_hr_median: 110, duration_median: 25 })
  })
})

describe('queryActivitySessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getActivityTypeDefinitions).mockResolvedValue([yogaDef])
  })

  test("queries all time by default, and pools each group from its sessions' histograms", async () => {
    const a = activity('a', '2026-09-01T07:00:00Z', 26, { session_name: 'Flow' })
    const b = activity('b', '2026-09-02T07:00:00Z', 30, { session_name: 'Flow' })
    const open = { ...activity('c', '2026-09-03T07:00:00Z', 0), end_time: undefined }
    vi.mocked(db.getActivities).mockResolvedValue([a, b, open])
    vi.mocked(db.getHrZoneSecsForWindows).mockResolvedValue([zones(60, 0), undefined])
    vi.mocked(db.getValueHistogramsForWindows).mockResolvedValue([
      new Map([
        [80, 1],
        [100, 2],
        [120, 1],
      ]),
      new Map([[130, 1]]),
    ])

    const result = await queryActivitySessions('u', 'yoga', { groupBy: 'session_name' })

    const [, types, start, , filters, , categoryMap] = vi.mocked(db.getActivities).mock.calls[0]!
    expect(types).toEqual(['yoga'])
    expect(start).toEqual(new Date(0))
    expect(filters).toBeUndefined()
    expect(categoryMap?.get('yoga')).toBe('exercise')

    const windows = [
      { end: a.end_time, start: a.start_time },
      { end: b.end_time, start: b.start_time },
    ]
    expect(vi.mocked(db.getHrZoneSecsForWindows).mock.calls[0]![1]).toEqual(windows)
    expect(vi.mocked(db.getValueHistogramsForWindows).mock.calls[0]!.slice(1)).toEqual([
      'heart_rate',
      windows,
    ])

    expect(result.sessions.map((s) => [s.id, s.hr_zone_secs?.[1], s.hr?.median, s.hr?.max])).toEqual([
      ['c', undefined, undefined, undefined],
      ['b', undefined, 130, 130],
      ['a', 60, 100, 120],
    ])
    expect(
      result.groups?.map((g) => [g.value, g.count, g.hr?.sample_count, g.hr?.median, g.hr?.max]),
    ).toEqual([
      ['Flow', 2, 5, 100, 130],
      [null, 1, undefined, undefined, undefined],
    ])
  })

  test('filters on the merged value, and returns no groups without group_by', async () => {
    vi.mocked(db.getActivities).mockResolvedValue([
      activity('a', '2026-09-01T07:00:00Z', 20, { session_name: 'Flow' }),
      activity('b', '2026-09-02T07:00:00Z', 20, { session_name: 'Yin' }),
      activity('c', '2026-09-03T07:00:00Z', 20, { session_name: ' ' }),
    ])
    vi.mocked(db.getHrZoneSecsForWindows).mockResolvedValue([])
    vi.mocked(db.getValueHistogramsForWindows).mockResolvedValue([])

    const flow = await queryActivitySessions('u', 'yoga', {
      end: at('2026-09-26T00:00:00Z'),
      filter: { field: 'session_name', value: 'Flow' },
      start: at('2026-01-01T00:00:00Z'),
    })

    expect(vi.mocked(db.getActivities).mock.calls[0]!.slice(2, 5)).toEqual([
      at('2026-01-01T00:00:00Z'),
      at('2026-09-26T00:00:00Z'),
      undefined,
    ])
    expect(flow.sessions.map((s) => s.id)).toEqual(['a'])
    expect(flow.groups).toBeUndefined()

    const none = await queryActivitySessions('u', 'yoga', { filter: { field: 'session_name', value: null } })
    expect(none.sessions.map((s) => s.id)).toEqual(['c'])
  })

  test('nothing timed → no zone query', async () => {
    vi.mocked(db.getActivities).mockResolvedValue([])
    vi.mocked(db.getValueHistogramsForWindows).mockResolvedValue([])

    const result = await queryActivitySessions('u', 'yoga')

    expect(db.getHrZoneSecsForWindows).not.toHaveBeenCalled()
    expect(result).toEqual({ activity_type: 'yoga', group_by: undefined, groups: undefined, sessions: [] })
  })
})
