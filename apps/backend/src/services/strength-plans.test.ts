import type { StoredExerciseCatalog, StrengthPlan } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import type { StrengthPlanRecord } from '../db/index.ts'

import { loadExerciseCatalog } from './exercise-catalog.ts'
import {
  compareStrengthPlans,
  selectStrengthPlans,
  serializeStrengthPlan,
  strengthPlanPatch,
  unknownExerciseKey,
} from './strength-plans.ts'

const catalog: StoredExerciseCatalog = loadExerciseCatalog()
const knownKey = catalog.entries[0].key

const plan = (overrides: Partial<StrengthPlan>): StrengthPlan => ({
  created_at: '2026-11-01T10:00:00.000Z',
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Plan',
  note: null,
  planned_for: null,
  sessions: [],
  sets: [{ exercise: 'Squat', reps: 5 }],
  updated_at: '2026-11-01T10:00:00.000Z',
  ...overrides,
})

describe('unknownExerciseKey', () => {
  test('names the first set with a key the catalogue lacks', () => {
    expect(
      unknownExerciseKey(
        [
          { exercise: 'A' },
          { exercise: 'B', exercise_key: knownKey },
          { exercise: 'C', exercise_key: 'nope' },
        ],
        catalog,
      ),
    ).toBe('sets[2].exercise_key: unknown exercise catalogue key "nope"')
  })

  test('accepts known keys and sets without one', () => {
    expect(
      unknownExerciseKey([{ exercise: 'A' }, { exercise: 'B', exercise_key: knownKey }], catalog),
    ).toBeNull()
  })
})

describe('serializeStrengthPlan', () => {
  test('turns dates into ISO strings and keeps the day as written', () => {
    const record: StrengthPlanRecord = {
      created_at: new Date('2026-11-01T10:00:00Z'),
      id: 'p1',
      name: 'Push',
      note: 'Heavy',
      planned_for: '2026-11-19',
      sets: [{ exercise: 'Bench Press', reps: 8, weight: 60 }],
      updated_at: new Date('2026-11-02T10:00:00Z'),
    }
    expect(
      serializeStrengthPlan(record, [{ activity_id: 'a1', start_time: new Date('2026-11-19T07:00:00Z') }]),
    ).toEqual({
      created_at: '2026-11-01T10:00:00.000Z',
      id: 'p1',
      name: 'Push',
      note: 'Heavy',
      planned_for: '2026-11-19',
      sessions: [{ activity_id: 'a1', start_time: '2026-11-19T07:00:00.000Z' }],
      sets: [{ exercise: 'Bench Press', reps: 8, weight: 60 }],
      updated_at: '2026-11-02T10:00:00.000Z',
    })
    expect(serializeStrengthPlan(record).sessions).toEqual([])
  })
})

describe('selectStrengthPlans', () => {
  const session = { activity_id: 'a', start_time: '2026-11-10T08:00:00.000Z' }
  const doneDay = plan({ id: 'done', planned_for: '2026-11-10', sessions: [session] })
  const laterDay = plan({ id: 'later', planned_for: '2026-11-20' })
  const earlierDay = plan({ id: 'earlier', planned_for: '2026-11-18' })
  const routineB = plan({ id: 'routine-b', name: 'beta', sessions: [session] })
  const routineA = plan({ id: 'routine-a', name: 'Alpha' })

  test('open keeps routines, also started ones, and days without a session', () => {
    expect(
      selectStrengthPlans([doneDay, laterDay, routineB, earlierDay, routineA], 'open').map((p) => p.id),
    ).toEqual(['earlier', 'later', 'routine-a', 'routine-b'])
    expect(selectStrengthPlans([doneDay, routineA], undefined).map((p) => p.id)).toEqual(['routine-a'])
  })

  test('all keeps every plan, days first by day, then routines by name', () => {
    expect(
      selectStrengthPlans([routineB, laterDay, routineA, doneDay, earlierDay], 'all').map((p) => p.id),
    ).toEqual(['done', 'earlier', 'later', 'routine-a', 'routine-b'])
  })

  test('ties go by creation', () => {
    const first = plan({ created_at: '2026-11-01T10:00:00.000Z', id: 'first', name: 'Same' })
    const second = plan({ created_at: '2026-11-02T10:00:00.000Z', id: 'second', name: 'same' })
    expect([second, first].toSorted(compareStrengthPlans).map((p) => p.id)).toEqual(['first', 'second'])
    const dayFirst = plan({
      created_at: '2026-11-01T10:00:00.000Z',
      id: 'd1',
      name: 'Z',
      planned_for: '2026-11-19',
    })
    const daySecond = plan({
      created_at: '2026-11-02T10:00:00.000Z',
      id: 'd2',
      name: 'A',
      planned_for: '2026-11-19',
    })
    expect([daySecond, dayFirst].toSorted(compareStrengthPlans).map((p) => p.id)).toEqual(['d1', 'd2'])
  })
})

describe('strengthPlanPatch', () => {
  test('keeps only the given fields, null included', () => {
    expect(strengthPlanPatch({ name: 'X', note: null })).toEqual({ name: 'X', note: null })
    expect(strengthPlanPatch({ planned_for: null })).toEqual({ planned_for: null })
    expect(strengthPlanPatch({ note: '' })).toEqual({ note: null })
  })

  test('an empty body is nothing to update', () => {
    expect(strengthPlanPatch({})).toBeNull()
  })
})
