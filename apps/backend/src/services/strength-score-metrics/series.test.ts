import type { StoredExerciseCatalogEntry } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import type { ExerciseSession, ResolverOf } from '../queries/muscle-group-history.ts'

import { strengthReferencesOf } from '../strength-references.ts'
import { scoredSets, strengthScoreHistory, type StrengthScoreSubject } from '../strength-score.ts'
import { dailyScorePoints, scoreDays } from './series.ts'

const DAY = 86_400_000

const references = strengthReferencesOf({
  bodyweight_exponent: 0.67,
  groups: [
    { key: 'chest', muscle_groups: ['chest'], name: 'Chest' },
    { key: 'biceps', muscle_groups: ['biceps'], name: 'Biceps' },
  ],
  lifts: [
    { group: 'chest', id: 'bench', keys: ['bench_press'], name: 'Bench', ratio: { female: 0.6, male: 1 } },
    { group: 'biceps', id: 'curl', keys: ['curl'], name: 'Curl', ratio: { female: 0.1, male: 0.16 } },
  ],
  reference_bodyweight_kg: 75,
  version: 1,
})

const names: Record<string, string> = { 'bench press': 'bench_press', curl: 'curl' }
const resolverOf: ResolverOf = () => (value) => {
  const key = names[value.trim().toLowerCase()]
  return key === undefined ? undefined : ({ key } as StoredExerciseCatalogEntry)
}

const session = (id: string, time: Date, items: Record<string, unknown>[]): ExerciseSession => ({
  activity_type: 'strength_training',
  id,
  items,
  start_time: time,
})

const setsOf = (sessions: ExerciseSession[]) =>
  scoredSets(sessions, 'exercise', resolverOf, references, () => 75)

const male: StrengthScoreSubject = { has_bodyweight: true, sex: 'male' }

const iso = (d: Date) => d.toISOString()

describe('scoreDays', () => {
  test('runs over a DST change, past days at local noon scored at the end of the day', () => {
    const days = scoreDays(
      new Date('2026-03-28T10:00:00Z'),
      new Date('2026-03-30T08:00:30Z'),
      'Europe/Stockholm',
    )
    expect(days.map((d) => [d.key, iso(d.time), iso(d.at)])).toEqual([
      ['2026-03-28', '2026-03-28T11:00:00.000Z', '2026-03-28T22:59:59.999Z'],
      ['2026-03-29', '2026-03-29T10:00:00.000Z', '2026-03-29T21:59:59.999Z'],
      ['2026-03-30', '2026-03-30T08:00:00.000Z', '2026-03-30T08:00:30.000Z'],
    ])
  })

  test('today is stamped at noon once noon has come', () => {
    const now = new Date('2026-03-30T10:30:00Z')
    const days = scoreDays(new Date('2026-03-30T06:00:00Z'), now, 'Europe/Stockholm')
    expect(days.map((d) => [d.key, iso(d.time), iso(d.at)])).toEqual([
      ['2026-03-30', '2026-03-30T10:00:00.000Z', iso(now)],
    ])
  })

  test('follows the local calendar in a zone far from UTC', () => {
    const days = scoreDays(
      new Date('2026-06-01T11:00:00Z'),
      new Date('2026-06-02T23:30:00Z'),
      'Pacific/Kiritimati',
    )
    expect(days.map((d) => [d.key, iso(d.time)])).toEqual([
      ['2026-06-02', '2026-06-01T22:00:00.000Z'],
      ['2026-06-03', '2026-06-02T22:00:00.000Z'],
    ])
    const west = scoreDays(
      new Date('2026-06-02T05:00:00Z'),
      new Date('2026-06-02T13:00:00Z'),
      'Pacific/Pago_Pago',
    )
    expect(west.map((d) => [d.key, iso(d.time)])).toEqual([
      ['2026-06-01', '2026-06-01T23:00:00.000Z'],
      ['2026-06-02', '2026-06-02T13:00:00.000Z'],
    ])
  })

  test('never stamps a row in the future', () => {
    const now = new Date('2026-06-02T07:12:45.500Z')
    const days = scoreDays(new Date('2026-05-30T12:00:00Z'), now, 'UTC')
    for (const day of days) expect(day.time.getTime()).toBeLessThanOrEqual(now.getTime())
  })
})

describe('dailyScorePoints', () => {
  const start = new Date('2026-01-01T09:00:00Z')
  const day = (n: number) => new Date(start.getTime() + n * DAY)

  test('nothing when the score is missing an input', () => {
    const sets = setsOf([session('s', start, [{ exercise: 'Curl', reps: 10, weight: 15 }])])
    expect(dailyScorePoints(sets, references, { has_bodyweight: false, sex: 'male' }, day(3), 'UTC')).toEqual(
      [],
    )
    expect(
      dailyScorePoints(sets, references, { has_bodyweight: true, sex: undefined }, day(3), 'UTC'),
    ).toEqual([])
  })

  test('nothing without sets', () => {
    expect(dailyScorePoints([], references, male, day(3), 'UTC')).toEqual([])
  })

  test('a group that leaves the window stops getting rows while the others go on', () => {
    const sets = setsOf([
      session('a', start, [{ exercise: 'Bench press', reps: 5, weight: 80 }]),
      session('b', day(50), [{ exercise: 'Curl', reps: 8, weight: 15 }]),
    ])
    const points = dailyScorePoints(sets, references, male, day(100), 'UTC')
    const daysOf = (metric: string) =>
      points.filter((p) => p.metric === metric).map((p) => p.time.toISOString())

    const chest = daysOf('strength_score_chest')
    expect(chest[0]).toBe('2026-01-01T12:00:00.000Z')
    expect(chest.at(-1)).toBe('2026-03-31T12:00:00.000Z')
    expect(chest).toHaveLength(90)
    expect(daysOf('strength_score_biceps')).toHaveLength(51)
    expect(daysOf('strength_score')).toHaveLength(101)
    expect(points.every((p) => p.source === 'aurboda' && p.unit === 'points')).toBe(true)
  })

  test('values are the score the history gives at the end of each day', () => {
    const sets = setsOf([
      session('a', start, [{ exercise: 'Bench press', reps: 5, weight: 80 }]),
      session('b', day(2), [{ exercise: 'Curl', reps: 8, weight: 15 }]),
      session('c', day(4), [{ exercise: 'Bench press', reps: 3, weight: 95 }]),
    ])
    const now = day(5)
    const points = dailyScorePoints(sets, references, male, now, 'UTC')
    const ends = [0, 1, 2, 3, 4].map((n) => new Date(Date.UTC(2026, 0, 1 + n, 23, 59, 59, 999)))
    const history = strengthScoreHistory(
      sets,
      references,
      male,
      { end: now, start: now, step_days: 1 },
      'sets.exercise',
    ).points
    const expected = ends
      .map((end) => strengthScoreHistory(sets, references, male, { end, start: end, step_days: 1 }, 'f'))
      .map((h) => h.points[0])
    const byDay = (metric: string) => points.filter((p) => p.metric === metric).map((p) => p.value)
    expect(byDay('strength_score')).toEqual([...expected.map((p) => p?.score), history[0]?.score])
    expect(byDay('strength_score_chest')).toEqual([
      ...expected.map((p) => p?.groups.chest),
      history[0]?.groups.chest,
    ])
    expect(byDay('strength_score_biceps')).toEqual([
      ...expected.slice(2).map((p) => p?.groups.biceps),
      history[0]?.groups.biceps,
    ])
  })
})
