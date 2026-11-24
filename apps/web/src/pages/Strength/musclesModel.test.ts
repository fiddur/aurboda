import {
  type ChartDataBreakdownBucket,
  type ExerciseMuscleGroup,
  exerciseMuscleGroups,
  type MuscleGroupOverview,
  type MuscleRecovery,
  type MuscleRecoveryGroup,
  NO_MUSCLE_GROUP_NAME,
  type StrengthScore,
  type StrengthScoreGroupResult,
  type StrengthScoreHistory,
  UNMAPPED_MUSCLE_GROUP_NAME,
} from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import {
  anySets,
  BODY_REGIONS,
  changeInDaysLabel,
  changeWords,
  extremesLine,
  isNeglected,
  muscleRows,
  muscleSections,
  nameList,
  newestSource,
  noStrengthSessions,
  notScoredLabel,
  SCORE_CHANGE_COLUMN,
  recoveryText,
  scoredAsOneNote,
  scoreLine,
  SET_WINDOWS,
  setsPeriod,
  setsText,
  setWindows,
  shortReadyLabel,
  statusLine,
  unmatchedSets,
  unscoredText,
  windowHeights,
} from './musclesModel'

const HOUR = 3_600_000
const now = new Date(2026, 11, 3, 15, 0)
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).toISOString()
const daysAgo = (n: number) => new Date(2026, 11, 3 - n, 10).toISOString()

const bucket = (iso: string, series: Record<string, number>): ChartDataBreakdownBucket => ({
  bucket_start: iso,
  series,
})

const overview = (last: Partial<Record<ExerciseMuscleGroup, string | null>> = {}): MuscleGroupOverview => ({
  field: 'sets.exercise',
  groups: exerciseMuscleGroups.map((g) => ({
    last_trained: last[g] ?? null,
    muscle_group: g,
    name: g === 'middle_back' ? 'Middle back' : g[0].toUpperCase() + g.slice(1),
  })),
})

const recoveryGroup = (
  muscle_group: ExerciseMuscleGroup,
  recovery: number,
  extra: Partial<MuscleRecoveryGroup> = {},
): MuscleRecoveryGroup => ({
  fatigue: (100 - recovery) / 100,
  half_life_hours: 24,
  muscle_group,
  name: muscle_group[0].toUpperCase() + muscle_group.slice(1),
  ready_at: null,
  recovery,
  sources: [],
  ...extra,
})

const recovery = (groups: MuscleRecoveryGroup[]): MuscleRecovery => ({
  at: now.toISOString(),
  field: 'sets.exercise',
  groups,
  ready_percent: 80,
  window_days: 10,
})

const scoreGroup = (extra: Partial<StrengthScoreGroupResult>): StrengthScoreGroupResult => ({
  group: 'back',
  lifts: [],
  muscle_groups: ['lats', 'middle_back'],
  name: 'Back',
  score: 90,
  ...extra,
})

const score = (groups: StrengthScoreGroupResult[]): StrengthScore => ({
  at: now.toISOString(),
  field: 'sets.exercise',
  groups,
  missing: [],
  score: 80,
  window_days: 90,
})

describe('setsPeriod', () => {
  test('is the 91 local days ending today', () => {
    const period = setsPeriod(now)
    expect(period.start).toBe(new Date(2026, 8, 4).toISOString())
    expect(period.end).toBe(new Date(2026, 11, 3, 23, 59, 59, 999).toISOString())
  })
})

describe('setWindows', () => {
  test('sums daily buckets into 13 windows of seven days, the last ending today', () => {
    const windows = setWindows(
      [
        bucket(day(2026, 12, 3), { Chest: 2 }),
        bucket(day(2026, 11, 27), { Chest: 1 }),
        bucket(day(2026, 11, 26), { Chest: 4 }),
        bucket(day(2026, 9, 4), { Chest: 3 }),
        bucket(day(2026, 9, 3), { Chest: 100 }),
      ],
      now,
    )
    const chest = windows.get('Chest')
    expect(chest).toHaveLength(SET_WINDOWS)
    expect(chest?.[12]).toBe(3)
    expect(chest?.[11]).toBe(4)
    expect(chest?.[0]).toBe(3)
    expect(chest?.reduce((a, b) => a + b, 0)).toBe(10)
  })

  test('crosses a month boundary and skips missing days', () => {
    const windows = setWindows(
      [bucket(day(2026, 11, 30), { Lats: 1.5 }), bucket(day(2026, 12, 1), { Lats: 2 })],
      now,
    )
    expect(windows.get('Lats')?.slice(-2)).toEqual([0, 3.5])
  })

  test('counts unmatched sets and tells whether there are any', () => {
    const windows = setWindows([bucket(day(2026, 12, 1), { [UNMAPPED_MUSCLE_GROUP_NAME]: 3, Chest: 1 })], now)
    expect(unmatchedSets(windows)).toBe(3)
    expect(anySets(windows)).toBe(true)
    expect(anySets(new Map())).toBe(false)
    expect(unmatchedSets(new Map())).toBe(0)
  })

  test('tells when there is no strength session at all', () => {
    const windows = setWindows([bucket(day(2026, 12, 1), { Chest: 1 })], now)
    expect(noStrengthSessions(overview(), new Map())).toBe(true)
    expect(noStrengthSessions(overview(), windows)).toBe(false)
    expect(noStrengthSessions(overview({ calves: daysAgo(200) }), new Map())).toBe(false)
  })
})

describe('BODY_REGIONS', () => {
  test('covers every muscle group exactly once', () => {
    const covered = BODY_REGIONS.flatMap((r) => r.groups)
    expect(covered.toSorted()).toEqual([...exerciseMuscleGroups].toSorted())
  })
})

describe('muscleRows', () => {
  const windows = setWindows(
    [
      bucket(day(2026, 12, 2), { Chest: 4, Lats: 2, [NO_MUSCLE_GROUP_NAME]: 7 }),
      bucket(day(2026, 10, 1), { Chest: 9.4 }),
    ],
    now,
  )
  const rows = muscleRows({
    groups: overview({ chest: daysAgo(1), lats: daysAgo(1), traps: daysAgo(200) }),
    history: {
      end: now.toISOString(),
      field: 'sets.exercise',
      missing: [],
      points: [
        { at: new Date(2026, 9, 1).toISOString(), groups: { back: 86 }, score: 70 },
        { at: new Date(2026, 11, 3).toISOString(), groups: { back: 90 }, score: 72 },
      ],
      start: new Date(2025, 11, 3).toISOString(),
      step_days: 7,
    } satisfies StrengthScoreHistory,
    recovery: recovery([recoveryGroup('chest', 60)]),
    score: score([scoreGroup({})]),
    windows,
  })
  const row = (g: ExerciseMuscleGroup) => rows.find((r) => r.muscle_group === g)

  test('has a row per muscle group in body order, none for the other series', () => {
    expect(rows.map((r) => r.muscle_group)).toEqual(BODY_REGIONS.flatMap((r) => r.groups))
  })

  test('gives the last seven days and the average over 13 weeks', () => {
    expect(row('chest')?.sets7).toBe(4)
    expect(row('chest')?.avg).toBeCloseTo(13.4 / 13)
    expect(row('lats')?.sets7).toBe(2)
  })

  test('takes the score of the group holding the muscle, for each of its muscles', () => {
    expect(row('lats')?.score_group?.name).toBe('Back')
    expect(row('middle_back')?.score_group?.name).toBe('Back')
    expect(row('lats')?.score_change).toBe(4)
    expect(row('traps')?.score_group).toBeUndefined()
  })

  test('finds recovery, or none', () => {
    expect(row('chest')?.recovery?.recovery).toBe(60)
    expect(row('lats')?.recovery).toBeUndefined()
  })

  test('marks never trained groups: no last training and no sets', () => {
    expect(row('chest')?.never_trained).toBe(false)
    expect(row('traps')?.never_trained).toBe(false)
    expect(row('calves')?.never_trained).toBe(true)
  })

  describe('muscleSections', () => {
    test('groups by body region in body order, never trained last, empty regions left out', () => {
      const sections = muscleSections(rows, 'body')
      expect(sections.map((s) => s.heading)).toEqual(['Chest and shoulders', 'Back', 'Never trained'])
      expect(sections[0].rows.map((r) => r.muscle_group)).toEqual(['chest', 'traps'])
      expect(sections[1].rows.map((r) => r.muscle_group)).toEqual(['lats'])
      expect(sections[2].rows[0].muscle_group).toBe('shoulders')
    })
  })
})

describe('muscleSections sorting', () => {
  const base = muscleRows({ groups: overview(), windows: new Map() })
  const rowsWith = (edit: Partial<Record<ExerciseMuscleGroup, object>>) =>
    base.map((r) => ({ ...r, ...edit[r.muscle_group] }))
  const order = (rows: ReturnType<typeof rowsWith>, sort: Parameters<typeof muscleSections>[1]) => {
    const sections = muscleSections(rows, sort)
    expect(sections).toHaveLength(1)
    expect(sections[0].heading).toBeUndefined()
    return sections[0].rows.map((r) => r.muscle_group)
  }

  test('least recovered first, ties and unknown in body order', () => {
    const rows = rowsWith({
      calves: { recovery: recoveryGroup('calves', 40) },
      chest: { recovery: recoveryGroup('chest', 100) },
      lats: { recovery: recoveryGroup('lats', 40) },
      shoulders: { recovery: recoveryGroup('shoulders', 70) },
    })
    expect(order(rows, 'recovery').slice(0, 5)).toEqual(['lats', 'calves', 'shoulders', 'chest', 'traps'])
  })

  test('most behind on sets first', () => {
    const rows = rowsWith({
      biceps: { avg: 3, sets7: 1 },
      chest: { avg: 1, sets7: 4 },
      lats: { avg: 2, sets7: 0 },
    })
    const sorted = order(rows, 'behind')
    expect(sorted.slice(0, 3)).toEqual(['lats', 'biceps', 'shoulders'])
    expect(sorted.at(-1)).toBe('chest')
  })

  test('longest since trained first, never trained last', () => {
    const rows = rowsWith({ calves: { last_trained: daysAgo(40) }, chest: { last_trained: daysAgo(2) } })
    const sorted = order(rows, 'longest')
    expect(sorted.slice(0, 3)).toEqual(['calves', 'chest', 'shoulders'])
  })

  test('weakest score first, no score last', () => {
    const rows = rowsWith({
      chest: { score_group: scoreGroup({ group: 'chest', name: 'Chest', score: 110 }) },
      glutes: { score_group: scoreGroup({ group: 'glutes', name: 'Glutes', score: null }) },
      lats: { score_group: scoreGroup({ score: 90 }) },
      quadriceps: { score_group: scoreGroup({ group: 'quadriceps', name: 'Quadriceps', score: 62 }) },
    })
    expect(order(rows, 'weakest').slice(0, 4)).toEqual(['quadriceps', 'lats', 'chest', 'shoulders'])
  })
})

describe('statusLine', () => {
  test('is nothing with nothing to say', () => {
    expect(statusLine(undefined, overview(), now)).toBeUndefined()
  })

  test('says every muscle is ready', () => {
    expect(statusLine(recovery([recoveryGroup('chest', 100)]), overview(), now)).toBe(
      'Every muscle is ready to train.',
    )
  })

  test('lists the recovering groups, least recovered first', () => {
    const data = recovery([
      recoveryGroup('chest', 70),
      recoveryGroup('shoulders', 40),
      recoveryGroup('triceps', 79),
      recoveryGroup('biceps', 90),
    ])
    expect(statusLine(data, overview(), now)).toBe('Recovering: Shoulders, Chest, Triceps.')
  })

  test('lists the neglected groups alone, longest first', () => {
    const groups = overview({ adductors: daysAgo(33), calves: daysAgo(62), chest: daysAgo(29) })
    expect(statusLine(undefined, groups, now)).toBe(
      'Not trained for a month: Calves (62 days), Adductors (33 days).',
    )
  })

  test('names at most four in each part', () => {
    const data = recovery(
      (['chest', 'shoulders', 'triceps', 'biceps', 'lats', 'calves'] as const).map((g, i) =>
        recoveryGroup(g, 10 + i),
      ),
    )
    expect(statusLine(data, overview({ neck: daysAgo(40) }), now)).toBe(
      'Recovering: Chest, Shoulders, Triceps, Biceps and 2 more. Not trained for a month: Neck (40 days).',
    )
  })
})

describe('labels', () => {
  test('nameList', () => {
    expect(nameList(['A'])).toBe('A')
    expect(nameList(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C, D and 1 more')
  })

  test('isNeglected from 30 days', () => {
    expect(isNeglected(daysAgo(30), now)).toBe(true)
    expect(isNeglected(daysAgo(29), now)).toBe(false)
    expect(isNeglected(null, now)).toBe(false)
  })

  test('shortReadyLabel gives hours under two days, else the weekday', () => {
    const ahead = (h: number) => new Date(now.getTime() + h * HOUR).toISOString()
    expect(shortReadyLabel(null, now)).toBeUndefined()
    expect(shortReadyLabel(ahead(-1), now)).toBeUndefined()
    expect(shortReadyLabel(ahead(0.2), now)).toBe('1 h')
    expect(shortReadyLabel(ahead(45), now)).toBe('45 h')
    expect(shortReadyLabel(ahead(60), now)).toBe('Sun')
  })

  test('recoveryText', () => {
    expect(recoveryText(recoveryGroup('chest', 100), 80, now)).toBe('Fully recovered, ready to train.')
    const source = {
      activity_type: 'strength_training',
      end_time: daysAgo(1),
      fatigue: 0.1,
      session_id: 's',
      sets: 3,
      start_time: daysAgo(1),
    }
    expect(recoveryText(recoveryGroup('chest', 94, { sources: [source] }), 80, now)).toBe(
      '94 % recovered, ready to train.',
    )
    const readyAt = new Date(now.getTime() + 5 * HOUR).toISOString()
    expect(recoveryText(recoveryGroup('chest', 52, { ready_at: readyAt, sources: [source] }), 80, now)).toBe(
      '52 % recovered. Ready in 5 h.',
    )
  })

  test('newestSource is the latest session', () => {
    const source = (id: string, end: string) => ({
      activity_type: 'strength_training',
      end_time: end,
      fatigue: 0.1,
      session_id: id,
      sets: 3,
      start_time: end,
    })
    const group = recoveryGroup('chest', 50, {
      sources: [source('old', daysAgo(3)), source('new', daysAgo(1))],
    })
    expect(newestSource(group)?.session_id).toBe('new')
    expect(newestSource(recoveryGroup('chest', 100))).toBeUndefined()
  })

  test('setsText', () => {
    expect(setsText({ avg: 3.6, sets7: 4 })).toBe(
      '4 sets in the last 7 days · 3.6 a week on average over 13 weeks',
    )
    expect(setsText({ avg: 1 / 13, sets7: 1 })).toBe(
      '1 set in the last 7 days · 0.1 a week on average over 13 weeks',
    )
  })

  test('windowHeights scale to the tallest window, at least five sets', () => {
    expect(windowHeights([0, 1, 2])).toEqual([0, 0.2, 0.4])
    expect(windowHeights([5, 10])).toEqual([0.5, 1])
  })

  test('score lines', () => {
    expect(changeWords(4)).toBe('up 4 in 30 days')
    expect(changeWords(-16)).toBe('down 16 in 30 days')
    expect(changeWords(0)).toBe('unchanged')
    expect(scoreLine(scoreGroup({}), 4)).toBe('Back: 90 points, up 4 in 30 days')
    expect(scoreLine(scoreGroup({}), undefined)).toBe('Back: 90 points')
    expect(scoreLine(scoreGroup({ score: null }), 4)).toBeUndefined()
    expect(scoredAsOneNote(scoreGroup({}))).toBe('Back is scored as one group: Lats and Middle back.')
    expect(scoredAsOneNote(scoreGroup({ muscle_groups: ['chest'] }))).toBeUndefined()
    expect(unscoredText('Traps')).toBe('No lift is scored for traps, so it has no strength score.')
    expect(notScoredLabel('Traps')).toBe('Traps aren’t scored')
    expect(notScoredLabel('Neck')).toBe('Neck isn’t scored')
    expect(SCORE_CHANGE_COLUMN).toBe('±30 d')
  })

  test('the score card lines', () => {
    expect(changeInDaysLabel(3)).toBe('+3 in 30 days')
    expect(changeInDaysLabel(-2)).toBe('-2 in 30 days')
    expect(
      extremesLine(
        score([
          scoreGroup({ group: 'triceps', muscle_groups: ['triceps'], name: 'Triceps', score: 117 }),
          scoreGroup({ group: 'quadriceps', muscle_groups: ['quadriceps'], name: 'Quadriceps', score: 62 }),
        ]),
      ),
    ).toBe('Strongest Triceps 117 · Weakest Quadriceps 62')
    expect(extremesLine(score([scoreGroup({})]))).toBeUndefined()
  })
})
