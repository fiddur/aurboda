import type { StoredExerciseCatalogEntry } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import type { ExerciseSession, loadSessions, Period } from './muscle-group-history.ts'

import {
  type MuscleRecoveryDeps,
  queryMuscleRecovery,
  queryMuscleRecoveryHistory,
} from './muscle-recovery.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const at = new Date('2026-06-01T12:00:00Z')

const bench: ExerciseSession = {
  activity_type: 'strength_training',
  end_time: at,
  id: 's1',
  items: Array.from({ length: 5 }, () => ({ exercise: 'Bench', reps: 8, weight: 60 })),
  start_time: new Date(at.getTime() - HOUR),
}

const depsOf = (
  periods: Period[],
  result?: Awaited<ReturnType<typeof loadSessions>>,
): MuscleRecoveryDeps => ({
  loadSessions: async (_user, _type, _path, period) => {
    if (period) periods.push(period)
    return (
      result ?? {
        data: {
          key: 'exercise',
          resolverOf: () => (value) =>
            value === 'Bench'
              ? ({ key: 'bench', muscles: { chest: 1 } } as StoredExerciseCatalogEntry)
              : undefined,
          sessions: [bench],
        },
        success: true,
      }
    )
  },
})

const chestOf = (groups: { muscle_group: string; recovery: number }[]) =>
  groups.find((g) => g.muscle_group === 'chest')?.recovery

describe('queryMuscleRecovery', () => {
  test('loads the sessions of the window and gives the recovery at the moment', async () => {
    const periods: Period[] = []
    const result = await queryMuscleRecovery('u', 'strength_training', 'sets.exercise', at, depsOf(periods))
    expect(periods).toEqual([{ end: at, start: new Date(at.getTime() - 10 * DAY) }])
    if (!result.success) throw new Error(result.error)
    expect(result.data.field).toBe('sets.exercise')
    expect(chestOf(result.data.groups)).toBe(50)
  })

  test('passes on an error of the item path', async () => {
    const error = { error: 'Activity type "nope" not found', success: false as const }
    expect(await queryMuscleRecovery('u', 'nope', 'sets.exercise', at, depsOf([], error))).toEqual(error)
  })
})

describe('queryMuscleRecoveryHistory', () => {
  test('loads the period widened by a window and gives a point per step', async () => {
    const periods: Period[] = []
    const period = { end: at, start: new Date(at.getTime() - 12 * HOUR), step_hours: 6 }
    const result = await queryMuscleRecoveryHistory(
      'u',
      'strength_training',
      'sets.exercise',
      period,
      depsOf(periods),
    )
    expect(periods).toEqual([{ end: at, start: new Date(at.getTime() - 12 * HOUR - 10 * DAY) }])
    if (!result.success) throw new Error(result.error)
    expect(result.data.points.map((p) => p.recovery.chest)).toEqual([100, 100, 50])
  })

  test('passes on an error of the item path', async () => {
    const error = { error: 'Activity type "nope" not found', success: false as const }
    const period = { end: at, start: new Date(at.getTime() - DAY), step_hours: 6 }
    expect(await queryMuscleRecoveryHistory('u', 'nope', 'sets.exercise', period, depsOf([], error))).toEqual(
      error,
    )
  })
})
