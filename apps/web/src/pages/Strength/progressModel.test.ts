import type {
  StrengthScore,
  StrengthScoreGroupResult,
  StrengthScoreHistory,
  StrengthScoreLift,
  StrengthScoreSet,
} from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { leavingSoon, movedGroups, scoreChartMenu } from './progressModel'

const now = new Date(2026, 10, 17, 12)
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString()
const daysAhead = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString()

const best = (overrides: Partial<StrengthScoreSet> = {}): StrengthScoreSet => ({
  activity_type: 'strength_training',
  bodyweight: 80,
  catalog_key: 'bench_press',
  e1rm: 100,
  reference_e1rm: 100,
  reps: 5,
  session_id: 's1',
  start_time: daysAgo(10),
  value: 'Bench press',
  weight: 87.5,
  ...overrides,
})

const lift = (overrides: Partial<StrengthScoreLift> = {}): StrengthScoreLift => ({
  best: best(),
  catalog_keys: ['bench_press'],
  counted: true,
  expires_at: daysAhead(80),
  lift: 'bench_press',
  name: 'Bench press',
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
  at: now.toISOString(),
  field: 'sets.exercise',
  groups,
  missing: [],
  score: 100,
  window_days: 90,
})

const history = (before: StrengthScoreHistory['points'][number]['groups']): StrengthScoreHistory => ({
  end: now.toISOString(),
  field: 'sets.exercise',
  missing: [],
  points: [
    { at: daysAgo(35), groups: before, score: 1 },
    { at: daysAgo(28), groups: {}, score: null },
    { at: now.toISOString(), groups: {}, score: 1 },
  ],
  start: daysAgo(365),
  step_days: 7,
})

describe('movedGroups', () => {
  test('a score that went up names the best new lift within 30 days', () => {
    const older = lift({ best: best({ start_time: daysAgo(40) }), lift: 'dip', name: 'Dip', score: 130 })
    const fresh = lift({ score: 110 })
    const freshLower = lift({ lift: 'fly', name: 'Fly', score: 90 })
    const moved = movedGroups(
      score([group({ lifts: [older, fresh, freshLower], score: 110 })]),
      history({ chest: 91 }),
      now,
    )
    expect(moved.rows).toEqual([
      {
        before: 91,
        change: 19,
        group: 'chest',
        name: 'Chest',
        now_score: 110,
        reason: { kind: 'new_best', lift: fresh },
      },
    ])
  })

  test('a score that went up with no new lift has no reason', () => {
    const old = lift({ best: best({ start_time: daysAgo(40) }) })
    const moved = movedGroups(score([group({ lifts: [old], score: 110 })]), history({ chest: 100 }), now)
    expect(moved.rows[0].reason).toBeUndefined()
  })

  test('a score that went down names the best lift left, if any', () => {
    const remaining = lift({ expires_at: undefined, score: 84 })
    const notCounted = lift({ counted: false, lift: 'fly', score: 99 })
    const down = movedGroups(
      score([group({ lifts: [notCounted, remaining], score: 84 })]),
      history({ chest: 100 }),
      now,
    )
    expect(down.rows[0]).toMatchObject({ change: -16, reason: { best_now: remaining, kind: 'lift_left' } })
    const none = movedGroups(score([group({ lifts: [notCounted], score: 50 })]), history({ chest: 100 }), now)
    expect(none.rows[0].reason).toEqual({ kind: 'lift_left' })
  })

  test('a first score and a lost score', () => {
    const fresh = lift()
    const moved = movedGroups(
      score([
        group({ lifts: [fresh], score: 100 }),
        group({ group: 'back', muscle_groups: ['lats'], name: 'Back', score: null }),
      ]),
      history({ back: 70 }),
      now,
    )
    expect(moved.rows).toEqual([
      { group: 'chest', name: 'Chest', now_score: 100, reason: { kind: 'new_best', lift: fresh } },
      { before: 70, group: 'back', name: 'Back', now_score: null, reason: { kind: 'all_left' } },
    ])
  })

  test('lists unchanged groups and groups without a score', () => {
    const moved = movedGroups(
      score([
        group({ score: 100 }),
        group({ group: 'back', name: 'Back', score: null }),
        group({ group: 'biceps', name: 'Biceps', score: 80 }),
      ]),
      history({ biceps: 80, chest: 100 }),
      now,
    )
    expect(moved).toEqual({ no_score: ['Back'], rows: [], unchanged: ['Chest', 'Biceps'] })
  })

  test('first and lost scores come first, then the largest change, ties in group order', () => {
    const moved = movedGroups(
      score([
        group({ group: 'chest', name: 'Chest', score: 105 }),
        group({ group: 'back', name: 'Back', score: 80 }),
        group({ group: 'biceps', name: 'Biceps', score: 95 }),
        group({ group: 'triceps', name: 'Triceps', score: 50 }),
        group({ group: 'glutes', name: 'Glutes', score: 110 }),
      ]),
      history({ back: 100, biceps: 100, chest: 100, glutes: 90 }),
      now,
    )
    expect(moved.rows.map((r) => r.name)).toEqual(['Triceps', 'Back', 'Glutes', 'Chest', 'Biceps'])
  })

  test('without a point 30 days back every scored group is a first score', () => {
    const short: StrengthScoreHistory = {
      ...history({}),
      points: [{ at: now.toISOString(), groups: {}, score: 1 }],
    }
    const moved = movedGroups(score([group({ score: 100 })]), short, now)
    expect(moved.rows).toEqual([{ group: 'chest', name: 'Chest', now_score: 100 }])
  })
})

describe('leavingSoon', () => {
  test('lists counted lifts leaving within 30 days, soonest first', () => {
    const late = lift({ expires_at: daysAhead(20), lift: 'dip', name: 'Dip' })
    const soon = lift({ expires_at: daysAhead(3) })
    const outside = lift({ expires_at: daysAhead(31), lift: 'fly', name: 'Fly' })
    const notCounted = lift({ counted: false, expires_at: daysAhead(2), lift: 'press', name: 'Press' })
    const noBest = lift({ best: undefined, expires_at: daysAhead(2), lift: 'row', name: 'Row' })
    const rows = leavingSoon(score([group({ lifts: [late, soon, outside, notCounted, noBest] })]), now)
    expect(rows.map((r) => [r.lift.name, r.days, r.groups])).toEqual([
      ['Bench press', 3, ['Chest']],
      ['Dip', 20, ['Chest']],
    ])
  })

  test('a lift in two groups is one row with both names', () => {
    const dip = lift({ expires_at: daysAhead(5), lift: 'dip', name: 'Dip' })
    const rows = leavingSoon(
      score([group({ lifts: [dip] }), group({ group: 'triceps', lifts: [dip], name: 'Triceps' })]),
      now,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].groups).toEqual(['Chest', 'Triceps'])
  })
})

describe('scoreChartMenu', () => {
  test('the overall score', () => {
    const menu = scoreChartMenu('strength_score', 365)
    const explore = new URL(menu.exploreHref, 'http://x')
    expect(explore.pathname).toBe('/chart')
    expect(Object.fromEntries(explore.searchParams)).toMatchObject({
      aggregation: 'mean',
      chart_type: 'trend',
      display_period: 'daily',
      half_life_days: '7',
      lookback_days: '365',
      pattern: 'strength_score',
      source_type: 'metric',
    })
    expect(menu.widget('', 'w1')).toEqual({
      config: {
        aggregation: 'mean',
        display_period: 'daily',
        half_life_days: 7,
        lookback_days: 365,
        pattern: 'strength_score',
        source_type: 'metric',
      },
      id: 'w1',
      type: 'trend_chart',
    })
    expect(menu.sparkline('Score', 'w2')).toEqual({
      config: { lookback_days: 365, metric: 'strength_score', title: 'Score' },
      id: 'w2',
      type: 'sparkline_card',
    })
  })

  test('a group score', () => {
    const menu = scoreChartMenu('strength_score_chest', 90)
    expect(menu.widget('Chest', 'w1').config).toMatchObject({
      lookback_days: 90,
      pattern: 'strength_score_chest',
      title: 'Chest',
    })
    const goal = new URL(menu.goalHref, 'http://x')
    expect(goal.pathname).toBe('/goals')
    expect(Object.fromEntries(goal.searchParams)).toEqual({
      aggregation: 'mean',
      display_period: 'daily',
      half_life_days: '7',
      new: 'trend',
      pattern: 'strength_score_chest',
      source_type: 'metric',
    })
  })
})
