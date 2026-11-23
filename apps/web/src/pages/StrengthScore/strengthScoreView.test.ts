import type {
  StrengthScore,
  StrengthScoreGroupResult,
  StrengthScoreHistory,
  StrengthScoreLift,
  StrengthScoreSet,
} from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { SERIES_COLORS } from '../../components/charts/breakdown'
import {
  allGroupsSeries,
  averageLabel,
  bestSetLabel,
  changeLabel,
  groupScoresLine,
  groupsWithHistory,
  liftDetail,
  liftDetailParts,
  liftNote,
  liftNoteLabel,
  missingText,
  pointBefore,
  pointsLabel,
  scoreChange,
  scoredGroupCount,
  scoreGroupOf,
  scoreSeries,
  STRENGTH_SCORE_PERIODS,
  strengthScorePeriod,
  strongestAndWeakest,
  strongestAndWeakestLabel,
} from './strengthScoreView'

const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h)

const history = (points: StrengthScoreHistory['points']): StrengthScoreHistory => ({
  end: '2026-11-17T00:00:00.000Z',
  field: 'sets.exercise',
  missing: [],
  points,
  start: '2025-11-17T00:00:00.000Z',
  step_days: 7,
})

const at = (day: number) => new Date(Date.UTC(2026, 9, day)).toISOString()

const best = (overrides: Partial<StrengthScoreSet> = {}): StrengthScoreSet => ({
  activity_type: 'strength_training',
  bodyweight: 80,
  catalog_key: 'dumbbell_curl',
  e1rm: 16.8,
  reference_e1rm: 12,
  reps: 12,
  session_id: 's1',
  start_time: local(2026, 11, 3).toISOString(),
  value: 'Dumbbell curl',
  weight: 12,
  ...overrides,
})

const lift = (overrides: Partial<StrengthScoreLift> = {}): StrengthScoreLift => ({
  catalog_keys: ['dumbbell_curl'],
  counted: true,
  lift: 'dumbbell_curl',
  name: 'Dumbbell curl',
  score: 100,
  ...overrides,
})

const group = (overrides: Partial<StrengthScoreGroupResult>): StrengthScoreGroupResult => ({
  group: 'chest',
  lifts: [],
  muscle_groups: ['chest'],
  name: 'Chest',
  score: null,
  ...overrides,
})

const score = (groups: StrengthScoreGroupResult[]): StrengthScore => ({
  at: '2026-11-17T12:00:00.000Z',
  field: 'sets.exercise',
  groups,
  missing: [],
  score: 100,
  window_days: 90,
})

describe('strengthScorePeriod', () => {
  const now = local(2026, 11, 17, 15)

  test('the first period is the default year', () => {
    expect(STRENGTH_SCORE_PERIODS[0]).toEqual({ label: '1 year', value: 365 })
  })

  test('runs from the start of the first day to the end of today', () => {
    const period = strengthScorePeriod(365, now)
    expect(period.start).toBe(local(2025, 11, 17, 0).toISOString())
    expect(new Date(period.end).getTime()).toBe(local(2026, 11, 18, 0).getTime() - 1)
  })

  test('is stable within a day', () => {
    expect(strengthScorePeriod(90, local(2026, 11, 17, 1))).toEqual(strengthScorePeriod(90, now))
  })

  test('steps a day for 90 days, a week for a year, two weeks for three years', () => {
    expect(strengthScorePeriod(90, now).step_days).toBe(1)
    expect(strengthScorePeriod(365, now).step_days).toBe(7)
    expect(strengthScorePeriod(1095, now).step_days).toBe(14)
  })
})

describe('scoreSeries', () => {
  const h = history([
    { at: at(1), groups: { chest: 90 }, score: 90 },
    { at: at(8), groups: {}, score: null },
    { at: at(15), groups: { back: 80, chest: 100 }, score: 90 },
  ])

  test('the overall series skips points without a score', () => {
    expect(scoreSeries(h, 'overall')).toEqual([
      { date: at(1), value: 90 },
      { date: at(15), value: 90 },
    ])
  })

  test('a group series skips points the group is missing from', () => {
    expect(scoreSeries(h, 'back')).toEqual([{ date: at(15), value: 80 }])
    expect(scoreSeries(h, 'chest')).toHaveLength(2)
  })

  test('is empty without history', () => {
    expect(scoreSeries(history([]), 'overall')).toEqual([])
    expect(scoreSeries(undefined, 'overall')).toEqual([])
  })
})

describe('pointBefore', () => {
  test('is the latest point at least the days before the last one', () => {
    const h = history([
      { at: at(1), groups: {}, score: 80 },
      { at: at(8), groups: {}, score: 85 },
      { at: at(15), groups: {}, score: 88 },
      { at: at(38), groups: {}, score: 92 },
    ])
    expect(pointBefore(h, 30)?.at).toBe(at(8))
  })

  test('is undefined without history or a point far enough back', () => {
    expect(pointBefore(undefined, 30)).toBeUndefined()
    expect(pointBefore(history([{ at: at(10), groups: {}, score: 80 }]), 30)).toBeUndefined()
  })
})

describe('allGroupsSeries', () => {
  test('one line per group with history, coloured by its place among all groups', () => {
    const h = history([
      { at: at(1), groups: { back: 70, biceps: 60, chest: 90 }, score: 90 },
      { at: at(8), groups: { back: 75, chest: 95 }, score: 90 },
    ])
    expect(allGroupsSeries(h, { back: 'Back', chest: 'Chest' })).toEqual([
      {
        color: SERIES_COLORS[0],
        data: [
          { date: at(1), value: 90 },
          { date: at(8), value: 95 },
        ],
        name: 'Chest',
      },
      {
        color: SERIES_COLORS[2],
        data: [
          { date: at(1), value: 70 },
          { date: at(8), value: 75 },
        ],
        name: 'Back',
      },
    ])
  })
})

describe('scoreChange', () => {
  test('compares the last point with the latest one at least the days before it', () => {
    const h = history([
      { at: at(1), groups: {}, score: 80 },
      { at: at(8), groups: {}, score: 85 },
      { at: at(15), groups: {}, score: 88 },
      { at: at(38), groups: {}, score: 92 },
    ])
    expect(scoreChange(h, 30)).toBe(7)
  })

  test('is undefined with no point far enough back', () => {
    expect(scoreChange(history([{ at: at(10), groups: {}, score: 80 }]), 30)).toBeUndefined()
    expect(
      scoreChange(
        history([
          { at: at(1), groups: {}, score: 80 },
          { at: at(20), groups: {}, score: 90 },
        ]),
        30,
      ),
    ).toBeUndefined()
  })

  test('is undefined when either score is missing', () => {
    expect(
      scoreChange(
        history([
          { at: at(1), groups: {}, score: null },
          { at: at(31), groups: {}, score: 90 },
        ]),
        30,
      ),
    ).toBeUndefined()
    expect(
      scoreChange(
        history([
          { at: at(1), groups: {}, score: 80 },
          { at: at(31), groups: {}, score: null },
        ]),
        30,
      ),
    ).toBeUndefined()
    expect(scoreChange(history([]), 30)).toBeUndefined()
  })

  test('compares the score of a group when given its key', () => {
    const h = history([
      { at: at(1), groups: { back: 86, chest: 70 }, score: 80 },
      { at: at(38), groups: { back: 90, chest: 70 }, score: 82 },
    ])
    expect(scoreChange(h, 30, 'back')).toBe(4)
    expect(scoreChange(h, 30, 'chest')).toBe(0)
    expect(scoreChange(h, 30)).toBe(2)
  })

  test('is undefined for a group missing from either point', () => {
    expect(
      scoreChange(
        history([
          { at: at(1), groups: {}, score: 80 },
          { at: at(38), groups: { back: 90 }, score: 82 },
        ]),
        30,
        'back',
      ),
    ).toBeUndefined()
    expect(
      scoreChange(
        history([
          { at: at(1), groups: { back: 86 }, score: 80 },
          { at: at(38), groups: {}, score: 82 },
        ]),
        30,
        'back',
      ),
    ).toBeUndefined()
  })
})

describe('changeLabel', () => {
  test('signs the change', () => {
    expect(changeLabel(4)).toBe('+4')
    expect(changeLabel(-3)).toBe('-3')
    expect(changeLabel(0)).toBe('±0')
  })
})

describe('groupsWithHistory', () => {
  test('lists the groups with a value in at least two points, in the fixed order', () => {
    const h = history([
      { at: at(1), groups: { back: 70, chest: 90, glutes: 60 }, score: 73 },
      { at: at(8), groups: { back: 75, chest: 95 }, score: 85 },
    ])
    expect(groupsWithHistory(h)).toEqual(['chest', 'back'])
  })

  test('is empty with a single point', () => {
    expect(groupsWithHistory(history([{ at: at(1), groups: { chest: 90 }, score: 90 }]))).toEqual([])
  })
})

describe('liftNote', () => {
  const now = local(2026, 11, 17, 9)
  const expiring = (y: number, m: number, d: number) =>
    lift({ best: best(), expires_at: local(y, m, d, 18).toISOString() })

  test('a lift without a score gets no note', () => {
    expect(liftNote(lift({ counted: false, score: null }), now)).toBeUndefined()
    expect(liftNoteLabel(lift({ counted: false, score: null }), now)).toBeUndefined()
  })

  test('a scored lift outside the best three is not counted', () => {
    expect(liftNote(lift({ counted: false }), now)).toBe('not_counted')
    expect(liftNoteLabel(lift({ counted: false }), now)).toBe('Not among the best three')
  })

  test('a counted lift expiring within 14 days says when it leaves', () => {
    expect(liftNote(expiring(2026, 11, 17), now)).toBe('expiring')
    expect(liftNoteLabel(expiring(2026, 11, 17), now)).toBe('Leaves the 90 days today')
    expect(liftNoteLabel(expiring(2026, 11, 18), now)).toBe('Leaves the 90 days tomorrow')
    expect(liftNoteLabel(expiring(2026, 12, 1), now)).toBe('Leaves the 90 days in 14 days')
  })

  test('a counted lift expiring later just counts', () => {
    expect(liftNote(expiring(2026, 12, 2), now)).toBe('counted')
    expect(liftNoteLabel(expiring(2026, 12, 2), now)).toBe('Counts')
    expect(liftNoteLabel(lift(), now)).toBe('Counts')
  })
})

describe('bestSetLabel and liftDetail', () => {
  test('reads weight times reps', () => {
    expect(bestSetLabel(best())).toBe('12 kg × 12')
    expect(bestSetLabel(best({ reps: 5, weight: 82.25 }))).toBe('82.3 kg × 5')
  })

  test('the detail line names the set, the day, the estimate and the reference', () => {
    expect(liftDetail(best())).toBe('12 kg × 12 on 3 Nov 2026 · est. 1RM 16.8 kg · 100 points at 12 kg')
  })

  test('drops the reference when there is none', () => {
    expect(liftDetail(best({ reference_e1rm: undefined }))).toBe(
      '12 kg × 12 on 3 Nov 2026 · est. 1RM 16.8 kg',
    )
    expect(liftDetailParts(best({ reference_e1rm: undefined }))).toEqual({
      day: '3 Nov 2026',
      rest: ' · est. 1RM 16.8 kg',
      set: '12 kg × 12',
    })
  })

  test('a set above 12 reps says its estimate is of 12 reps', () => {
    expect(liftDetail(best({ reps: 17 }))).toBe(
      '12 kg × 17 on 3 Nov 2026 · est. 1RM 16.8 kg (as 12 reps) · 100 points at 12 kg',
    )
  })
})

describe('missingText', () => {
  test('nothing missing needs no text', () => {
    expect(missingText([])).toBeUndefined()
  })

  test('both missing names both and both actions', () => {
    const text = missingText(['bodyweight', 'sex'])
    expect(text?.sentence).toBe(
      'A score needs your sex and your bodyweight: what counts as 100 points for a lift depends on both.',
    )
    expect(text?.actions.map((a) => a.href)).toEqual(['/settings', '/add'])
  })

  test('only sex', () => {
    const text = missingText(['sex'])
    expect(text?.sentence).toBe('A score needs your sex: what counts as 100 points for a lift depends on it.')
    expect(text?.actions).toEqual([
      { after: '.', before: 'Set your sex in ', href: '/settings', link: 'Settings' },
    ])
  })

  test('only bodyweight', () => {
    const text = missingText(['bodyweight'])
    expect(text?.sentence).toBe(
      'A score needs your bodyweight: what counts as 100 points for a lift depends on it.',
    )
    expect(text?.actions).toEqual([
      { after: '.', before: 'Add your weight under ', href: '/add', link: 'Add data' },
    ])
  })
})

describe('score groups', () => {
  const s = score([
    group({ group: 'chest', muscle_groups: ['chest'], name: 'Chest', score: 98 }),
    group({ group: 'back', muscle_groups: ['lats', 'middle_back'], name: 'Back', score: 112 }),
    group({ group: 'biceps', muscle_groups: ['biceps'], name: 'Biceps', score: null }),
  ])

  test('scoreGroupOf finds the group covering a muscle group', () => {
    expect(scoreGroupOf('lats', s)?.group).toBe('back')
    expect(scoreGroupOf('chest', s)?.group).toBe('chest')
  })

  test('scoreGroupOf is undefined for a muscle group in no score group, or without a score', () => {
    expect(scoreGroupOf('calves', s)).toBeUndefined()
    expect(scoreGroupOf('chest', undefined)).toBeUndefined()
  })

  test('counts the scored groups', () => {
    expect(scoredGroupCount(s)).toBe(2)
    expect(averageLabel(s)).toBe('average of 2 muscle groups')
    expect(averageLabel(score([group({ score: 90 })]))).toBe('average of 1 muscle group')
  })

  test('lists the scored groups strongest first', () => {
    expect(groupScoresLine(s)).toBe('Back 112 · Chest 98')
    expect(groupScoresLine(score([group({})]))).toBe('')
  })

  test('points read as whole numbers or a dash', () => {
    expect(pointsLabel(104)).toBe('104')
    expect(pointsLabel(null)).toBe('–')
  })
})

describe('strongestAndWeakest', () => {
  test('picks the highest and lowest scored groups', () => {
    const s = score([
      group({ group: 'chest', name: 'Chest', score: 98 }),
      group({ group: 'triceps', name: 'Triceps', score: 128 }),
      group({ group: 'biceps', name: 'Biceps', score: null }),
      group({ group: 'quadriceps', name: 'Quadriceps', score: 93 }),
    ])
    const result = strongestAndWeakest(s)
    expect(result?.strongest.group).toBe('triceps')
    expect(result?.weakest.group).toBe('quadriceps')
    expect(result && strongestAndWeakestLabel(result)).toEqual(['Triceps 128', 'Quadriceps 93'])
  })

  test('ties go to the first group in order', () => {
    const s = score([
      group({ group: 'chest', name: 'Chest', score: 120 }),
      group({ group: 'back', name: 'Back', score: 90 }),
      group({ group: 'triceps', name: 'Triceps', score: 120 }),
      group({ group: 'biceps', name: 'Biceps', score: 90 }),
    ])
    const result = strongestAndWeakest(s)
    expect(result?.strongest.group).toBe('chest')
    expect(result?.weakest.group).toBe('back')
  })

  test('is undefined with fewer than two scored groups or when all scores are equal', () => {
    expect(strongestAndWeakest(score([]))).toBeUndefined()
    expect(
      strongestAndWeakest(score([group({ score: 100 }), group({ group: 'back', score: null })])),
    ).toBeUndefined()
    expect(
      strongestAndWeakest(score([group({ score: 100 }), group({ group: 'back', score: 100 })])),
    ).toBeUndefined()
  })
})
