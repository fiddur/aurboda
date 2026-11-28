import type {
  ActivitySessionGroup,
  StrengthScore,
  StrengthScoreGroupResult,
  StrengthScoreLift,
  StrengthScoreSet,
} from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  equipmentOptions,
  exercisePoints,
  exerciseSummaryLine,
  filterExercises,
  liftsNotDone,
  muscleGroupOptions,
  muscleSearch,
  musclesLabel,
  muscleSplitLine,
  parseMuscleParam,
} from './exercisesModel'

const group = (
  value: ActivitySessionGroup['value'],
  extra: Partial<ActivitySessionGroup> = {},
): ActivitySessionGroup => ({
  avg_hr_count: 0,
  count: 1,
  first_start_time: '2026-09-01T07:00:00.000Z',
  last_start_time: '2026-09-01T07:00:00.000Z',
  session_ids: [],
  value,
  ...extra,
})

const bench = group('Bench Press', {
  best_set: { reps: 5, weight: 90 },
  catalog_key: 'barbell_bench_press',
  count: 10,
  equipment: ['barbell'],
  last_start_time: '2026-09-20T07:00:00.000Z',
  measures: { e1rm: 105, volume: 9000 },
  muscle_groups: [
    { muscle_group: 'chest', weight: 1 },
    { muscle_group: 'shoulders', weight: 0.5 },
    { muscle_group: 'triceps', weight: 0.5 },
  ],
})
const pushdown = group('Pushdown', {
  best_set: { reps: 9, weight: 24 },
  catalog_key: 'cable_pushdown',
  count: 4,
  equipment: ['cable'],
  last_start_time: '2026-09-25T07:00:00.000Z',
  muscle_groups: [{ muscle_group: 'triceps', weight: 1 }],
})
const dips = group('Dips', {
  catalog_key: 'dips',
  count: 6,
  equipment: [],
  last_start_time: '2026-09-10T07:00:00.000Z',
  muscle_groups: [
    { muscle_group: 'triceps', weight: 0.75 },
    { muscle_group: 'chest', weight: 0.75 },
  ],
})
const mystery = group('Mystery move', { count: 2, last_start_time: '2026-09-28T07:00:00.000Z' })
const none = group(null, { count: 20, last_start_time: '2026-09-30T07:00:00.000Z' })
const groups = [bench, pushdown, dips, mystery, none]

const values = (gs: ActivitySessionGroup[]) => gs.map((g) => g.value)

describe('muscleGroupOptions', () => {
  test('the 17 muscle groups by name in catalogue order', () => {
    const options = muscleGroupOptions()
    expect(options).toHaveLength(17)
    expect(options[0]).toEqual({ label: 'Chest', value: 'chest' })
    expect(options[4]).toEqual({ label: 'Middle back', value: 'middle_back' })
  })
})

describe('the muscle parameter', () => {
  test('reads a known group and ignores anything else', () => {
    expect(parseMuscleParam({ muscle: 'triceps' })).toBe('triceps')
    expect(parseMuscleParam({ muscle: 'wings' })).toBeUndefined()
    expect(parseMuscleParam({})).toBeUndefined()
  })

  test('writes the group and keeps other parameters, and removes it for all muscles', () => {
    expect(muscleSearch('', 'triceps')).toBe('?muscle=triceps')
    expect(muscleSearch('?embed=1&muscle=chest', 'triceps')).toBe('?embed=1&muscle=triceps')
    expect(muscleSearch('?embed=1&muscle=chest', undefined)).toBe('?embed=1')
    expect(muscleSearch('?muscle=chest', undefined)).toBe('')
  })
})

describe('filterExercises', () => {
  test('without filters: every exercise in the sort order, the no-value group last', () => {
    const { shown, split } = filterExercises(groups, { query: '', sortKey: 'recent' })
    expect(values(shown)).toEqual(['Mystery move', 'Pushdown', 'Bench Press', 'Dips', null])
    expect(split).toBeUndefined()
  })

  test('a muscle group: those that mainly work it first, then those that also do, each sorted', () => {
    const { shown, split } = filterExercises(groups, { muscle: 'triceps', query: '', sortKey: 'count' })
    expect(values(shown)).toEqual(['Dips', 'Pushdown', 'Bench Press'])
    expect(split).toEqual({ also: 1, mainly: 2 })
  })

  test('equipment keeps the exercises using it, and drops the no-value group', () => {
    expect(
      values(filterExercises(groups, { equipment: 'cable', query: '', sortKey: 'recent' }).shown),
    ).toEqual(['Pushdown'])
  })

  test('muscle, equipment and search combine', () => {
    expect(
      values(
        filterExercises(groups, { equipment: 'barbell', muscle: 'chest', query: 'bench', sortKey: 'recent' })
          .shown,
      ),
    ).toEqual(['Bench Press'])
    expect(filterExercises(groups, { muscle: 'calves', query: '', sortKey: 'recent' })).toEqual({
      shown: [],
      split: { also: 0, mainly: 0 },
    })
  })
})

describe('muscleSplitLine', () => {
  test('both parts, one part, or none', () => {
    expect(muscleSplitLine({ also: 1, mainly: 2 }, 'triceps')).toBe('2 mainly work Triceps, 1 also work it')
    expect(muscleSplitLine({ also: 0, mainly: 2 }, 'triceps')).toBe('2 mainly work Triceps')
    expect(muscleSplitLine({ also: 3, mainly: 0 }, 'triceps')).toBe('3 also work it')
    expect(muscleSplitLine({ also: 0, mainly: 0 }, 'triceps')).toBe(
      'No exercise in this period works Triceps.',
    )
  })
})

describe('equipmentOptions', () => {
  test('only the equipment the exercises use, by name', () => {
    expect(equipmentOptions(groups)).toEqual([
      { label: 'Barbell', value: 'barbell' },
      { label: 'Cable', value: 'cable' },
    ])
  })
})

describe('musclesLabel', () => {
  test('the mainly worked groups first, then the others', () => {
    expect(musclesLabel(bench)).toEqual({ more: 0, primary: ['Chest'], secondary: ['Shoulders', 'Triceps'] })
  })

  test('at most four, the rest counted', () => {
    const many = group('Clean', {
      muscle_groups: [
        { muscle_group: 'quadriceps', weight: 0.5 },
        { muscle_group: 'glutes', weight: 1 },
        { muscle_group: 'hamstrings', weight: 0.75 },
        { muscle_group: 'traps', weight: 0.5 },
        { muscle_group: 'lower_back', weight: 0.5 },
        { muscle_group: 'calves', weight: 0.25 },
      ],
    })
    expect(musclesLabel(many)).toEqual({
      more: 2,
      primary: ['Glutes', 'Hamstrings'],
      secondary: ['Quadriceps', 'Traps'],
    })
  })

  test('an unmatched exercise has none', () => {
    expect(musclesLabel(mystery)).toEqual({ more: 0, primary: [], secondary: [] })
  })
})

const best = (overrides: Partial<StrengthScoreSet> = {}): StrengthScoreSet => ({
  activity_type: 'strength_training',
  catalog_key: 'barbell_bench_press',
  e1rm: 105,
  reps: 5,
  session_id: 's1',
  start_time: '2026-09-20T07:00:00.000Z',
  value: 'Bench Press',
  weight: 90,
  ...overrides,
})

const lift = (overrides: Partial<StrengthScoreLift>): StrengthScoreLift => ({
  catalog_keys: [],
  counted: false,
  lift: 'x',
  name: 'X',
  score: null,
  ...overrides,
})

const scoreGroup = (overrides: Partial<StrengthScoreGroupResult>): StrengthScoreGroupResult => ({
  group: 'chest',
  lifts: [],
  muscle_groups: ['chest'],
  name: 'Chest',
  score: null,
  ...overrides,
})

const score: StrengthScore = {
  at: '2026-10-01T00:00:00.000Z',
  field: 'sets.exercise',
  groups: [
    scoreGroup({
      lifts: [
        lift({
          best: best(),
          catalog_keys: ['barbell_bench_press'],
          counted: true,
          lift: 'bench',
          score: 92,
        }),
        lift({ catalog_keys: ['incline_bench'], lift: 'incline', name: 'Incline bench press' }),
      ],
    }),
    scoreGroup({
      group: 'triceps',
      lifts: [
        lift({
          best: best({ catalog_key: 'dips' }),
          catalog_keys: ['dips', 'weighted_dips'],
          counted: false,
          lift: 'dips',
          score: 70,
        }),
      ],
      muscle_groups: ['triceps'],
      name: 'Triceps',
    }),
    scoreGroup({
      group: 'back',
      lifts: [
        lift({
          best: best({ catalog_key: 'row' }),
          catalog_keys: ['row'],
          counted: true,
          lift: 'row',
          score: 80,
        }),
        lift({ catalog_keys: ['pull_up'], lift: 'pull_up', name: 'Pull-up' }),
        lift({ catalog_keys: ['deadlift'], lift: 'deadlift', name: 'Deadlift' }),
      ],
      muscle_groups: ['lats', 'middle_back', 'lower_back'],
      name: 'Back',
    }),
  ],
  missing: [],
  score: 80,
  window_days: 90,
}

describe('exercisePoints', () => {
  test('a counted lift and one not counted', () => {
    expect(exercisePoints(score, 'barbell_bench_press')).toEqual({ counted: true, points: 92 })
    expect(exercisePoints(score, 'weighted_dips')).toEqual({ counted: false, points: 70 })
  })

  test('none for an exercise that is no scoring lift, a lift without a score, or no score', () => {
    expect(exercisePoints(score, 'cable_pushdown')).toBeUndefined()
    expect(exercisePoints(score, 'incline_bench')).toBeUndefined()
    expect(exercisePoints(score, undefined)).toBeUndefined()
    expect(exercisePoints(undefined, 'barbell_bench_press')).toBeUndefined()
  })

  test('a lift in two score groups: the counted match, then the highest score, whatever the group order', () => {
    const twoGroups = (counted: boolean, other: boolean): StrengthScore['groups'] => [
      scoreGroup({
        lifts: [lift({ catalog_keys: ['dips'], counted: other, lift: 'dips', score: 85 })],
      }),
      scoreGroup({
        group: 'triceps',
        lifts: [lift({ catalog_keys: ['dips'], counted, lift: 'dips', score: 70 })],
        muscle_groups: ['triceps'],
        name: 'Triceps',
      }),
    ]
    const both = (scoreGroups: StrengthScore['groups']) => [
      exercisePoints({ ...score, groups: scoreGroups }, 'dips'),
      exercisePoints({ ...score, groups: scoreGroups.toReversed() }, 'dips'),
    ]
    expect(both(twoGroups(true, false))).toEqual([
      { counted: true, points: 70 },
      { counted: true, points: 70 },
    ])
    expect(both(twoGroups(false, false))).toEqual([
      { counted: false, points: 85 },
      { counted: false, points: 85 },
    ])
    const unscored = [
      scoreGroup({ lifts: [lift({ catalog_keys: ['dips'], lift: 'dips' })] }),
      ...twoGroups(true, false).slice(1),
    ]
    expect(both(unscored)).toEqual([
      { counted: true, points: 70 },
      { counted: true, points: 70 },
    ])
  })
})

describe('exerciseSummaryLine', () => {
  test('the phone line leaves out what is missing', () => {
    expect(exerciseSummaryLine(bench)).toBe('10× · 9\u2009000 kg · best set 90 kg × 5 · e1RM 105 kg')
    expect(exerciseSummaryLine(dips)).toBe('6×')
  })
})

describe('liftsNotDone', () => {
  test("the muscle's score group lifts without a best set", () => {
    const result = liftsNotDone(score, 'chest')
    expect(result?.group.name).toBe('Chest')
    expect(result?.lifts.map((l) => l.name)).toEqual(['Incline bench press'])
  })

  test('lats and middle back belong to Back', () => {
    expect(liftsNotDone(score, 'lats')?.lifts.map((l) => l.name)).toEqual(['Pull-up', 'Deadlift'])
    expect(liftsNotDone(score, 'middle_back')?.group.name).toBe('Back')
  })

  test('none when every lift has a best set, the muscle has no score group, or no score', () => {
    expect(liftsNotDone(score, 'triceps')).toBeUndefined()
    expect(liftsNotDone(score, 'calves')).toBeUndefined()
    expect(liftsNotDone(undefined, 'chest')).toBeUndefined()
    expect(liftsNotDone(score, undefined)).toBeUndefined()
  })
})
