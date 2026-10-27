import type { ActivitySession } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  availableMeasures,
  chartExplorerHref,
  decayingBestPoints,
  doneSummary,
  explorerLookbackDays,
  perWeekRange,
  recordsFrom,
  sliceByLookback,
  trendMeasure,
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

describe('trendMeasure', () => {
  test('e1rm when any session has it', () => {
    expect(trendMeasure(sessions)).toBe('e1rm')
  })

  test('most reps for reps-only sessions, longest hold for time-only', () => {
    const reps = session('r', '2026-01-01T07:00:00.000Z', { measures: { max_reps: 20, total_reps: 50 } })
    const hold = session('h', '2026-01-01T07:00:00.000Z', { measures: { max_time: 60, set_count: 3 } })
    expect(trendMeasure([reps])).toBe('max_reps')
    expect(trendMeasure([hold])).toBe('max_time')
  })

  test('undefined when no session has one', () => {
    expect(trendMeasure([s4])).toBeUndefined()
    expect(trendMeasure([])).toBeUndefined()
  })
})

describe('availableMeasures', () => {
  test('the measures any session has, in api-spec order', () => {
    expect(availableMeasures(sessions)).toEqual(['volume', 'e1rm', 'max_weight'])
    expect(availableMeasures([s4])).toEqual([])
  })
})

describe('decayingBestPoints', () => {
  const at = (id: string, date: string, e1rm?: number) =>
    session(id, date, { measures: e1rm === undefined ? {} : { e1rm } })
  const jan1 = '2026-01-01T00:00:00.000Z'
  const may1 = '2026-05-01T00:00:00.000Z'
  const now = new Date(may1).getTime()

  test('the half-life is exact and a lower session carries the decayed best', () => {
    expect(decayingBestPoints([at('b', may1, 10), at('a', jan1, 100)], 'e1rm', 120, now)).toEqual([
      { date: jan1, value: 100 },
      { date: may1, value: 50 },
    ])
  })

  test('a higher session resets to its own value', () => {
    expect(decayingBestPoints([at('a', jan1, 100), at('b', may1, 80)], 'e1rm', 120, now)).toEqual([
      { date: jan1, value: 100 },
      { date: may1, value: 80 },
    ])
  })

  test('a trailing point at now decays from the last point', () => {
    const later = new Date('2026-08-29T00:00:00.000Z').getTime()
    expect(decayingBestPoints([at('a', jan1, 100), at('b', may1, 10)], 'e1rm', 120, later)).toEqual([
      { date: jan1, value: 100 },
      { date: may1, value: 50 },
      { date: '2026-08-29T00:00:00.000Z', value: 25 },
    ])
  })

  test('a single session gives itself and today', () => {
    expect(decayingBestPoints([at('a', jan1, 100)], 'e1rm', 120, now)).toEqual([
      { date: jan1, value: 100 },
      { date: may1, value: 50 },
    ])
  })

  test('rounds to one decimal', () => {
    expect(decayingBestPoints([at('a', jan1, 113.33)], 'e1rm', 120, new Date(jan1).getTime())).toEqual([
      { date: jan1, value: 113.3 },
    ])
  })

  test('skips sessions without the measure, and none gives no points', () => {
    expect(decayingBestPoints([at('a', jan1, 100), at('b', may1)], 'e1rm', 120, now)).toEqual([
      { date: jan1, value: 100 },
      { date: may1, value: 50 },
    ])
    expect(decayingBestPoints([at('b', may1)], 'e1rm', 120, now)).toEqual([])
    expect(decayingBestPoints([], 'e1rm', 120, now)).toEqual([])
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

describe('perWeekRange', () => {
  const now = new Date(2026, 9, 26, 14, 30)

  test('from the start of the day `days` ago to the end of today', () => {
    const { start, end } = perWeekRange(90, sessions, now)
    expect(new Date(start)).toEqual(new Date(2026, 6, 28, 0, 0, 0, 0))
    expect(new Date(end)).toEqual(new Date(2026, 9, 26, 23, 59, 59, 999))
  })

  test('all time starts on the day of the first session', () => {
    const first = new Date(s1.start_time)
    const { start, end } = perWeekRange(0, sessions, now)
    expect(new Date(start)).toEqual(new Date(first.getFullYear(), first.getMonth(), first.getDate()))
    expect(new Date(end)).toEqual(new Date(2026, 9, 26, 23, 59, 59, 999))
  })
})

describe('explorerLookbackDays', () => {
  const now = new Date(2026, 9, 26, 14, 30)

  test('the period itself', () => {
    expect(explorerLookbackDays(90, new Date(2026, 6, 28).toISOString(), now)).toBe(90)
  })

  test('all time is the days since the start, rounded up', () => {
    expect(explorerLookbackDays(0, new Date(2026, 9, 20).toISOString(), now)).toBe(7)
    expect(explorerLookbackDays(0, new Date(2026, 9, 26).toISOString(), now)).toBe(1)
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
