import type { ActivitySession } from '@aurboda/api-spec'

import { describe, expect, test, vi } from 'vitest'

import { resolveSharedExerciseData, type SharedExerciseDataDeps } from './shared-exercise-data.ts'

const share = { activity_type: 'strength_training', field: 'sets.exercise', value: 'Bench Press' }

const session = (overrides: Partial<ActivitySession> & Pick<ActivitySession, 'id' | 'start_time'>) =>
  ({
    activity_type: 'strength_training',
    avg_hr: 120,
    fields: { location: 'Secret gym' },
    hr: { max: 150, median: 120, min: 90, q1: 110, q3: 130, sample_count: 100 },
    title: 'Morning lift',
    ...overrides,
  }) satisfies ActivitySession

const older = session({
  id: 'a1',
  items: [
    { exercise: 'Bench Press', reps: 10, set_type: 'warmup', weight: 40 },
    { exercise: 'Bench Press', note: 'felt heavy', reps: 5, weight: 80 },
  ],
  measures: { e1rm: 93.3, max_reps: 5, max_weight: 80, set_count: 1, total_reps: 5, volume: 400 },
  records: ['e1rm', 'max_weight', 'max_reps'],
  start_time: '2026-01-10T08:00:00.000Z',
})

const newer = session({
  id: 'a2',
  items: [{ exercise: 'Bench Press', reps: 3, weight: 90 }],
  measures: { e1rm: 99, max_reps: 3, max_weight: 90, set_count: 1, total_reps: 3, volume: 270 },
  records: ['e1rm', 'max_weight'],
  start_time: '2026-03-01T08:00:00.000Z',
})

const NOW = new Date('2026-03-11T12:00:00.000Z')

const makeDeps = (sessions: ActivitySession[]) => {
  const deps = {
    getChartData: vi.fn(async () => ({
      buckets: [
        { bucket_start: '2026-03-02T00:00:00.000Z', value: 99 },
        { bucket_start: '2026-03-09T00:00:00.000Z', series: { x: 1 } },
      ],
    })),
    getTrend: vi.fn(async () => ({ history: [{ date: '2026-03-01', value: 99 }] })),
    getUserTimezone: vi.fn(async () => 'Europe/Stockholm'),
    now: () => NOW,
    queryActivitySessions: vi.fn(async () => ({ activity_type: 'strength_training', sessions })),
  }
  return { deps, typed: deps as unknown as SharedExerciseDataDeps }
}

describe('resolveSharedExerciseData', () => {
  test('queries the stored share only', async () => {
    const { deps, typed } = makeDeps([newer, older])
    await resolveSharedExerciseData('alice', share, typed)
    expect(deps.queryActivitySessions).toHaveBeenCalledWith('alice', 'strength_training', {
      filter: { field: 'sets.exercise', value: 'Bench Press' },
    })
  })

  test('records are the best value per record measure with the first session and its set', async () => {
    const { typed } = makeDeps([newer, older])
    const data = await resolveSharedExerciseData('alice', share, typed)
    expect(data.records).toEqual([
      { measure: 'e1rm', set: { reps: 3, weight: 90 }, start_time: newer.start_time, value: 99 },
      { measure: 'max_weight', set: { reps: 3, weight: 90 }, start_time: newer.start_time, value: 90 },
      { measure: 'max_reps', set: { reps: 5, weight: 80 }, start_time: older.start_time, value: 5 },
    ])
  })

  test('done counts all sessions with the first and latest start', async () => {
    const { typed } = makeDeps([newer, older])
    const data = await resolveSharedExerciseData('alice', share, typed)
    expect(data.done).toEqual({ count: 2, first: older.start_time, last: newer.start_time })
  })

  test('the trend is the e1rm over all time, in the user timezone', async () => {
    const { deps, typed } = makeDeps([newer, older])
    const data = await resolveSharedExerciseData('alice', share, typed)
    expect(deps.getTrend).toHaveBeenCalledWith('alice', {
      filter_field: 'sets.exercise',
      filter_value: 'Bench Press',
      half_life_days: 120,
      lookback_days: 61,
      measure: 'e1rm',
      pattern: 'strength_training',
      source_type: 'activity_type',
      tz: 'Europe/Stockholm',
    })
    expect(data.trend).toEqual({
      half_life_days: 120,
      history: [{ date: '2026-03-01', value: 99 }],
      measure: 'e1rm',
    })
  })

  test('the trend falls back to most reps, then the longest hold', async () => {
    const reps = session({ id: 'r', measures: { max_reps: 20, set_count: 1 }, start_time: older.start_time })
    expect((await resolveSharedExerciseData('alice', share, makeDeps([reps]).typed)).trend?.measure).toBe(
      'max_reps',
    )
    const hold = session({ id: 'h', measures: { max_time: 60, set_count: 1 }, start_time: older.start_time })
    expect((await resolveSharedExerciseData('alice', share, makeDeps([hold]).typed)).trend?.measure).toBe(
      'max_time',
    )
  })

  test('per week charts e1rm from the local day of the first session, keeping plain buckets', async () => {
    const { deps, typed } = makeDeps([newer, older])
    const data = await resolveSharedExerciseData('alice', share, typed)
    const range = { end: '2026-03-11T22:59:59.999Z', start: '2026-01-09T23:00:00.000Z' }
    expect(deps.getChartData).toHaveBeenCalledWith('alice', {
      aggregation: 'max',
      bucket_size: '1w',
      filter_field: 'sets.exercise',
      filter_value: 'Bench Press',
      measure: 'e1rm',
      pattern: 'strength_training',
      source_type: 'activity_type',
      tz: 'Europe/Stockholm',
      ...range,
    })
    expect(data.per_week).toEqual({
      aggregation: 'max',
      buckets: [{ bucket_start: '2026-03-02T00:00:00.000Z', value: 99 }],
      measure: 'e1rm',
      ...range,
    })
  })

  test('per week without e1rm takes the first available measure and its aggregation', async () => {
    const reps = session({
      id: 'r',
      measures: { set_count: 2, total_reps: 30 },
      start_time: older.start_time,
    })
    const { deps, typed } = makeDeps([reps])
    const data = await resolveSharedExerciseData('alice', share, typed)
    expect(data.per_week).toMatchObject({ aggregation: 'sum', measure: 'set_count' })
    expect(data.trend).toBeNull()
    expect(deps.getTrend).not.toHaveBeenCalled()
  })

  test('history is newest first with projected sets and no private fields', async () => {
    const { typed } = makeDeps([newer, older])
    const data = await resolveSharedExerciseData('alice', share, typed)
    expect(data.history.map((h) => h.start_time)).toEqual([newer.start_time, older.start_time])
    expect(data.history[1]).toEqual({
      items: [
        { reps: 10, set_type: 'warmup', weight: 40 },
        { reps: 5, weight: 80 },
      ],
      measures: older.measures,
      records: older.records,
      start_time: older.start_time,
    })
    const json = JSON.stringify(data)
    for (const leak of ['a1', 'a2', 'Morning lift', 'Secret gym', 'felt heavy', 'sample_count', 'avg_hr']) {
      expect(json).not.toContain(leak)
    }
  })

  test('without sessions everything is empty or null and nothing else is queried', async () => {
    const { deps, typed } = makeDeps([])
    expect(await resolveSharedExerciseData('alice', share, typed)).toEqual({
      done: null,
      history: [],
      per_week: null,
      records: [],
      trend: null,
    })
    expect(deps.getTrend).not.toHaveBeenCalled()
    expect(deps.getChartData).not.toHaveBeenCalled()
  })
})
