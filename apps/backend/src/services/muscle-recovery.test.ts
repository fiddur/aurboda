import { exerciseMuscleGroups, type StoredExerciseCatalogEntry } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import type { ExerciseSession, ResolverOf } from './queries/muscle-group-history.ts'

import {
  fatigueSets,
  MUSCLE_RECOVERY_HALF_LIFE_HOURS,
  muscleRecoveryAt,
  muscleRecoveryHistory,
  setEffort,
} from './muscle-recovery.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR

const entries: Record<string, Partial<StoredExerciseCatalogEntry>> = {
  bench: { key: 'bench', muscles: { chest: 1, front_delts: 0.5, triceps: 0.5 } },
  pushdown: { key: 'pushdown', muscles: { triceps_long_head: 1, triceps_medial_lateral: 1 } },
}
const resolverOf: ResolverOf = () => (value) =>
  entries[value.trim().toLowerCase()] as StoredExerciseCatalogEntry | undefined

const T = new Date('2026-06-01T12:00:00Z')
const after = (hours: number) => new Date(T.getTime() + hours * HOUR)

const sets = (n: number, exercise = 'Bench', extra: Record<string, unknown> = {}) =>
  Array.from({ length: n }, () => ({ exercise, reps: 8, weight: 60, ...extra }))

const session = (
  id: string,
  items: Record<string, unknown>[],
  end: Date | null = T,
  start: Date = new Date((end ?? T).getTime() - HOUR),
): ExerciseSession => ({
  activity_type: 'strength_training',
  ...(end !== null && { end_time: end }),
  id,
  items,
  start_time: start,
})

const recoveryOf = (sessions: ExerciseSession[], at: Date) =>
  muscleRecoveryAt(fatigueSets(sessions, 'exercise', resolverOf), at, 'sets.exercise')

const groupOf = (sessions: ExerciseSession[], at: Date, group: string) => {
  const found = recoveryOf(sessions, at).groups.find((g) => g.muscle_group === group)
  if (!found) throw new Error(`no ${group}`)
  return found
}

describe('setEffort', () => {
  test('hard sets count 1.2', () => {
    expect(setEffort({ set_type: ' Failure ' })).toBe(1.2)
    expect(setEffort({ rpe: 9 })).toBe(1.2)
    expect(setEffort({ rir: 1 })).toBe(1.2)
  })

  test('easy sets count 0.7', () => {
    expect(setEffort({ rpe: 6 })).toBe(0.7)
    expect(setEffort({ rir: 4 })).toBe(0.7)
  })

  test('other sets count 1', () => {
    expect(setEffort({ rpe: 7.5 })).toBe(1)
    expect(setEffort({})).toBe(1)
    expect(setEffort({ set_type: 'drop_set' })).toBe(1)
    expect(setEffort({ rpe: '9' })).toBe(1)
  })

  test('the hard rule wins', () => {
    expect(setEffort({ rir: 4, rpe: 9 })).toBe(1.2)
  })
})

describe('fatigueSets', () => {
  test('warm-ups and unresolved names do not count; a set without weight or reps does', () => {
    const records = fatigueSets(
      [
        session('s1', [
          { exercise: 'Bench', set_type: 'warmup' },
          { exercise: 'Unknown' },
          { exercise: 'Bench' },
        ]),
      ],
      'exercise',
      resolverOf,
    )
    expect(records.find((r) => r.muscle_group === 'chest')).toMatchObject({
      fatigue: 0.1,
      session_id: 's1',
      sets: 1,
    })
  })

  test('two heads of one muscle count once', () => {
    const records = fatigueSets([session('s1', sets(2, 'Pushdown'))], 'exercise', resolverOf)
    expect(records).toEqual([expect.objectContaining({ muscle_group: 'triceps', sets: 2 })])
  })
})

describe('muscleRecoveryAt', () => {
  const five = [session('s1', sets(5))]

  test('five full sets halve over the half-life', () => {
    expect(MUSCLE_RECOVERY_HALF_LIFE_HOURS.chest).toBe(36)
    expect(groupOf(five, T, 'chest')).toMatchObject({ fatigue: 0.5, half_life_hours: 36, recovery: 50 })
    expect(groupOf(five, after(36), 'chest')).toMatchObject({ fatigue: 0.25, recovery: 75 })
  })

  test('ready_at is when the fatigue reaches 0.2, null once it has', () => {
    const readyAt = T.getTime() + 36 * Math.log2(0.5 / 0.2) * HOUR
    expect(new Date(groupOf(five, T, 'chest').ready_at ?? 0).getTime()).toBeCloseTo(readyAt, -1)
    expect(groupOf(five, after(48), 'chest')).toMatchObject({ fatigue: 0.2, ready_at: null, recovery: 80 })
  })

  test('a secondary muscle gets its recruitment share', () => {
    expect(groupOf(five, T, 'triceps').fatigue).toBe(0.25)
  })

  test('24 and 36 hour groups decay differently from the same session', () => {
    expect(MUSCLE_RECOVERY_HALF_LIFE_HOURS.shoulders).toBe(24)
    expect(groupOf(five, after(24), 'shoulders').fatigue).toBe(0.13)
    expect(groupOf(five, after(24), 'chest').fatigue).toBe(0.31)
  })

  test('more than ten sets: fatigue above 1, recovery 0, ready later', () => {
    const ten = groupOf([session('s1', sets(10))], T, 'chest')
    const twelve = groupOf([session('s1', sets(12))], T, 'chest')
    expect(twelve).toMatchObject({ fatigue: 1.2, recovery: 0 })
    expect(new Date(twelve.ready_at ?? 0).getTime()).toBeGreaterThan(new Date(ten.ready_at ?? 0).getTime())
  })

  test('effort weighs the sets', () => {
    expect(groupOf([session('s1', sets(5, 'Bench', { rpe: 10 }))], T, 'chest').fatigue).toBe(0.6)
  })

  test('window: 10 days before at is out, a second later in, after at out', () => {
    const at = after(1)
    const startedAt = (start: Date) => [session('s1', sets(5), at, start)]
    expect(groupOf(startedAt(new Date(at.getTime() - 10 * DAY)), at, 'chest').fatigue).toBe(0)
    expect(groupOf(startedAt(new Date(at.getTime() - 10 * DAY + 1000)), at, 'chest').fatigue).toBe(0.5)
    expect(groupOf([session('s1', sets(5), after(2), after(1.5))], at, 'chest').fatigue).toBe(0)
  })

  test('an unfinished session counts from its start, one ending after at with zero hours', () => {
    expect(groupOf([session('s1', sets(5), null, after(-36))], T, 'chest').fatigue).toBe(0.25)
    expect(groupOf([session('s1', sets(5), after(5), after(-1))], T, 'chest').fatigue).toBe(0.5)
  })

  test('sessions add up; sources most first, at most five, none at 0.00', () => {
    const sessions = [
      session('old', sets(1), after(-24 * 9)),
      ...[1, 2, 3, 4, 5, 6].map((n) => session(`s${n}`, sets(n), after(-n))),
    ]
    const chest = groupOf(sessions, T, 'chest')
    expect(chest.sources.map((s) => s.session_id)).toEqual(['s6', 's5', 's4', 's3', 's2'])
    expect(chest.sources[0]).toMatchObject({
      activity_type: 'strength_training',
      end_time: after(-6).toISOString(),
      sets: 6,
    })
    const fresh = [1, 2, 3, 4, 5, 6].reduce((sum, n) => sum + n * 0.1 * 0.5 ** (n / 36), 0)
    expect(chest.fatigue).toBeCloseTo(fresh + 0.1 * 0.5 ** 6, 2)
    expect(groupOf([session('old', sets(1), after(-24 * 9))], T, 'chest').sources).toEqual([])
  })

  test('every group, in catalogue order, the untouched at 100', () => {
    const recovery = recoveryOf(five, T)
    expect(recovery.groups.map((g) => g.muscle_group)).toEqual([...exerciseMuscleGroups])
    expect(recovery.groups.find((g) => g.muscle_group === 'calves')).toEqual({
      fatigue: 0,
      half_life_hours: 24,
      muscle_group: 'calves',
      name: 'Calves',
      ready_at: null,
      recovery: 100,
      sources: [],
    })
    expect(recovery).toMatchObject({
      at: T.toISOString(),
      field: 'sets.exercise',
      ready_percent: 80,
      window_days: 10,
    })
  })
})

describe('muscleRecoveryHistory', () => {
  test('points every step from end back to start, oldest first', () => {
    const records = fatigueSets([session('s1', sets(5))], 'exercise', resolverOf)
    const history = muscleRecoveryHistory(
      records,
      { end: after(12), start: after(-13), step_hours: 6 },
      'sets.exercise',
    )
    expect(history.points.map((p) => p.at)).toEqual([-12, -6, 0, 6, 12].map((h) => after(h).toISOString()))
    expect(history).toMatchObject({
      end: after(12).toISOString(),
      field: 'sets.exercise',
      start: after(-13).toISOString(),
      step_hours: 6,
    })
    const chest = history.points.map((p) => p.recovery.chest)
    expect(chest[0]).toBe(100)
    expect(chest[2]).toBe(50)
    expect(chest[4]).toBeGreaterThan(50)
    expect(Object.keys(history.points[0]?.recovery ?? {})).toEqual([...exerciseMuscleGroups])
  })
})
