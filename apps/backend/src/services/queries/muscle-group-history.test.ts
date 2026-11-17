import type { StoredExerciseCatalogEntry } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  type ExerciseSession,
  lastTrainedByGroup,
  muscleGroupHistory,
  muscleGroupOverview,
  type ResolverOf,
} from './muscle-group-history.ts'

const entry = (key: string, name: string, muscles: StoredExerciseCatalogEntry['muscles']) =>
  ({
    aliases: [],
    category: 'strength',
    equipment: [],
    key,
    muscles,
    name,
    same_as: { bodybuild: key },
    search_terms: [],
  }) as StoredExerciseCatalogEntry

const bench = entry('barbell_bench_press', 'Barbell Bench Press', {
  chest: 1,
  front_delts: 0.5,
  triceps: 0.5,
})
const dip = entry('dip', 'Dip', { lower_pecs: 0.75, triceps: 1 })
const row = entry('dumbbell_row', 'Dumbbell Row', { biceps: 0.5, lats: 1 })

const strengthEntries: Record<string, StoredExerciseCatalogEntry> = {
  'bench press': bench,
  'dumbbell row': row,
}
const pushEntries: Record<string, StoredExerciseCatalogEntry> = { ...strengthEntries, dips: dip }
const resolverOf: ResolverOf = (type) => {
  const entries = type === 'push_day' ? pushEntries : strengthEntries
  return (value) => entries[value.trim().toLowerCase()]
}

const set = (exercise: string, weight: number, reps: number) => ({ exercise, reps, weight })

const session = (
  id: string,
  iso: string,
  items: Record<string, unknown>[],
  activity_type = 'strength_training',
): ExerciseSession => ({ activity_type, id, items, start_time: new Date(iso) })

const s1 = session('s1', '2026-01-05T17:00:00Z', [set('Bench Press', 80, 5), set('Dumbbell Row', 30, 10)])
const s2 = session('s2', '2026-03-02T17:00:00Z', [set('bench press', 85, 5), set('Bench Press', 85, 5)])
const s3 = session('s3', '2026-03-10T17:00:00Z', [set('Dumbbell Row', 32, 10), set('Squat Hold', 100, 5)])
const s4 = session('s4', '2026-03-20T17:00:00Z', [set('Dips', 10, 8)], 'push_day')
const sessions = [s3, s1, s4, s2]

const period = { end: new Date('2026-03-31T00:00:00Z'), start: new Date('2026-03-01T00:00:00Z') }

describe('lastTrainedByGroup', () => {
  test('the latest session per group in which it got sets', () => {
    const last = lastTrainedByGroup(sessions, 'exercise', resolverOf)
    expect(last.get('chest')).toEqual(s4.start_time)
    expect(last.get('lats')).toEqual(s3.start_time)
    expect(last.get('shoulders')).toEqual(s2.start_time)
    expect(last.has('calves')).toBe(false)
  })
})

describe('muscleGroupOverview', () => {
  test('every catalogue group in order, with null for the ones never trained', () => {
    const overview = muscleGroupOverview('sets.exercise', 'exercise', sessions, resolverOf)
    expect(overview.field).toBe('sets.exercise')
    expect(overview.groups.slice(0, 4)).toEqual([
      { last_trained: s4.start_time.toISOString(), muscle_group: 'chest', name: 'Chest' },
      { last_trained: s2.start_time.toISOString(), muscle_group: 'shoulders', name: 'Shoulders' },
      { last_trained: null, muscle_group: 'traps', name: 'Traps' },
      { last_trained: s3.start_time.toISOString(), muscle_group: 'lats', name: 'Lats' },
    ])
    expect(overview.groups).toHaveLength(17)
  })
})

describe('muscleGroupHistory', () => {
  const chest = muscleGroupHistory('sets.exercise', 'exercise', 'chest', sessions, resolverOf, period)

  test('the group, the period and when it was last trained', () => {
    expect(chest).toMatchObject({
      end: period.end.toISOString(),
      field: 'sets.exercise',
      last_trained: s4.start_time.toISOString(),
      muscle_group: 'chest',
      name: 'Chest',
      start: period.start.toISOString(),
    })
  })

  test('totals over the period, weighted and rounded', () => {
    expect(chest.totals).toEqual({ set_count: 2.75, total_reps: 16, volume: 910 })
  })

  test('every exercise that trains it, most weighted sets in the period first', () => {
    expect(chest.exercises).toEqual([
      {
        catalog_key: 'barbell_bench_press',
        catalog_name: 'Barbell Bench Press',
        last_time: s2.start_time.toISOString(),
        measures: { set_count: 2, total_reps: 10, volume: 850 },
        session_count: 1,
        value: 'bench press',
        weight: 1,
      },
      {
        catalog_key: 'dip',
        catalog_name: 'Dip',
        last_time: s4.start_time.toISOString(),
        measures: { set_count: 0.75, total_reps: 6, volume: 60 },
        session_count: 1,
        value: 'Dips',
        weight: 0.75,
      },
    ])
  })

  test('an exercise not done in the period is listed with empty measures, after the ones done', () => {
    const lats = muscleGroupHistory('sets.exercise', 'exercise', 'lats', [s1], resolverOf, period)
    expect(lats.exercises).toEqual([
      {
        catalog_key: 'dumbbell_row',
        catalog_name: 'Dumbbell Row',
        last_time: s1.start_time.toISOString(),
        measures: {},
        session_count: 0,
        value: 'Dumbbell Row',
        weight: 1,
      },
    ])
    expect(lats.sessions).toEqual([])
    expect(lats.totals).toEqual({})
    expect(lats.last_trained).toBe(s1.start_time.toISOString())
  })

  test('ties on sets sort by the latest done first', () => {
    const later = session('s5', '2026-02-01T17:00:00Z', [set('Dips', 10, 8)], 'push_day')
    const history = muscleGroupHistory('sets.exercise', 'exercise', 'chest', [s1, later], resolverOf, period)
    expect(history.exercises.map((e) => e.value)).toEqual(['Dips', 'Bench Press'])
  })

  test('the sessions of the period that trained it, newest first, a subtype resolved by its own', () => {
    expect(chest.sessions).toEqual([
      {
        activity_type: 'push_day',
        exercises: ['Dips'],
        id: 's4',
        measures: { set_count: 0.75, total_reps: 6, volume: 60 },
        start_time: s4.start_time.toISOString(),
      },
      {
        activity_type: 'strength_training',
        exercises: ['bench press'],
        id: 's2',
        measures: { set_count: 2, total_reps: 10, volume: 850 },
        start_time: s2.start_time.toISOString(),
      },
    ])
  })

  test('a session that trains nothing of the group is left out', () => {
    const lats = muscleGroupHistory('sets.exercise', 'exercise', 'lats', sessions, resolverOf, period)
    expect(lats.sessions.map((s) => s.id)).toEqual(['s3'])
  })

  test('a title is carried', () => {
    const titled = { ...s2, title: 'Push' }
    const history = muscleGroupHistory('sets.exercise', 'exercise', 'chest', [titled], resolverOf, period)
    expect(history.sessions[0].title).toBe('Push')
  })
})
