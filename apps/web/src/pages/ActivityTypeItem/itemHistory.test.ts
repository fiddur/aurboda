import type { ActivitySession } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  chartExplorerHref,
  doneSummary,
  perWeekLookbackDays,
  perWeekRange,
  recordsFrom,
  sliceByLookback,
  trendPoints,
} from './itemHistory'

const session = (id: string, start: string, extra: Partial<ActivitySession> = {}): ActivitySession => ({
  activity_type: 'strength_training',
  fields: {},
  id,
  start_time: start,
  ...extra,
})

const s1 = session('a', '2026-01-10T07:00:00.000Z', {
  items: [
    { reps: 8, weight: 80 },
    { reps: 5, weight: 90 },
  ],
  measures: { e1rm: 105, max_weight: 90, volume: 1090 },
})
const s2 = session('b', '2026-03-10T07:00:00.000Z', {
  items: [{ reps: 10, weight: 85 }],
  measures: { e1rm: 113.3, max_weight: 85, volume: 850 },
})
const s3 = session('c', '2026-06-10T07:00:00.000Z', {
  items: [{ reps: 6, weight: 90 }],
  measures: { e1rm: 108, max_weight: 90, volume: 540 },
})
const s4 = session('d', '2026-09-10T07:00:00.000Z', { items: [], measures: {} })

// Newest first, as the API returns them.
const sessions = [s4, s3, s2, s1]

describe('recordsFrom', () => {
  test('the best value per record measure, the first session to reach it and its set', () => {
    expect(recordsFrom(sessions)).toEqual([
      {
        measure: 'e1rm',
        session_id: 'b',
        set: { reps: 10, weight: 85 },
        start_time: s2.start_time,
        value: 113.3,
      },
      {
        measure: 'max_weight',
        session_id: 'a',
        set: { reps: 5, weight: 90 },
        start_time: s1.start_time,
        value: 90,
      },
    ])
  })

  test('max_time when sessions have holds', () => {
    const holds = [
      session('x', '2026-02-01T07:00:00.000Z', { items: [{ time: 60 }], measures: { max_time: 60 } }),
      session('y', '2026-01-01T07:00:00.000Z', { items: [{ time: 45 }], measures: { max_time: 45 } }),
    ]
    expect(recordsFrom(holds)).toEqual([
      {
        measure: 'max_time',
        session_id: 'x',
        set: { time: 60 },
        start_time: '2026-02-01T07:00:00.000Z',
        value: 60,
      },
    ])
  })

  test('empty without sessions or measures', () => {
    expect(recordsFrom([])).toEqual([])
    expect(recordsFrom([s4])).toEqual([])
  })
})

describe('doneSummary', () => {
  test('count and first and last date', () => {
    expect(doneSummary(sessions)).toEqual({ count: 4, first: s1.start_time, last: s4.start_time })
    expect(doneSummary([])).toBeUndefined()
  })
})

describe('trendPoints', () => {
  test('one point per session with the measure, oldest first', () => {
    expect(trendPoints(sessions, 'e1rm')).toEqual([
      { date: s1.start_time, value: 105 },
      { date: s2.start_time, value: 113.3 },
      { date: s3.start_time, value: 108 },
    ])
    expect(trendPoints(sessions, 'max_time')).toEqual([])
  })
})

describe('sliceByLookback', () => {
  const now = new Date('2026-09-20T00:00:00.000Z').getTime()

  test('keeps the sessions inside the period, in order', () => {
    expect(sliceByLookback(sessions, 90, now)).toEqual([s4])
    expect(sliceByLookback(sessions, 365, now)).toEqual(sessions)
  })

  test('all time with zero days', () => {
    expect(sliceByLookback(sessions, 0, now)).toEqual(sessions)
  })
})

describe('perWeekLookbackDays', () => {
  test('the period, with all time as two years', () => {
    expect(perWeekLookbackDays(90)).toBe(90)
    expect(perWeekLookbackDays(0)).toBe(730)
  })
})

describe('perWeekRange', () => {
  test('from the start of the day `days` ago to the end of today', () => {
    const now = new Date(2026, 9, 26, 14, 30)
    const { start, end } = perWeekRange(90, now)
    expect(new Date(start)).toEqual(new Date(2026, 6, 28, 0, 0, 0, 0))
    expect(new Date(end)).toEqual(new Date(2026, 9, 26, 23, 59, 59, 999))
  })
})

describe('chartExplorerHref', () => {
  const params = (href: string) => new URLSearchParams(href.split('?')[1])

  test('a weekly bar chart of the measure for this item value', () => {
    const href = chartExplorerHref({
      field: 'sets.exercise',
      lookbackDays: 365,
      measure: 'e1rm',
      name: 'strength_training',
      value: 'Bench Press',
    })
    expect(href.startsWith('/chart?')).toBe(true)
    expect(Object.fromEntries(params(href))).toEqual({
      aggregation: 'max',
      bucket_size: '1w',
      chart_type: 'bar',
      filter_field: 'sets.exercise',
      filter_value: 'Bench Press',
      lookback_days: '365',
      measure: 'e1rm',
      pattern: 'strength_training',
      source_type: 'activity_type',
    })
  })

  test('sums the measures that add up', () => {
    const href = chartExplorerHref({
      field: 'sets.exercise',
      lookbackDays: 90,
      measure: 'volume',
      name: 'strength_training',
      value: 'Squat',
    })
    expect(params(href).get('aggregation')).toBe('sum')
  })
})
