import type { StrengthPlan } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import type { ExerciseBlock } from './sessionModel'

import {
  blocksFromPlan,
  isOverdue,
  liveBlocksFromPlan,
  planBody,
  planDayLabel,
  planFormError,
  planSetsFromBlocks,
  planSummary,
  splitPlans,
} from './planModel'

const ids = () => {
  let n = 0
  return () => `id${++n}`
}

const plan = (extra: Partial<StrengthPlan> = {}): StrengthPlan => ({
  created_at: '2026-11-10T10:00:00.000Z',
  id: 'p1',
  name: 'Push day',
  note: null,
  planned_for: null,
  sessions: [],
  sets: [],
  updated_at: '2026-11-10T10:00:00.000Z',
  ...extra,
})

describe('blocksFromPlan', () => {
  it('gives a block per run of one exercise, with the key on the block', () => {
    const blocks = blocksFromPlan(
      [
        { exercise: 'Squat', exercise_key: 'barbell_squat', reps: 5, weight: 100 },
        { exercise: 'Squat', exercise_key: 'barbell_squat', reps: 5, weight: 100 },
        { exercise: 'Row', reps: 10 },
        { exercise: 'Squat', reps: 5 },
      ],
      ids(),
    )
    expect(blocks).toEqual([
      {
        catalog_key: 'barbell_squat',
        exercise: 'Squat',
        id: 'id1',
        planned: [],
        sets: [
          { exercise: 'Squat', reps: 5, weight: 100 },
          { exercise: 'Squat', reps: 5, weight: 100 },
        ],
      },
      { exercise: 'Row', id: 'id2', planned: [], sets: [{ exercise: 'Row', reps: 10 }] },
      { exercise: 'Squat', id: 'id3', planned: [], sets: [{ exercise: 'Squat', reps: 5 }] },
    ])
  })

  it('takes the first key found when only some sets carry one', () => {
    const [block] = blocksFromPlan(
      [
        { exercise: 'Bench', reps: 8 },
        { exercise: 'Bench', exercise_key: 'barbell_bench_press', reps: 8 },
      ],
      ids(),
    )
    expect(block.catalog_key).toBe('barbell_bench_press')
    expect(block.sets).toEqual([
      { exercise: 'Bench', reps: 8 },
      { exercise: 'Bench', reps: 8 },
    ])
  })

  it('gives no blocks for no sets', () => {
    expect(blocksFromPlan([], ids())).toEqual([])
  })
})

describe('liveBlocksFromPlan', () => {
  it('turns the planned sets into prefills of empty blocks and keeps the key', () => {
    const blocks = liveBlocksFromPlan(
      [
        {
          exercise: 'Squat',
          exercise_key: 'barbell_squat',
          note: 'slow',
          reps: 5,
          set_type: 'warmup',
          weight: 60,
        },
        { exercise: 'Squat', exercise_key: 'barbell_squat', reps: 5, weight: 100 },
        { exercise: 'Plank', time: 60 },
      ],
      ids(),
    )
    expect(blocks).toEqual([
      {
        catalog_key: 'barbell_squat',
        exercise: 'Squat',
        id: 'id1',
        planned: [
          { reps: 5, weight: 60 },
          { reps: 5, weight: 100 },
        ],
        sets: [],
      },
      { exercise: 'Plank', id: 'id2', planned: [{ time: 60 }], sets: [] },
    ])
  })
})

describe('planSetsFromBlocks', () => {
  it('puts the block key on every set and keeps only the planned set fields', () => {
    const blocks: ExerciseBlock[] = [
      {
        catalog_key: 'barbell_squat',
        exercise: 'Squat',
        id: 'a',
        planned: [],
        sets: [
          { exercise: 'Squat', note: '', reps: 5, rpe: 8, set_type: 'normal', weight: 100 },
          { exercise: 'Squat', note: 'last one heavy', reps: 3, set_type: 'bogus', weight: 110 },
        ],
      },
      { exercise: 'Plank', id: 'b', planned: [{ time: 30 }], sets: [{ time: 60 }] },
    ]
    expect(planSetsFromBlocks(blocks)).toEqual([
      { exercise: 'Squat', exercise_key: 'barbell_squat', reps: 5, set_type: 'normal', weight: 100 },
      { exercise: 'Squat', exercise_key: 'barbell_squat', note: 'last one heavy', reps: 3, weight: 110 },
      { exercise: 'Plank', time: 60 },
    ])
  })

  it('round-trips the sets of a plan', () => {
    const sets = [
      { exercise: 'Squat', exercise_key: 'barbell_squat', reps: 5, weight: 100 },
      { exercise: 'Row', reps: 10 },
    ]
    expect(planSetsFromBlocks(blocksFromPlan(sets, ids()))).toEqual(sets)
  })
})

describe('planDayLabel', () => {
  const now = new Date(2026, 10, 17, 14, 0)

  it('names a routine nothing', () => {
    expect(planDayLabel(null, now)).toBeUndefined()
  })

  it('names the nearby days', () => {
    expect(planDayLabel('2026-11-17', now)).toBe('Today')
    expect(planDayLabel('2026-11-18', now)).toBe('Tomorrow')
    expect(planDayLabel('2026-11-16', now)).toBe('Yesterday')
  })

  it('gives a weekday and date otherwise', () => {
    expect(planDayLabel('2026-11-10', now)).toBe('Tue 10 Nov')
    expect(planDayLabel('2026-12-17', now)).toBe('Thu 17 Dec')
  })

  it('adds the year for a day in another year', () => {
    expect(planDayLabel('2027-01-05', now)).toBe('Tue 5 Jan 2027')
  })

  it('reads the day as a local day near midnight', () => {
    expect(planDayLabel('2026-11-17', new Date(2026, 10, 17, 0, 5))).toBe('Today')
    expect(planDayLabel('2026-11-17', new Date(2026, 10, 17, 23, 55))).toBe('Today')
    expect(planDayLabel('2026-11-18', new Date(2026, 10, 17, 23, 55))).toBe('Tomorrow')
  })
})

describe('isOverdue', () => {
  const now = new Date(2026, 10, 17, 0, 5)

  it('is overdue only before today', () => {
    expect(isOverdue('2026-11-16', now)).toBe(true)
    expect(isOverdue('2026-11-17', now)).toBe(false)
    expect(isOverdue('2026-11-18', now)).toBe(false)
    expect(isOverdue(null, now)).toBe(false)
  })
})

describe('planSummary', () => {
  it('counts exercises and sets', () => {
    expect(
      planSummary(
        plan({
          sets: [
            { exercise: 'Squat', reps: 5 },
            { exercise: 'Squat', reps: 5 },
            { exercise: 'Row', reps: 10 },
            { exercise: 'squat', reps: 5 },
          ],
        }),
      ),
    ).toBe('2 exercises, 4 sets')
    expect(planSummary(plan({ sets: [{ exercise: 'Plank', time: 60 }] }))).toBe('1 exercise, 1 set')
  })
})

describe('splitPlans', () => {
  it('keeps the order within each kind', () => {
    const a = plan({ id: 'a', planned_for: '2026-11-18' })
    const b = plan({ id: 'b' })
    const c = plan({ id: 'c', planned_for: '2026-11-20' })
    const d = plan({ id: 'd' })
    expect(splitPlans([a, b, c, d])).toEqual({ dated: [a, c], routines: [b, d] })
  })
})

describe('planFormError', () => {
  const blocks: ExerciseBlock[] = [{ exercise: 'Squat', id: 'a', planned: [], sets: [{ reps: 5 }] }]

  it('asks for a name first', () => {
    expect(planFormError('  ', blocks)).toBe('Give the plan a name.')
  })

  it('asks for a set', () => {
    expect(planFormError('Push', [])).toBe('Add at least one set.')
    expect(planFormError('Push', [{ exercise: 'Squat', id: 'a', planned: [], sets: [] }])).toBe(
      'Add at least one set.',
    )
  })

  it('accepts a named plan with sets', () => {
    expect(planFormError('Push', blocks)).toBeUndefined()
  })
})

describe('planBody', () => {
  const blocks: ExerciseBlock[] = [{ exercise: 'Squat', id: 'a', planned: [], sets: [{ reps: 5 }] }]

  it('makes a routine with no note from empty fields', () => {
    expect(planBody({ day: '', name: ' Push ', note: '  ' }, blocks)).toEqual({
      name: 'Push',
      note: null,
      planned_for: null,
      sets: [{ exercise: 'Squat', reps: 5 }],
    })
  })

  it('keeps the day and the note', () => {
    expect(planBody({ day: '2026-11-19', name: 'Push', note: ' Go heavy ' }, blocks)).toMatchObject({
      note: 'Go heavy',
      planned_for: '2026-11-19',
    })
  })
})
