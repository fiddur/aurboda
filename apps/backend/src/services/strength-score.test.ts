import type { StoredExerciseCatalogEntry } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import type { ExerciseSession, ResolverOf } from './queries/muscle-group-history.ts'

import { strengthReferencesOf } from './strength-references.ts'
import {
  bodyweightLookup,
  epley,
  historyMoments,
  referenceE1rm,
  type ScoredSet,
  scoredSets,
  strengthScoreAt,
  strengthScoreHistory,
  type StrengthScoreSubject,
} from './strength-score.ts'

const DAY = 86_400_000

const references = strengthReferencesOf({
  bodyweight_exponent: 0.67,
  groups: [
    { key: 'chest', muscle_groups: ['chest'], name: 'Chest' },
    { key: 'biceps', muscle_groups: ['biceps'], name: 'Biceps' },
  ],
  lifts: [
    {
      group: 'chest',
      id: 'bench',
      keys: ['bench_press', 'barbell_bench_press'],
      name: 'Bench',
      ratio: { female: 0.6, male: 1 },
    },
    { group: 'chest', id: 'incline', keys: ['incline'], name: 'Incline', ratio: { female: 0.5, male: 0.8 } },
    {
      group: 'chest',
      id: 'db_bench',
      keys: ['db_bench'],
      name: 'DB bench',
      ratio: { female: 0.2, male: 0.4 },
    },
    { group: 'chest', id: 'fly', keys: ['fly'], name: 'Fly', ratio: { female: 0.1, male: 0.2 } },
    { group: 'biceps', id: 'curl', keys: ['curl'], name: 'Curl', ratio: { female: 0.1, male: 0.16 } },
    { group: 'biceps', id: 'hammer', keys: ['hammer'], name: 'Hammer', ratio: { female: 0.1, male: 0.16 } },
  ],
  reference_bodyweight_kg: 75,
  version: 1,
})

const entry = (key: string) => ({ key }) as StoredExerciseCatalogEntry
const names: Record<string, string> = {
  'barbell bench': 'barbell_bench_press',
  'bench press': 'bench_press',
  curl: 'curl',
  'db bench': 'db_bench',
  fly: 'fly',
  hammer: 'hammer',
  incline: 'incline',
  plank: 'plank',
}
const resolverOf: ResolverOf = () => (value) => {
  const key = names[value.trim().toLowerCase()]
  return key === undefined ? undefined : entry(key)
}

const set = (exercise: string, weight: unknown, reps: unknown, extra: Record<string, unknown> = {}) => ({
  exercise,
  reps,
  weight,
  ...extra,
})

const session = (id: string, time: Date, items: Record<string, unknown>[]): ExerciseSession => ({
  activity_type: 'strength_training',
  id,
  items,
  start_time: time,
})

const at = new Date('2026-06-01T12:00:00Z')
const daysBefore = (days: number) => new Date(at.getTime() - days * DAY)
const constantWeight = (kg: number) => () => kg
const male: StrengthScoreSubject = { has_bodyweight: true, sex: 'male' }

const setsOf = (
  sessions: ExerciseSession[],
  bodyweightAt: (t: Date) => number | undefined = constantWeight(75),
) => scoredSets(sessions, 'exercise', resolverOf, references, bodyweightAt)

const scoreOf = (sessions: ExerciseSession[], subject = male, moment = at) =>
  strengthScoreAt(setsOf(sessions), references, subject, moment, 'sets.exercise')

const group = (score: ReturnType<typeof scoreOf>, key: string) => score.groups.find((g) => g.group === key)
const lift = (score: ReturnType<typeof scoreOf>, key: string, id: string) =>
  group(score, key)?.lifts.find((l) => l.lift === id)

describe('referenceE1rm', () => {
  test('is ratio times bodyweight at the reference bodyweight', () => {
    expect(referenceE1rm(0.16, 75, references)).toBeCloseTo(12)
  })

  test('grows slower than bodyweight', () => {
    expect(referenceE1rm(0.16, 90, references)).toBeCloseTo(0.16 * 75 * (90 / 75) ** 0.67)
  })
})

describe('bodyweightLookup', () => {
  const series: [Date, number][] = [
    [daysBefore(30), 80],
    [daysBefore(10), 78],
  ]
  const lookup = bodyweightLookup(series)

  test('the latest value at or before the moment', () => {
    expect(lookup(daysBefore(10))).toBe(78)
    expect(lookup(daysBefore(20))).toBe(80)
    expect(lookup(at)).toBe(78)
  })

  test('the earliest value after it when there is none before', () => {
    expect(lookup(daysBefore(40))).toBe(80)
  })

  test('undefined without any value', () => {
    expect(bodyweightLookup([])(at)).toBeUndefined()
  })
})

describe('scoredSets', () => {
  test('Epley e1RM of a counting set, with its session and bodyweight', () => {
    const [scored] = setsOf([session('s1', daysBefore(1), [set('Curl', 12, 12)])])
    expect(scored).toMatchObject({
      activity_type: 'strength_training',
      bodyweight: 75,
      catalog_key: 'curl',
      reps: 12,
      session_id: 's1',
      start_time: daysBefore(1),
      value: 'Curl',
      weight: 12,
    })
    expect(scored?.e1rm).toBeCloseTo(16.8)
    expect(scored?.lift.id).toBe('curl')
  })

  test('leaves out warm-ups, sets without weight or reps and exercises of no lift', () => {
    const sets = setsOf([
      session('s1', daysBefore(1), [
        set('Curl', 20, 5, { set_type: 'warmup' }),
        set('Curl', undefined, 5),
        set('Curl', 0, 5),
        set('Curl', '20', 5),
        set('Curl', 20, 13),
        set('Curl', 20, 0),
        set('Plank', 20, 5),
        set('Squat', 20, 5),
        set('', 20, 5),
        set('Curl', 20, 1),
        set('Curl', 18, 12),
      ]),
    ])
    expect(sets.map((s) => [s.weight, s.reps])).toEqual([
      [20, 13],
      [20, 1],
      [18, 12],
    ])
  })

  test('a set above 12 reps keeps its reps and is estimated as 12 reps with the same weight', () => {
    const [scored] = setsOf([session('s1', daysBefore(1), [set('Curl', 12, 17)])])
    expect(scored?.reps).toBe(17)
    expect(scored?.e1rm).toBeCloseTo(epley(12, 12))
  })

  test('without any weight the sets have no bodyweight', () => {
    const [scored] = setsOf([session('s1', daysBefore(1), [set('Curl', 12, 12)])], () => undefined)
    expect(scored).not.toHaveProperty('bodyweight')
  })
})

describe('strengthScoreAt', () => {
  test('a group whose only set has 17 reps gets a score', () => {
    const score = scoreOf([session('s1', daysBefore(1), [set('Curl', 12, 17)])])
    expect(lift(score, 'biceps', 'curl')?.best).toMatchObject({ e1rm: 16.8, reps: 17 })
    expect(group(score, 'biceps')?.score).toBe(140)
  })

  test('a worked example: 12 kg × 12 against a 12 kg reference is 140 points', () => {
    const score = scoreOf([session('s1', daysBefore(1), [set('Curl', 12, 12)])])
    const curl = lift(score, 'biceps', 'curl')
    expect(curl).toMatchObject({
      best: { e1rm: 16.8, reference_e1rm: 12 },
      counted: true,
      expires_at: new Date(daysBefore(1).getTime() + 90 * DAY).toISOString(),
      score: 140,
    })
    expect(group(score, 'biceps')?.score).toBe(140)
    expect(score.score).toBe(140)
    expect(score).toMatchObject({
      at: at.toISOString(),
      field: 'sets.exercise',
      missing: [],
      window_days: 90,
    })
  })

  test('two logged names that resolve to two keys of one lift count as one lift', () => {
    const score = scoreOf([
      session('s1', daysBefore(2), [set('Bench press', 60, 5)]),
      session('s2', daysBefore(1), [set('Barbell bench', 70, 5)]),
    ])
    const bench = lift(score, 'chest', 'bench')
    expect(bench?.best).toMatchObject({ catalog_key: 'barbell_bench_press', session_id: 's2', weight: 70 })
    expect(group(score, 'chest')?.lifts.filter((l) => l.best)).toHaveLength(1)
  })

  test('the window: exactly 90 days before is out, a second later is in, after the moment is out', () => {
    const edge = new Date(at.getTime() - 90 * DAY)
    expect(lift(scoreOf([session('s', edge, [set('Curl', 12, 12)])]), 'biceps', 'curl')?.best).toBeUndefined()
    expect(
      lift(scoreOf([session('s', new Date(edge.getTime() + 1000), [set('Curl', 12, 12)])]), 'biceps', 'curl')
        ?.best,
    ).toBeDefined()
    expect(
      lift(scoreOf([session('s', new Date(at.getTime() + 1000), [set('Curl', 12, 12)])]), 'biceps', 'curl')
        ?.best,
    ).toBeUndefined()
  })

  test('the best set is the one with the most points when the bodyweight differs', () => {
    const lookup = bodyweightLookup([
      [daysBefore(20), 100],
      [daysBefore(5), 60],
    ])
    const sets = scoredSets(
      [
        session('heavy', daysBefore(10), [set('Curl', 14, 10)]),
        session('light', daysBefore(2), [set('Curl', 12, 10)]),
      ],
      'exercise',
      resolverOf,
      references,
      lookup,
    )
    const score = strengthScoreAt(sets, references, male, at, 'sets.exercise')
    expect(lift(score, 'biceps', 'curl')?.best).toMatchObject({ bodyweight: 60, session_id: 'light' })
  })

  test('a tie goes to the later session', () => {
    const score = scoreOf([
      session('early', daysBefore(10), [set('Curl', 12, 10)]),
      session('late', daysBefore(2), [set('Curl', 12, 10)]),
      session('middle', daysBefore(5), [set('Curl', 12, 10)]),
    ])
    expect(lift(score, 'biceps', 'curl')?.best?.session_id).toBe('late')
  })

  test('a group is the mean of its best three lifts, the overall the mean of the unrounded groups', () => {
    const score = scoreOf([
      session('s1', daysBefore(1), [
        set('Bench press', 75, 1),
        set('Incline', 50, 1),
        set('DB bench', 40, 1),
        set('Fly', 10, 1),
        set('Hammer', 12, 1),
      ]),
    ])
    const chest = group(score, 'chest')
    const r = (ratio: number, e1rm: number) => (100 * e1rm) / (ratio * 75)
    const e = (w: number) => w * (1 + 1 / 30)
    const points = { bench: r(1, e(75)), db_bench: r(0.4, e(40)), fly: r(0.2, e(10)), incline: r(0.8, e(50)) }
    expect(chest?.lifts.map((l) => [l.lift, l.score, l.counted])).toEqual([
      ['db_bench', Math.round(points.db_bench), true],
      ['bench', Math.round(points.bench), true],
      ['incline', Math.round(points.incline), true],
      ['fly', Math.round(points.fly), false],
    ])
    const chestMean = (points.db_bench + points.bench + points.incline) / 3
    expect(chest?.score).toBe(Math.round(chestMean))
    const hammer = r(0.16, e(12))
    expect(group(score, 'biceps')?.score).toBe(Math.round(hammer))
    expect(score.score).toBe(Math.round((chestMean + hammer) / 2))
  })

  test('every group and every lift is listed, scored lifts first, the rest in file order', () => {
    const score = scoreOf([session('s1', daysBefore(1), [set('Hammer', 12, 5)])])
    expect(score.groups.map((g) => g.group)).toEqual(['chest', 'biceps'])
    expect(group(score, 'chest')).toMatchObject({ muscle_groups: ['chest'], name: 'Chest', score: null })
    expect(group(score, 'chest')?.lifts.map((l) => l.lift)).toEqual(['bench', 'incline', 'db_bench', 'fly'])
    expect(group(score, 'biceps')?.lifts.map((l) => l.lift)).toEqual(['hammer', 'curl'])
    expect(lift(score, 'biceps', 'curl')).toEqual({
      catalog_keys: ['curl'],
      counted: false,
      lift: 'curl',
      name: 'Curl',
      score: null,
    })
  })

  test('no sets: every score null', () => {
    const score = scoreOf([])
    expect(score.score).toBeNull()
    expect(score.groups.every((g) => g.score === null)).toBe(true)
  })

  test.each<[StrengthScoreSubject, string[]]>([
    [{ has_bodyweight: true, sex: undefined }, ['sex']],
    [{ has_bodyweight: false, sex: 'female' }, ['bodyweight']],
    [{ has_bodyweight: false, sex: undefined }, ['sex', 'bodyweight']],
  ])('missing %o: scores null, best still given', (subject, missing) => {
    const bodyweightAt = subject.has_bodyweight ? constantWeight(75) : () => undefined
    const sets = setsOf(
      [
        session('s1', daysBefore(2), [set('Curl', 12, 12), set('Hammer', 10, 5)]),
        session('s2', daysBefore(1), [set('Hammer', 14, 3)]),
      ],
      bodyweightAt,
    )
    const score = strengthScoreAt(sets, references, subject, at, 'sets.exercise')
    expect(score.missing).toEqual(missing)
    expect(score.score).toBeNull()
    const biceps = group(score, 'biceps')
    expect(biceps?.score).toBeNull()
    expect(biceps?.lifts.map((l) => [l.lift, l.score, l.counted])).toEqual([
      ['curl', null, false],
      ['hammer', null, false],
    ])
    expect(biceps?.lifts[1]?.best).toMatchObject({ e1rm: 15.4, session_id: 's2' })
    expect(biceps?.lifts[0]?.best).not.toHaveProperty('reference_e1rm')
    expect(biceps?.lifts[0]?.best?.bodyweight).toBe(subject.has_bodyweight ? 75 : undefined)
  })

  test('scores against the female ratio for a woman', () => {
    const score = scoreOf([session('s1', daysBefore(1), [set('Curl', 12, 12)])], {
      has_bodyweight: true,
      sex: 'female',
    })
    expect(lift(score, 'biceps', 'curl')?.best?.reference_e1rm).toBe(7.5)
    expect(lift(score, 'biceps', 'curl')?.score).toBe(224)
  })
})

describe('strengthScoreHistory', () => {
  const period = { end: at, start: daysBefore(21), step_days: 7 }

  test('the moments: end and every step before it down to start, oldest first', () => {
    expect(historyMoments(period)).toEqual([daysBefore(21), daysBefore(14), daysBefore(7), at])
    expect(historyMoments({ ...period, start: daysBefore(20) })).toEqual([daysBefore(14), daysBefore(7), at])
  })

  test('a lift entering and leaving the window moves the score', () => {
    const sets: ScoredSet[] = setsOf([
      session('old', daysBefore(108), [set('Curl', 12, 12)]),
      session('new', daysBefore(10), [set('Curl', 9, 12)]),
    ])
    const history = strengthScoreHistory(sets, references, male, period, 'sets.exercise')
    expect(history).toMatchObject({
      end: at.toISOString(),
      field: 'sets.exercise',
      missing: [],
      start: daysBefore(21).toISOString(),
      step_days: 7,
    })
    expect(history.points).toEqual([
      { at: daysBefore(21).toISOString(), groups: { biceps: 140 }, score: 140 },
      { at: daysBefore(14).toISOString(), groups: {}, score: null },
      { at: daysBefore(7).toISOString(), groups: { biceps: 105 }, score: 105 },
      { at: at.toISOString(), groups: { biceps: 105 }, score: 105 },
    ])
  })

  test('no points when something is missing', () => {
    const sets = setsOf([session('s', daysBefore(10), [set('Curl', 12, 12)])])
    const history = strengthScoreHistory(
      sets,
      references,
      { has_bodyweight: true, sex: undefined },
      period,
      'f',
    )
    expect(history.missing).toEqual(['sex'])
    expect(history.points).toEqual([])
  })
})
