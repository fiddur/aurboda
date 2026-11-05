import type { ExerciseShare, SharedExerciseData } from '@aurboda/api-spec'

import { feedStructuredPostSchema } from '@aurboda/api-spec'
import { describe, expect, test, vi } from 'vitest'

import {
  filterExerciseData,
  resolveExerciseTrendSeries,
  resolveStructuredExercise,
  type StructuredExerciseDeps,
  type StructuredExercisePost,
} from './feed-structured-exercise.ts'

const exercise: ExerciseShare = {
  activity_type: 'strength_training',
  field: 'sets.exercise',
  include_records: true,
  include_sessions: true,
  name: 'Bench',
  url: 'https://aurboda.example/u/fiddur/bench',
  value: 'Bench Press',
}

const session = (day: number) => ({
  items: [{ reps: 8, weight: 60 + day }],
  measures: { e1rm: 76 + day, volume: 480 + 8 * day },
  records: [],
  start_time: `2026-10-${String(day).padStart(2, '0')}T08:00:00.000Z`,
})

const trend = {
  half_life_days: 30,
  history: [
    { date: '2026-10-01', value: 77 },
    { date: '2026-10-07', value: 82 },
  ],
  measure: 'e1rm' as const,
}

const data: SharedExerciseData = {
  done: { count: 7, first: '2026-10-01T08:00:00.000Z', last: '2026-10-07T08:00:00.000Z' },
  history: [7, 6, 5, 4, 3, 2, 1].map(session),
  per_week: {
    aggregation: 'max',
    buckets: [{ bucket_start: '2026-09-28T00:00:00.000Z', value: 83 }],
    end: '2026-10-07T23:59:59.999Z',
    measure: 'e1rm',
    start: '2025-10-07T00:00:00.000Z',
  },
  records: [
    { measure: 'e1rm', set: { reps: 8, weight: 67 }, start_time: '2026-10-07T08:00:00.000Z', value: 83 },
  ],
  trend,
}

const post = (over: Partial<StructuredExercisePost> = {}): StructuredExercisePost => ({
  exercise,
  include_chart: true,
  kind: 'exercise',
  message: 'New **PR**',
  ...over,
})

const depsWith = (resolved: SharedExerciseData = data): StructuredExerciseDeps => ({
  getActivityTypeDefinition: vi.fn(async () => ({ display_name: 'Strength training' })),
  resolveSharedExerciseData: vi.fn(async () => resolved),
})

describe('filterExerciseData', () => {
  test('keeps everything opted into, sessions capped at the newest 5', () => {
    const filtered = filterExerciseData(data, exercise, true)
    expect(filtered.records).toEqual(data.records)
    expect(filtered.trend).toEqual(data.trend)
    expect(filtered.per_week).toEqual(data.per_week)
    expect(filtered.history.map((h) => h.start_time)).toEqual(
      data.history.slice(0, 5).map((h) => h.start_time),
    )
    expect(filtered.done).toEqual(data.done)
  })

  test('leaves out what was not opted into, but always keeps the session count', () => {
    const filtered = filterExerciseData(data, { include_records: false, include_sessions: false }, false)
    expect(filtered).toEqual({ done: data.done, history: [], per_week: null, records: [], trend: null })
  })
})

describe('resolveStructuredExercise', () => {
  test('resolves the pointer to a payload the structured union accepts', async () => {
    const deps = depsWith()
    const structured = await resolveStructuredExercise('fiddur', post(), deps)
    expect(deps.resolveSharedExerciseData).toHaveBeenCalledWith('fiddur', exercise)
    expect(structured).toMatchObject({
      activity_type: 'strength_training',
      activity_type_name: 'Strength training',
      kind: 'exercise',
      message: 'New **PR**',
      name: 'Bench',
      url: exercise.url,
    })
    expect(structured?.data.history).toHaveLength(5)
    expect(feedStructuredPostSchema.parse(structured)).toEqual(structured)
  })

  test('falls back to the type name and leaves out an absent message and link', async () => {
    const deps: StructuredExerciseDeps = { ...depsWith(), getActivityTypeDefinition: async () => null }
    const { url: _url, ...unlinked } = exercise
    const structured = await resolveStructuredExercise(
      'fiddur',
      post({ exercise: unlinked, message: null }),
      deps,
    )
    expect(structured?.activity_type_name).toBe('strength_training')
    expect(structured).not.toHaveProperty('message')
    expect(structured).not.toHaveProperty('url')
  })

  test('null for another kind, or when the exercise has no sessions any more', async () => {
    expect(await resolveStructuredExercise('fiddur', post({ kind: 'challenge' }), depsWith())).toBeNull()
    expect(await resolveStructuredExercise('fiddur', post({ exercise: null }), depsWith())).toBeNull()
    const empty = { ...data, done: null, history: [], records: [], trend: null, per_week: null }
    expect(await resolveStructuredExercise('fiddur', post(), depsWith(empty))).toBeNull()
  })
})

describe('resolveExerciseTrendSeries', () => {
  test('maps the trend history to dated points with its measure', async () => {
    expect(await resolveExerciseTrendSeries('fiddur', post(), depsWith())).toEqual({
      measure: 'e1rm',
      series: [
        [new Date('2026-10-01'), 77],
        [new Date('2026-10-07'), 82],
      ],
    })
  })

  test('null without the chart opt-in or with fewer than 2 points', async () => {
    expect(await resolveExerciseTrendSeries('fiddur', post({ include_chart: false }), depsWith())).toBeNull()
    const single = { ...data, trend: { ...trend, history: [{ date: '2026-10-01', value: 77 }] } }
    expect(await resolveExerciseTrendSeries('fiddur', post(), depsWith(single))).toBeNull()
  })
})
