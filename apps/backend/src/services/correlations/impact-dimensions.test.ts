import type { ActivityTypeDefinition } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  breakdownGroups,
  categoricalFieldDimensions,
  classify,
  type ClassifyContext,
  dimensionListing,
  durationBuckets,
  localHourOfDay,
  type Occurrence,
  passesFilters,
  sessionMembers,
  sleepKey,
  timeOfDayBuckets,
} from './impact-dimensions.ts'
import { mergeIntoSessions } from './impact.ts'

const T0 = Date.parse('2026-03-02T12:00:00Z')
const min = (m: number) => T0 + m * 60_000
const span = (from: number, to: number, data?: Record<string, unknown>): Occurrence => ({
  end: min(to),
  start: min(from),
  ...(data ? { data } : {}),
})

const context = (occurrences: Occurrence[], overrides: Partial<ClassifyContext> = {}): ClassifyContext => {
  const sessions = mergeIntoSessions(occurrences)
  return {
    durationLimits: [15, 30, 60],
    fieldLabels: new Map(),
    members: sessionMembers(sessions, occurrences),
    sessions,
    sleeps: [],
    timeLimits: [0, 6, 12, 18],
    tz: 'UTC',
    windowMinutes: 30,
    ...overrides,
  }
}

describe('sessionMembers', () => {
  test('back-to-back occurrences share a session; a far one has its own', () => {
    const occurrences = [span(0, 20), span(25, 40), span(300, 320)]
    const sessions = mergeIntoSessions(occurrences)
    const members = sessionMembers(sessions, occurrences)
    expect(members).toEqual([[occurrences[0], occurrences[1]], [occurrences[2]]])
  })
})

describe('durationBuckets', () => {
  test('keys, labels and edges', () => {
    const buckets = durationBuckets([15, 30, 60])
    expect(buckets.map(({ key, label }) => [key, label])).toEqual([
      ['0-15', 'Under 15 min'],
      ['15-30', '15–30 min'],
      ['30-60', '30–60 min'],
      ['60-', '60 min or more'],
    ])
    const of = (minutes: number) => buckets.filter((b) => b.contains(minutes)).map((b) => b.key)
    expect(of(14.9)).toEqual(['0-15'])
    expect(of(15)).toEqual(['15-30'])
    expect(of(59.9)).toEqual(['30-60'])
    expect(of(60)).toEqual(['60-'])
    expect(of(600)).toEqual(['60-'])
  })
})

describe('timeOfDayBuckets', () => {
  test('the default splits the day in four', () => {
    expect(timeOfDayBuckets([0, 6, 12, 18]).map(({ key, label }) => [key, label])).toEqual([
      ['0-6', '00–06'],
      ['6-12', '06–12'],
      ['12-18', '12–18'],
      ['18-0', '18–24'],
    ])
  })

  test('the last bucket wraps past midnight', () => {
    const buckets = timeOfDayBuckets([6, 22])
    expect(buckets.map(({ key, label }) => [key, label])).toEqual([
      ['6-22', '06–22'],
      ['22-6', '22–06'],
    ])
    const of = (hour: number) => buckets.filter((b) => b.contains(hour)).map((b) => b.key)
    expect(of(23)).toEqual(['22-6'])
    expect(of(2)).toEqual(['22-6'])
    expect(of(6)).toEqual(['6-22'])
    expect(of(21.99)).toEqual(['6-22'])
  })

  test('a single limit is one bucket covering the day', () => {
    const [bucket, ...rest] = timeOfDayBuckets([5])
    expect(rest).toEqual([])
    expect([0, 4.9, 5, 12, 23.9].every((hour) => bucket.contains(hour))).toBe(true)
  })
})

describe('localHourOfDay', () => {
  test('follows the timezone and its daylight saving time', () => {
    expect(localHourOfDay(Date.parse('2026-01-15T06:30:00Z'), 'Europe/Stockholm')).toBe(7.5)
    expect(localHourOfDay(Date.parse('2026-07-15T06:30:00Z'), 'Europe/Stockholm')).toBe(8.5)
    expect(localHourOfDay(Date.parse('2026-07-15T23:15:00Z'), 'UTC')).toBe(23.25)
    expect(localHourOfDay(Date.parse('2026-07-15T22:00:00Z'), 'Europe/Stockholm')).toBe(0)
  })
})

describe('sleepKey', () => {
  const session = { end: min(30), start: min(0) }

  test('none, before, after and both', () => {
    expect(sleepKey(session, 30, [])).toBe('none')
    expect(sleepKey(session, 30, [{ end: min(-10), start: min(-120) }])).toBe('before')
    expect(sleepKey(session, 30, [{ end: min(200), start: min(45) }])).toBe('after')
    expect(
      sleepKey(session, 30, [
        { end: min(-10), start: min(-120) },
        { end: min(200), start: min(45) },
      ]),
    ).toBe('both')
  })

  test('an overlap under five minutes does not count', () => {
    expect(sleepKey(session, 30, [{ end: min(-26), start: min(-120) }])).toBe('none')
    expect(sleepKey(session, 30, [{ end: min(-25), start: min(-120) }])).toBe('before')
  })

  test('sleep inside the session alone does not count', () => {
    expect(sleepKey(session, 30, [{ end: min(25), start: min(5) }])).toBe('none')
  })
})

describe('classify a scalar field', () => {
  test('one value, several values in a merged session, no value, ordered by count with no value last', () => {
    const ctx = context([
      span(0, 20, { session_name: 'Morning flow' }),
      span(25, 40, { session_name: 'Evening stretch' }),
      span(300, 320, { session_name: ' Morning flow ' }),
      span(600, 620, {}),
      span(900, 920, { session_name: 'Balance' }),
    ])
    const c = classify('field:session_name', ctx)
    expect(c.keys).toEqual([['Morning flow', 'Evening stretch'], ['Morning flow'], ['(none)'], ['Balance']])
    expect(c.groups).toEqual([
      { key: 'Morning flow', label: 'Morning flow' },
      { key: 'Balance', label: 'Balance' },
      { key: 'Evening stretch', label: 'Evening stretch' },
      { key: '(none)', label: 'No value' },
    ])
    expect(c.label).toBe('Session Name')
  })

  test('booleans are labelled Yes and No, and a schema label names the dimension', () => {
    const ctx = context([span(0, 20, { guided: true }), span(300, 320, { guided: false })], {
      fieldLabels: new Map([['guided', 'With a guide']]),
    })
    const c = classify('field:guided', ctx)
    expect(c.groups).toEqual([
      { key: 'false', label: 'No' },
      { key: 'true', label: 'Yes' },
    ])
    expect(c.label).toBe('With a guide')
  })
})

describe('classify an item path', () => {
  test('a session with two exercises has both keys, labelled by their display value', () => {
    const ctx = context([
      span(0, 40, {
        sets: [
          { exercise: 'Squat', reps: 5 },
          { exercise: 'squat ', reps: 5 },
          { exercise: 'Bench Press', reps: 8 },
        ],
      }),
      span(300, 340, { sets: [{ exercise: 'Squat', reps: 3 }] }),
    ])
    const c = classify('field:sets.exercise', ctx)
    expect(c.keys).toEqual([['squat', 'bench press'], ['squat']])
    expect(c.groups).toEqual([
      { key: 'squat', label: 'Squat' },
      { key: 'bench press', label: 'Bench Press' },
    ])
    expect(c.label).toBe('Exercise')
  })
})

describe('passesFilters', () => {
  const ctx = context([span(0, 10), span(300, 340), span(600, 700)])
  const classifications = [classify('duration', ctx), classify('time_of_day', ctx)]

  test('any key within a dimension, every dimension', () => {
    const passing = (filters: { dimension: string; keys: string[] }[]) =>
      [0, 1, 2].filter((i) => passesFilters(classifications, filters, i))
    expect(passing([{ dimension: 'duration', keys: ['0-15', '60-'] }])).toEqual([0, 2])
    expect(
      passing([
        { dimension: 'duration', keys: ['0-15', '60-'] },
        { dimension: 'time_of_day', keys: ['18-0'] },
      ]),
    ).toEqual([2])
    expect(passing([{ dimension: 'duration', keys: ['5-10'] }])).toEqual([])
  })
})

describe('breakdownGroups and dimensionListing', () => {
  test('field groups past the cap are omitted, the no-value group kept', () => {
    const occurrences = [
      ...Array.from({ length: 5 }, (_, i) => span(i * 300, i * 300 + 20, { session_name: `Flow ${i}` })),
      span(3000, 3020, {}),
    ]
    const c = classify('field:session_name', context(occurrences))
    const { groups, omitted } = breakdownGroups(c, [0, 1, 2, 3, 4, 5], 3)
    expect(groups.map((g) => [g.key, g.indices])).toEqual([
      ['Flow 0', [0]],
      ['Flow 1', [1]],
      ['(none)', [5]],
    ])
    expect(omitted).toBe(3)
  })

  test('a breakdown holds only groups with sessions among the selected ones', () => {
    const c = classify('duration', context([span(0, 10), span(300, 340), span(600, 700)]))
    expect(breakdownGroups(c, [1, 2], 12).groups.map((g) => g.key)).toEqual(['30-60', '60-'])
  })

  test('a listing counts every session and keeps empty buckets of fixed dimensions', () => {
    const c = classify('duration', context([span(0, 10), span(300, 340)]))
    expect(dimensionListing(c, 50)).toEqual({
      dimension: 'duration',
      groups: [
        { key: '0-15', label: 'Under 15 min', occurrences: 1 },
        { key: '15-30', label: '15–30 min', occurrences: 0 },
        { key: '30-60', label: '30–60 min', occurrences: 1 },
        { key: '60-', label: '60 min or more', occurrences: 0 },
      ],
      label: 'Length',
      omitted_groups: 0,
    })
  })
})

describe('categoricalFieldDimensions', () => {
  test('categorical scalar fields and categorical item fields, in schema order', () => {
    const definition = {
      data_schema: {
        fields: [
          { is_categorical: true, name: 'session_name', type: 'string' },
          { name: 'notes', type: 'string' },
          {
            item_fields: [
              { is_categorical: true, name: 'exercise', type: 'string' },
              { name: 'reps', type: 'number' },
            ],
            name: 'sets',
            type: 'list',
          },
        ],
      },
      name: 'yoga',
    } as ActivityTypeDefinition
    expect(categoricalFieldDimensions(definition)).toEqual(['field:session_name', 'field:sets.exercise'])
    expect(categoricalFieldDimensions(undefined)).toEqual([])
  })
})
