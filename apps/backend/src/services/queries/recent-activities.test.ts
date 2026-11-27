import type { ActivityTypeDefinition } from '@aurboda/api-spec'

import { describe, expect, test, vi } from 'vitest'

import type { MergedActivity } from '../../db/types.ts'

import { getRecentActivities, type RecentActivitiesDeps } from './recent-activities.ts'

const def = (
  name: string,
  display_category: ActivityTypeDefinition['display_category'],
  extra: Partial<ActivityTypeDefinition> = {},
): ActivityTypeDefinition =>
  ({
    display_category,
    display_name: name.charAt(0).toUpperCase() + name.slice(1),
    name,
    show_on_timeline: true,
    ...extra,
  }) as ActivityTypeDefinition

const definitions = [
  def('exercise', 'exercise'),
  def('running', 'exercise', { color: '#f00', icon: '🏃', parent_type: 'exercise' }),
  def('meditation', 'meditation'),
  def('hidden_walk', 'exercise', { show_on_timeline: false }),
  def('coffee', 'other'),
  def('screentime', 'productivity'),
  def('sleep', 'sleep_rest'),
  def('nap', 'sleep_rest'),
  def('deep_sleep', 'sleep_rest', { parent_type: 'sleep' }),
  def('sauna', 'wellness'),
]

const descendants: Record<string, string[]> = {
  coffee: ['coffee'],
  exercise: ['exercise', 'running'],
  running: ['running'],
  sleep: ['sleep', 'deep_sleep'],
}

const activity = (
  start: string,
  extra: Partial<MergedActivity> = {},
  activity_type = 'running',
): MergedActivity => ({
  activity_type,
  id: `id-${start}`,
  source: 'garmin',
  start_time: new Date(start),
  ...extra,
})

const deps = (activities: MergedActivity[] = []): RecentActivitiesDeps => ({
  expandActivityTypes: vi.fn(async (_user: string, types: string[]) =>
    [...new Set(types.flatMap((t) => descendants[t] ?? [t]))].sort(),
  ),
  getActivities: vi.fn(async (_user: string, _types: string | string[], start: Date, end: Date) =>
    activities.filter((a) => a.start_time >= start && a.start_time <= end),
  ),
  listActivityTypeDefinitions: vi.fn().mockResolvedValue(definitions),
})

const now = new Date('2026-11-21T15:00:00Z')
const tz = 'Europe/Stockholm'

const queriedTypes = (d: RecentActivitiesDeps) =>
  [...(vi.mocked(d.getActivities).mock.calls[0]?.[1] ?? [])].sort()
const readRanges = (d: RecentActivitiesDeps) =>
  vi.mocked(d.getActivities).mock.calls.map((call) => ({ end: call[3], start: call[2] }))
const queriedRange = (d: RecentActivitiesDeps) => readRanges(d).at(-1)

describe('getRecentActivities: type selection', () => {
  test('by default lists the activity-lane types shown on the timeline, without sleep', async () => {
    const d = deps()

    await getRecentActivities('u', {}, { now, tz }, d)

    expect(queriedTypes(d)).toEqual(['exercise', 'meditation', 'running', 'sauna'])
  })

  test('given types, lists exactly those and their subtypes, whatever their category', async () => {
    const d = deps()

    await getRecentActivities('u', { types: ['sleep', 'coffee'] }, { now, tz }, d)

    expect(queriedTypes(d)).toEqual(['coffee', 'deep_sleep', 'sleep'])
  })

  test('given a subtype, lists only it', async () => {
    const d = deps()

    await getRecentActivities('u', { types: ['running'] }, { now, tz }, d)

    expect(queriedTypes(d)).toEqual(['running'])
  })

  test('leaves out exclude_types and their subtypes', async () => {
    const d = deps()

    await getRecentActivities('u', { exclude_types: ['exercise'] }, { now, tz }, d)

    expect(queriedTypes(d)).toEqual(['meditation', 'sauna'])
  })

  test('leaves out exclude_types from given types too', async () => {
    const d = deps()

    await getRecentActivities('u', { exclude_types: ['running'], types: ['exercise'] }, { now, tz }, d)

    expect(queriedTypes(d)).toEqual(['exercise'])
  })

  test('does not query when no type is left', async () => {
    const d = deps()

    const result = await getRecentActivities(
      'u',
      { exclude_types: ['running'], types: ['running'] },
      { now, tz },
      d,
    )

    expect(result).toEqual({ activities: [], tz })
    expect(d.getActivities).not.toHaveBeenCalled()
  })

  test('passes the category map to getActivities', async () => {
    const d = deps()

    await getRecentActivities('u', {}, { now, tz }, d)

    const categoryMap = vi.mocked(d.getActivities).mock.calls[0]?.[6]
    expect(categoryMap?.get('running')).toBe('exercise')
  })
})

describe('getRecentActivities: range', () => {
  test('today reads from a day before local midnight in tz to now', async () => {
    const d = deps()

    await getRecentActivities('u', { window: 'today' }, { now, tz }, d)

    expect(queriedRange(d)).toEqual({ end: now, start: new Date('2026-11-19T23:00:00Z') })
  })

  test('today is the default window', async () => {
    const d = deps()

    await getRecentActivities('u', {}, { now: new Date('2026-11-21T23:30:00Z'), tz }, d)

    expect(queriedRange(d)?.start).toEqual(new Date('2026-11-20T23:00:00Z'))
  })

  test('today lists what overlaps the local day, sorted by start', async () => {
    const d = deps([
      activity('2026-11-20T21:00:00Z', { end_time: new Date('2026-11-20T22:30:00Z'), id: 'ended-yesterday' }),
      activity('2026-11-20T22:00:00Z', {
        end_time: new Date('2026-11-20T23:00:00Z'),
        id: 'ended-at-midnight',
      }),
      activity('2026-11-20T22:30:00Z', { end_time: new Date('2026-11-21T00:30:00Z'), id: 'into-today' }),
      activity('2026-11-20T22:45:00Z', { id: 'point-yesterday' }),
      activity('2026-11-21T08:00:00Z', { id: 'point-today' }),
      activity('2026-11-21T09:00:00Z', { end_time: new Date('2026-11-21T09:00:00Z'), id: 'zero-today' }),
    ])

    const result = await getRecentActivities('u', { limit: 10 }, { now, tz }, d)

    expect(result.activities.map((a) => a.id)).toEqual(['zero-today', 'point-today', 'into-today'])
  })

  test('latest lists what starts in the look-back only', async () => {
    const d = deps()

    await getRecentActivities('u', { lookback_days: 1, window: 'latest' }, { now, tz }, d)

    expect(queriedRange(d)?.start).toEqual(new Date('2026-11-20T15:00:00Z'))
  })

  test('latest looks back 30 days by default', async () => {
    const d = deps()

    await getRecentActivities('u', { window: 'latest' }, { now, tz }, d)

    expect(queriedRange(d)).toEqual({ end: now, start: new Date('2026-10-22T15:00:00Z') })
  })

  test('latest looks back lookback_days', async () => {
    const d = deps()

    await getRecentActivities('u', { lookback_days: 7, window: 'latest' }, { now, tz }, d)

    expect(queriedRange(d)).toEqual({ end: now, start: new Date('2026-11-14T15:00:00Z') })
  })

  test('a fixed range wins over window and lookback_days, read from a day earlier', async () => {
    const d = deps()
    const range = { end: new Date('2026-10-31T22:59:59.999Z'), start: new Date('2026-09-30T22:00:00Z') }

    await getRecentActivities('u', { lookback_days: 7, window: 'latest' }, { now, range, tz }, d)

    expect(queriedRange(d)).toEqual({ end: range.end, start: new Date('2026-09-29T22:00:00Z') })
  })

  test('a fixed range lists what overlaps it', async () => {
    const range = { end: new Date('2026-10-31T22:59:59.999Z'), start: new Date('2026-09-30T22:00:00Z') }
    const d = deps([
      activity('2026-09-30T20:00:00Z', { end_time: new Date('2026-09-30T21:00:00Z'), id: 'before' }),
      activity('2026-09-30T21:30:00Z', { end_time: new Date('2026-09-30T22:30:00Z'), id: 'across-start' }),
      activity('2026-10-10T08:00:00Z', { id: 'inside' }),
    ])

    const result = await getRecentActivities('u', {}, { now, range, tz }, d)

    expect(result.activities.map((a) => a.id)).toEqual(['inside', 'across-start'])
  })
})

describe('getRecentActivities: rows', () => {
  test('lists newest first, at most limit', async () => {
    const d = deps([
      activity('2026-11-21T07:00:00Z'),
      activity('2026-11-21T12:00:00Z'),
      activity('2026-11-21T09:00:00Z'),
    ])

    const result = await getRecentActivities('u', { limit: 2 }, { now, tz }, d)

    expect(result.activities.map((a) => a.start_time)).toEqual([
      '2026-11-21T12:00:00.000Z',
      '2026-11-21T09:00:00.000Z',
    ])
  })

  test('lists five by default', async () => {
    const d = deps(Array.from({ length: 7 }, (_, i) => activity(`2026-11-21T0${i + 1}:00:00Z`)))

    const result = await getRecentActivities('u', {}, { now, tz }, d)

    expect(result.activities).toHaveLength(5)
  })

  test('manual_only keeps hand-logged activities only', async () => {
    const d = deps([
      activity('2026-11-21T07:00:00Z', { id: 'manual', source: 'aurboda' }),
      activity('2026-11-21T08:00:00Z', { id: 'override', override_target_ids: ['g1'], source: 'aurboda' }),
      activity('2026-11-21T09:00:00Z', { id: 'synced', source: 'garmin' }),
      activity('2026-11-21T10:00:00Z', { id: 'empty-override', override_target_ids: [], source: 'aurboda' }),
      activity('2026-11-21T11:00:00Z', {
        data: {
          merged_from: [
            { id: 'g2', source: 'garmin' },
            { id: 'm2', source: 'aurboda' },
          ],
        },
        id: 'merged-synced',
        source: 'aurboda',
      }),
      activity('2026-11-21T12:00:00Z', {
        data: {
          merged_from: [
            { id: 'm3', source: 'aurboda' },
            { id: 'm4', source: 'aurboda' },
          ],
        },
        id: 'merged-manual',
        source: 'aurboda',
      }),
    ])

    const result = await getRecentActivities('u', { manual_only: true }, { now, tz }, d)

    expect(result.activities.map((a) => a.id)).toEqual(['merged-manual', 'empty-override', 'manual'])
  })

  test('maps a row with its type, figures and duration', async () => {
    const d = deps([
      activity('2026-11-21T07:00:00Z', {
        data: { average_hr: 142, calories: 377, distance: 5012.4, sets: [] },
        end_time: new Date('2026-11-21T07:31:20Z'),
        id: 'a1',
        title: 'Morning run',
      }),
    ])

    const result = await getRecentActivities('u', {}, { now, tz }, d)

    expect(result).toEqual({
      activities: [
        {
          activity_type: 'running',
          avg_hr: 142,
          calories: 377,
          color: '#f00',
          distance_m: 5012.4,
          duration_minutes: 31,
          end_time: '2026-11-21T07:31:20.000Z',
          icon: '🏃',
          id: 'a1',
          start_time: '2026-11-21T07:00:00.000Z',
          title: 'Morning run',
          type_name: 'Running',
        },
      ],
      tz,
    })
  })

  test('counts sets and leaves out absent and junk figures', async () => {
    const d = deps([
      activity(
        '2026-11-21T07:00:00Z',
        {
          data: { average_hr: 'high', calories: Number.NaN, distance: -3, sets: [{}, {}, {}] },
          id: 'a1',
        },
        'meditation',
      ),
    ])

    const [row] = (await getRecentActivities('u', {}, { now, tz }, d)).activities

    expect(row).toEqual({
      activity_type: 'meditation',
      id: 'a1',
      set_count: 3,
      start_time: '2026-11-21T07:00:00.000Z',
      type_name: 'Meditation',
    })
  })

  test('uses the merged: id for a merged row', async () => {
    const d = deps([activity('2026-11-21T07:00:00Z', { id: 'w1', source_ids: ['w1', 's2'] })])

    const [row] = (await getRecentActivities('u', {}, { now, tz }, d)).activities

    expect(row?.id).toBe('merged:w1')
  })

  test("lists the type's show_in_summary fields the activity has, not the figures", async () => {
    const supplement = def('supplement', 'intake', {
      data_schema: {
        fields: [
          { name: 'substance', show_in_summary: true, type: 'string' },
          { name: 'dose', show_in_summary: true, type: 'number', unit: 'mg' },
          { label: 'Brand', name: 'brand_name', show_in_summary: true, type: 'string' },
          { name: 'note', type: 'string' },
          { name: 'calories', show_in_summary: true, type: 'number' },
          { name: 'empty', show_in_summary: true, type: 'string' },
        ],
      },
    })
    const d = deps([
      activity(
        '2026-11-21T07:00:00Z',
        { data: { calories: 5, dose: 10, empty: ' ', note: 'with food', substance: 'Zinc' }, id: 's1' },
        'supplement',
      ),
    ])
    vi.mocked(d.listActivityTypeDefinitions).mockResolvedValue([...definitions, supplement])

    const [row] = (await getRecentActivities('u', { types: ['supplement'] }, { now, tz }, d)).activities

    expect(row?.calories).toBe(5)
    expect(row?.summary_fields).toEqual([
      { label: 'Substance', value: 'Zinc' },
      { label: 'Dose', unit: 'mg', value: 10 },
    ])
  })

  test('reads a flagged unit field beside its amount as one figure', async () => {
    const supplement = def('supplement', 'intake', {
      data_schema: {
        fields: [
          { name: 'substance', show_in_summary: true, type: 'string' },
          { name: 'dose', type: 'number' },
          { label: 'Unit', name: 'dose_unit', show_in_summary: true, type: 'string' },
        ],
      },
    })
    const d = deps([
      activity(
        '2026-11-21T07:00:00Z',
        { data: { dose: 10, dose_unit: 'mg', substance: 'zinc' }, id: 's1' },
        'supplement',
      ),
      activity(
        '2026-11-21T06:00:00Z',
        { data: { dose_unit: 'mg', substance: 'iron' }, id: 's2' },
        'supplement',
      ),
    ])
    vi.mocked(d.listActivityTypeDefinitions).mockResolvedValue([...definitions, supplement])

    const rows = (await getRecentActivities('u', { types: ['supplement'] }, { now, tz }, d)).activities

    expect(rows[0]?.summary_fields).toEqual([
      { label: 'Substance', value: 'zinc' },
      { label: 'Dose', unit: 'mg', value: 10 },
    ])
    expect(rows[1]?.summary_fields).toEqual([
      { label: 'Substance', value: 'iron' },
      { label: 'Unit', value: 'mg' },
    ])
  })

  test('leaves summary_fields out when there are none', async () => {
    const d = deps([activity('2026-11-21T07:00:00Z', { data: { calories: 5 } })])

    const [row] = (await getRecentActivities('u', {}, { now, tz }, d)).activities

    expect(row).not.toHaveProperty('summary_fields')
  })

  test('humanizes the name of a type without a definition', async () => {
    const d = deps([activity('2026-11-21T07:00:00Z', {}, 'cold_plunge')])

    const [row] = (await getRecentActivities('u', { types: ['cold_plunge'] }, { now, tz }, d)).activities

    expect(row?.type_name).toBe('Cold Plunge')
  })
})

describe('getRecentActivities: newest first in growing slices', () => {
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString()

  test('a newest slice that fills the limit is the only read', async () => {
    const d = deps(Array.from({ length: 6 }, (_, i) => activity(hoursAgo(1 + i), { id: `a${i}` })))

    const result = await getRecentActivities('u', { limit: 5, window: 'latest' }, { now, tz }, d)

    expect(readRanges(d)).toEqual([{ end: now, start: new Date('2026-11-19T15:00:00Z') }])
    expect(result.activities.map((a) => a.id)).toEqual(['a0', 'a1', 'a2', 'a3', 'a4'])
  })

  test('a sparse history widens the slice up to the look-back and lists the same rows', async () => {
    const d = deps([
      activity(hoursAgo(5), { id: 'recent' }),
      activity(hoursAgo(24 * 6), { id: 'last-week' }),
      activity(hoursAgo(24 * 20), { id: 'weeks-ago' }),
      activity(hoursAgo(24 * 40), { id: 'too-old' }),
    ])

    const result = await getRecentActivities('u', { window: 'latest' }, { now, tz }, d)

    expect(readRanges(d)).toEqual([
      { end: now, start: new Date('2026-11-19T15:00:00Z') },
      { end: now, start: new Date('2026-11-13T15:00:00Z') },
      { end: now, start: new Date('2026-10-22T15:00:00Z') },
    ])
    expect(result.activities.map((a) => a.id)).toEqual(['recent', 'last-week', 'weeks-ago'])
  })

  test('widens when the last kept row starts within a day of the slice start', async () => {
    const d = deps([
      activity(hoursAgo(1), { id: 'a' }),
      activity(hoursAgo(30), { id: 'b' }),
      activity(hoursAgo(24 * 3), { id: 'c' }),
    ])

    const result = await getRecentActivities('u', { limit: 2, window: 'latest' }, { now, tz }, d)

    expect(readRanges(d)).toHaveLength(2)
    expect(result.activities.map((a) => a.id)).toEqual(['a', 'b'])
  })
})
