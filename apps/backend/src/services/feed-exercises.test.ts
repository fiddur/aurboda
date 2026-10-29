import type { ActivityItemHistory, DataSchemaDefinition } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import {
  exerciseItemPath,
  formatExerciseLine,
  formatExerciseSet,
  resolvePostExercises,
  resolveSharedExercises,
  type SharedExercisesDeps,
  toStructuredExercise,
} from './feed-exercises.ts'

const strengthSchema: DataSchemaDefinition = {
  fields: [
    { name: 'workout_type', type: 'string' },
    {
      item_fields: [
        { is_categorical: true, name: 'exercise', required: true, type: 'string' },
        { name: 'reps', type: 'number' },
        { name: 'weight', type: 'number' },
      ],
      name: 'sets',
      type: 'list',
    },
  ],
} as DataSchemaDefinition

const history: ActivityItemHistory = {
  activity_id: 'merged:a1',
  field: 'sets.exercise',
  groups: [
    {
      items: [
        { exercise: 'Bench Press', reps: 8, set_type: 'warmup', weight: 60 },
        { exercise: 'Bench Press', reps: 8, rpe: 8, weight: 80 },
      ],
      measures: { e1rm: 101.3, max_weight: 80, set_count: 1, volume: 640 },
      records: ['e1rm'],
      trend: [],
      value: 'Bench Press',
    },
  ],
  totals: {},
  trend_half_life_days: 120,
}

const deps = (over: Partial<SharedExercisesDeps> = {}) => {
  const calls: string[] = []
  const d: SharedExercisesDeps = {
    getDataSchema: async () => strengthSchema,
    queryItemHistory: async (_user, id, path) => {
      calls.push(`${id} ${path}`)
      return history
    },
    ...over,
  }
  return { calls, deps: d }
}

describe('exerciseItemPath', () => {
  it("names the first list field's categorical item field", () => {
    expect(exerciseItemPath(strengthSchema)).toBe('sets.exercise')
  })

  it('is undefined without a categorical item field', () => {
    expect(exerciseItemPath(undefined)).toBeUndefined()
    expect(
      exerciseItemPath({ fields: [{ name: 'notes', type: 'string' }] } as DataSchemaDefinition),
    ).toBeUndefined()
    expect(
      exerciseItemPath({
        fields: [{ item_fields: [{ name: 'reps', type: 'number' }], name: 'sets', type: 'list' }],
      } as DataSchemaDefinition),
    ).toBeUndefined()
  })
})

describe('formatExerciseSet', () => {
  it('writes each kind of set in the Gravl notation', () => {
    expect(formatExerciseSet({ reps: 8, weight: 80 })).toBe('8×80 kg')
    expect(formatExerciseSet({ reps: 12 })).toBe('12 reps')
    expect(formatExerciseSet({ weight: 20 })).toBe('20 kg')
    expect(formatExerciseSet({ time: 90 })).toBe('1:30')
    expect(formatExerciseSet({ time: 45 })).toBe('0:45')
    expect(formatExerciseSet({ reps: 10, time: 40, weight: 5 })).toBe('10×5 kg 0:40')
    expect(formatExerciseSet({})).toBe('—')
  })

  it('flags warm-up, drop and failure sets', () => {
    expect(formatExerciseSet({ reps: 12, set_type: 'warmup', weight: 5 })).toBe('12×5 kg (w)')
    expect(formatExerciseSet({ reps: 6, set_type: 'drop_set', weight: 40 })).toBe('6×40 kg (drop)')
    expect(formatExerciseSet({ reps: 15, set_type: 'failure' })).toBe('15 reps (f)')
    expect(formatExerciseSet({ reps: 5, set_type: 'normal', weight: 50 })).toBe('5×50 kg')
  })
})

describe('formatExerciseLine', () => {
  it('joins the sets, e1RM, volume and records', () => {
    expect(
      formatExerciseLine({
        measures: { e1rm: 15.2, volume: 196 },
        name: 'Single Arm Dumbbell Tricep Extension',
        records: ['e1rm'],
        sets: [
          { reps: 12, set_type: 'warmup', weight: 5 },
          { reps: 10, weight: 10 },
          { reps: 8, weight: 12 },
        ],
      }),
    ).toBe(
      'Single Arm Dumbbell Tricep Extension: 12×5 kg (w), 10×10 kg, 8×12 kg · e1RM 15.2 kg · volume 196 kg · PR e1RM',
    )
  })

  it('rounds the measures to one decimal and lists every record', () => {
    expect(
      formatExerciseLine({
        measures: { e1rm: 101.33333, volume: 1250.25 },
        name: 'Squat',
        records: ['e1rm', 'max_weight'],
        sets: [{ reps: 5, weight: 100 }],
      }),
    ).toBe('Squat: 5×100 kg · e1RM 101.3 kg · volume 1250.3 kg · PR e1RM · PR weight')
  })

  it('leaves out absent measures', () => {
    expect(
      formatExerciseLine({
        measures: { max_time: 60, set_count: 1 },
        name: 'Plank',
        records: [],
        sets: [{ time: 60 }],
      }),
    ).toBe('Plank: 1:00')
  })
})

describe('resolveSharedExercises', () => {
  it('reads the item history over the merged view of the activity', async () => {
    const { calls, deps: d } = deps()
    const exercises = await resolveSharedExercises('alice', 'a1', 'strength_training', d)
    expect(calls).toEqual(['merged:a1 sets.exercise'])
    expect(exercises).toEqual([
      {
        measures: { e1rm: 101.3, max_weight: 80, set_count: 1, volume: 640 },
        name: 'Bench Press',
        records: ['e1rm'],
        sets: [
          { reps: 8, set_type: 'warmup', weight: 60 },
          { reps: 8, weight: 80 },
        ],
      },
    ])
  })

  it('is empty when the type has no categorical item field', async () => {
    const { calls, deps: d } = deps({ getDataSchema: async () => null })
    expect(await resolveSharedExercises('alice', 'a1', 'running', d)).toEqual([])
    expect(calls).toEqual([])
  })

  it('is empty when the activity is gone', async () => {
    const { deps: d } = deps({ queryItemHistory: async () => null })
    expect(await resolveSharedExercises('alice', 'a1', 'strength_training', d)).toEqual([])
  })
})

describe('resolvePostExercises', () => {
  it('resolves nothing unless the post opted in', async () => {
    const { calls, deps: d } = deps()
    expect(
      await resolvePostExercises('alice', { activity_id: 'a1', include_exercises: false }, 'x', d),
    ).toEqual([])
    expect(
      await resolvePostExercises('alice', { activity_id: null, include_exercises: true }, 'x', d),
    ).toEqual([])
    expect(calls).toEqual([])
    expect(
      await resolvePostExercises('alice', { activity_id: 'a1', include_exercises: true }, 'x', d),
    ).toHaveLength(1)
  })
})

describe('toStructuredExercise', () => {
  it('uses lowerCamelCase keys and wire units', () => {
    expect(
      toStructuredExercise({
        measures: { e1rm: 101.3, max_time: 30, max_weight: 80, set_count: 2, volume: 640 },
        name: 'Bench Press',
        records: ['e1rm', 'max_weight'],
        sets: [{ reps: 8, set_type: 'warmup', weight: 60 }, { time: 30 }],
      }),
    ).toEqual({
      metrics: [
        { key: 'e1rm', unit: 'kg', value: 101.3 },
        { key: 'maxTime', unit: 'seconds', value: 30 },
        { key: 'maxWeight', unit: 'kg', value: 80 },
        { key: 'setCount', value: 2 },
        { key: 'volume', unit: 'kg', value: 640 },
      ],
      name: 'Bench Press',
      records: ['e1rm', 'maxWeight'],
      sets: [{ reps: 8, setType: 'warmup', weight: 60 }, { time: 30 }],
    })
  })

  it('leaves records out when the session set none', () => {
    expect(toStructuredExercise({ measures: {}, name: 'Row', records: [], sets: [] })).toEqual({
      metrics: [],
      name: 'Row',
      sets: [],
    })
  })
})
