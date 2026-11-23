import type { MuscleRecovery, MuscleRecoveryGroup, StrengthPlan } from '@aurboda/api-spec'

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
  isPrimaryStart,
  lastDoneLabel,
  plansForToday,
  readinessLine,
  savedAsPlan,
  splitPlans,
} from './planModel'

const ids = () => {
  let n = 0
  return () => `id${++n}`
}

const plan = (extra: Partial<StrengthPlan> = {}): StrengthPlan => ({
  created_at: '2026-11-10T10:00:00.000Z',
  id: 'p1',
  muscle_groups: [],
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
  it('turns the planned sets into prefills of empty blocks, with set type and cue, and keeps the key', () => {
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
          { note: 'slow', reps: 5, set_type: 'warmup', weight: 60 },
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
    expect(splitPlans([a, b, c, d])).toEqual({ dated: [a, c], saved: [b, d] })
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

describe('plansForToday and isPrimaryStart', () => {
  const now = new Date(2026, 10, 19, 15, 0)

  it('picks the plans planned for the local day', () => {
    const today = plan({ id: 'a', planned_for: '2026-11-19' })
    const tomorrow = plan({ id: 'b', planned_for: '2026-11-20' })
    const saved = plan({ id: 'c' })
    expect(plansForToday([today, tomorrow, saved], now)).toEqual([today])
  })

  it('makes the Start of a plan for today or an overdue one primary', () => {
    expect(isPrimaryStart('2026-11-19', now)).toBe(true)
    expect(isPrimaryStart('2026-11-12', now)).toBe(true)
    expect(isPrimaryStart('2026-11-20', now)).toBe(false)
    expect(isPrimaryStart(null, now)).toBe(false)
  })
})

describe('lastDoneLabel', () => {
  const now = new Date(2026, 10, 19, 15, 0)

  it('names the newest session', () => {
    expect(
      lastDoneLabel(
        [
          { activity_id: 'x', start_time: new Date(2026, 10, 10, 8).toISOString() },
          { activity_id: 'y', start_time: new Date(2026, 10, 17, 8).toISOString() },
        ],
        now,
      ),
    ).toBe('Last done Tue 17 Nov')
  })

  it('adds the year for another year', () => {
    expect(
      lastDoneLabel([{ activity_id: 'x', start_time: new Date(2025, 11, 30, 8).toISOString() }], now),
    ).toBe('Last done Tue 30 Dec 2025')
  })

  it('says when it has not been done', () => {
    expect(lastDoneLabel([], now)).toBe('Not done yet')
  })
})

describe('savedAsPlan', () => {
  const saved = plan({ id: 's', name: 'Full body' })
  const dated = plan({ id: 'd', planned_for: '2026-11-19' })

  it('finds the open saved workout a session was started from', () => {
    expect(savedAsPlan('s', [dated, saved])).toBe(saved)
  })

  it('ignores plans with a day, unknown ids and sessions without a plan', () => {
    expect(savedAsPlan('d', [dated, saved])).toBeUndefined()
    expect(savedAsPlan('x', [dated, saved])).toBeUndefined()
    expect(savedAsPlan(undefined, [dated, saved])).toBeUndefined()
  })
})

describe('readinessLine', () => {
  const now = new Date('2026-11-19T12:00:00Z')
  const group = (
    muscle_group: MuscleRecoveryGroup['muscle_group'],
    recovery: number,
    hoursToReady?: number,
  ): MuscleRecoveryGroup => ({
    fatigue: 0,
    half_life_hours: 24,
    muscle_group,
    name: muscle_group,
    ready_at:
      hoursToReady === undefined ? null : new Date(now.getTime() + hoursToReady * 3_600_000).toISOString(),
    recovery,
    sources: [],
  })
  const recovery = (groups: MuscleRecoveryGroup[]): MuscleRecovery => ({
    at: now.toISOString(),
    field: 'sets.exercise',
    groups,
    ready_percent: 80,
    window_days: 10,
  })

  it('gives no line without muscle groups or recovery', () => {
    expect(readinessLine([], recovery([group('chest', 100)]), now)).toBeUndefined()
    expect(readinessLine(['chest'], undefined, now)).toBeUndefined()
  })

  it('leaves out a group the recovery does not know', () => {
    const r = recovery([group('chest', 100)])
    expect(readinessLine(['chest', 'triceps'], r, now)).toBe('Chest is ready')
    expect(readinessLine(['triceps'], r, now)).toBeUndefined()
  })

  it('says every group is ready', () => {
    const r = recovery([
      group('chest', 100),
      group('shoulders', 90),
      group('triceps', 80),
      group('lower_back', 95),
    ])
    expect(readinessLine(['chest', 'shoulders', 'triceps'], r, now)).toBe(
      'Chest, shoulders and triceps are ready',
    )
    expect(readinessLine(['lower_back'], r, now)).toBe('Lower back is ready')
  })

  it('lists the groups still recovering, most hours first', () => {
    const r = recovery([group('chest', 60, 5), group('shoulders', 100), group('triceps', 40, 20)])
    expect(readinessLine(['chest', 'shoulders', 'triceps'], r, now)).toBe(
      'Still recovering: triceps (20 h), chest (5 h)',
    )
  })
})
