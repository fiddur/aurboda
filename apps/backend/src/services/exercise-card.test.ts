import type { SharedExerciseData } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { describeExercise, downsample, latestExerciseSession, SPARKLINE_POINTS } from './exercise-card.ts'

const data = (overrides: Partial<SharedExerciseData> = {}): SharedExerciseData => ({
  done: { count: 43, first: '2025-03-04T08:00:00.000Z', last: '2026-11-04T08:00:00.000Z' },
  history: [],
  per_week: null,
  records: [
    { measure: 'e1rm', start_time: '2025-12-21T09:00:00.000Z', value: 39.5 },
    { measure: 'max_weight', start_time: '2025-11-02T09:00:00.000Z', value: 35 },
    { measure: 'max_reps', start_time: '2025-06-10T09:00:00.000Z', value: 12 },
  ],
  trend: {
    half_life_days: 30,
    history: [
      { date: '2025-03-04', value: 30 },
      { date: '2025-03-05', value: 31 },
    ],
    measure: 'e1rm',
  },
  ...overrides,
})

const trendOf = (values: number[], measure: 'e1rm' | 'max_reps' = 'e1rm'): SharedExerciseData['trend'] => ({
  half_life_days: 30,
  history: values.map((value, i) => ({ date: `d${i}`, value })),
  measure,
})

describe('describeExercise', () => {
  test('headlines the record of the trend measure', () => {
    const details = describeExercise(
      data({ trend: trendOf([1, 2], 'max_reps') }),
      'Strength training',
      'Europe/Stockholm',
    )
    expect(details.headline).toEqual({ date: '10 Jun 2025', label: 'Most reps in a set', value: '12 reps' })
    expect(details.activityTypeName).toBe('Strength training')
  })

  test('formats the e1RM headline in kg with its date', () => {
    expect(describeExercise(data(), 'Strength training', 'Europe/Stockholm').headline).toEqual({
      date: '21 Dec 2025',
      label: 'Best e1RM',
      value: '39.5 kg',
    })
  })

  test('falls back to the first record without a trend', () => {
    const details = describeExercise(data({ trend: null }), 'Strength training', 'UTC')
    expect(details.headline?.label).toBe('Best e1RM')
  })

  test('falls back to the first record when the trend measure has none', () => {
    const records = data().records.filter((r) => r.measure !== 'max_reps')
    const details = describeExercise(data({ records, trend: trendOf([1, 2], 'max_reps') }), 'X', 'UTC')
    expect(details.headline?.label).toBe('Best e1RM')
  })

  test('has no headline without records', () => {
    expect(describeExercise(data({ records: [] }), 'X', 'UTC').headline).toBeUndefined()
  })

  test('counts many sessions since the first month', () => {
    expect(describeExercise(data(), 'X', 'UTC').sessions).toBe('43 sessions since Mar 2025')
  })

  test('names the date of a single session', () => {
    const done = { count: 1, first: '2026-11-04T08:00:00.000Z', last: '2026-11-04T08:00:00.000Z' }
    expect(describeExercise(data({ done }), 'X', 'UTC').sessions).toBe('1 session, 4 Nov 2026')
  })

  test('has no session line without sessions', () => {
    expect(describeExercise(data({ done: null }), 'X', 'UTC').sessions).toBeUndefined()
  })

  test('reads the first month in the owner timezone', () => {
    const done = { count: 5, first: '2025-03-31T23:30:00.000Z', last: '2025-05-01T08:00:00.000Z' }
    expect(describeExercise(data({ done }), 'X', 'Europe/Stockholm').sessions).toBe(
      '5 sessions since Apr 2025',
    )
    expect(describeExercise(data({ done }), 'X', 'UTC').sessions).toBe('5 sessions since Mar 2025')
  })

  test('falls back to UTC for an invalid timezone', () => {
    const done = { count: 5, first: '2025-03-31T23:30:00.000Z', last: '2025-05-01T08:00:00.000Z' }
    const details = describeExercise(data({ done }), 'X', 'Not/AZone')
    expect(details.sessions).toBe('5 sessions since Mar 2025')
    expect(details.headline?.date).toBe('21 Dec 2025')
  })

  test('the sparkline is the trend values oldest first', () => {
    expect(describeExercise(data({ trend: trendOf([3, 1, 2]) }), 'X', 'UTC').sparkline).toEqual([3, 1, 2])
  })

  test('the sparkline caps its length and keeps the last point', () => {
    const values = Array.from({ length: 1000 }, (_, i) => i)
    const { sparkline } = describeExercise(data({ trend: trendOf(values) }), 'X', 'UTC')
    expect(sparkline).toHaveLength(SPARKLINE_POINTS)
    expect(sparkline[0]).toBe(0)
    expect(sparkline.at(-1)).toBe(999)
  })

  test('a trend shorter than two points has no sparkline', () => {
    expect(describeExercise(data({ trend: trendOf([5]) }), 'X', 'UTC').sparkline).toEqual([])
    expect(describeExercise(data({ trend: null }), 'X', 'UTC').sparkline).toEqual([])
  })
})

describe('downsample', () => {
  test('leaves a short series alone', () => {
    expect(downsample([1, 2, 3], 5)).toEqual([1, 2, 3])
  })

  test('picks evenly spaced values including both ends', () => {
    expect(downsample([0, 1, 2, 3, 4, 5, 6, 7, 8], 5)).toEqual([0, 2, 4, 6, 8])
  })
})

describe('latestExerciseSession', () => {
  const share = { activity_type: 'strength_training', field: 'sets.exercise', value: 'Bench Press' }

  test('is the newest session start of the shared value', async () => {
    const calls: unknown[] = []
    const latest = await latestExerciseSession('fiddur', share, async (...args) => {
      calls.push(args)
      return {
        sessions: [
          { start_time: '2026-01-10T08:00:00.000Z' },
          { start_time: '2026-03-01T08:00:00.000Z' },
          { start_time: '2026-02-01T08:00:00.000Z' },
        ],
      }
    })
    expect(latest).toBe('2026-03-01T08:00:00.000Z')
    expect(calls).toEqual([
      ['fiddur', 'strength_training', { filter: { field: 'sets.exercise', value: 'Bench Press' } }],
    ])
  })

  test('is null without sessions', async () => {
    expect(await latestExerciseSession('fiddur', share, async () => ({ sessions: [] }))).toBeNull()
  })
})
