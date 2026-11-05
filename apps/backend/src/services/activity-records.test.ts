import type { ActivitySession } from '@aurboda/api-spec'

import { describe, expect, test, vi } from 'vitest'

import { type ActivityRecordsDeps, getActivityRecords, publicRecord } from './activity-records.ts'

const session = (overrides: Partial<ActivitySession> & Pick<ActivitySession, 'id' | 'start_time'>) =>
  ({ activity_type: 'strength_training', fields: {}, ...overrides }) satisfies ActivitySession

const older = session({
  id: 'a1',
  items: [
    { exercise: 'Bench Press', reps: 10, set_type: 'warmup', weight: 40 },
    { exercise: 'Bench Press', reps: 5, weight: 80 },
  ],
  measures: { e1rm: 93.3, max_reps: 5, max_weight: 80, set_count: 1, total_reps: 5, volume: 400 },
  start_time: '2026-01-10T08:00:00.000Z',
})

const tie = session({
  id: 'a2',
  items: [{ exercise: 'Bench Press', reps: 5, weight: 70 }],
  measures: { e1rm: 81.7, max_reps: 5, max_weight: 70, set_count: 1, total_reps: 5, volume: 350 },
  start_time: '2026-02-01T08:00:00.000Z',
})

const newer = session({
  id: 'merged:a3',
  items: [{ exercise: 'Bench Press', reps: 3, weight: 90 }],
  measures: { e1rm: 99, max_reps: 3, max_weight: 90, set_count: 1, total_reps: 3, volume: 270 },
  start_time: '2026-03-01T08:00:00.000Z',
})

const depsWith = (sessions: ActivitySession[]) => {
  const queryActivitySessions = vi.fn(async () => ({ activity_type: 'strength_training', sessions }))
  return {
    deps: { queryActivitySessions } as unknown as ActivityRecordsDeps,
    queryActivitySessions,
  }
}

describe('getActivityRecords', () => {
  test('one record per measure, from the first session to reach the best, with its working set', async () => {
    const { deps } = depsWith([newer, tie, older])
    const result = await getActivityRecords(
      'alice',
      'strength_training',
      { filter_field: 'sets.exercise', filter_value: 'Bench Press' },
      deps,
    )
    expect(result).toEqual({
      activity_type: 'strength_training',
      records: [
        {
          measure: 'e1rm',
          session_id: 'merged:a3',
          set: { reps: 3, weight: 90 },
          start_time: newer.start_time,
          value: 99,
        },
        {
          measure: 'max_weight',
          session_id: 'merged:a3',
          set: { reps: 3, weight: 90 },
          start_time: newer.start_time,
          value: 90,
        },
        {
          measure: 'max_reps',
          session_id: 'a1',
          set: { reps: 5, weight: 80 },
          start_time: older.start_time,
          value: 5,
        },
      ],
    })
  })

  test('passes the filter and start on to the sessions query', async () => {
    const { deps, queryActivitySessions } = depsWith([])
    await getActivityRecords(
      'alice',
      'strength_training',
      { filter_field: 'sets.exercise', filter_value: 'Bench Press', start: '2026-02-15T00:00:00Z' },
      deps,
    )
    expect(queryActivitySessions).toHaveBeenCalledWith('alice', 'strength_training', {
      end: undefined,
      filter: { field: 'sets.exercise', value: 'Bench Press' },
      groupBy: undefined,
      start: new Date('2026-02-15T00:00:00Z'),
    })
  })

  test('start narrows the records to the sessions it keeps', async () => {
    const { deps } = depsWith([newer])
    const { records } = await getActivityRecords(
      'alice',
      'strength_training',
      { start: '2026-02-15T00:00:00Z' },
      deps,
    )
    expect(records.find((r) => r.measure === 'max_reps')).toMatchObject({ session_id: 'merged:a3', value: 3 })
  })

  test('no sessions give no records', async () => {
    const { deps } = depsWith([])
    expect(await getActivityRecords('alice', 'strength_training', {}, deps)).toEqual({
      activity_type: 'strength_training',
      records: [],
    })
  })
})

describe('publicRecord', () => {
  test('drops the session id', () => {
    expect(
      publicRecord({ measure: 'e1rm', session_id: 'a1', start_time: older.start_time, value: 99 }),
    ).toEqual({ measure: 'e1rm', start_time: older.start_time, value: 99 })
  })
})
