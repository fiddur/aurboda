import type { StoredExerciseCatalogEntry } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import type { UserSettings } from '../../db/types.ts'
import type { ExerciseSession, loadSessions, Period } from './muscle-group-history.ts'

import { loadStrengthReferences } from '../strength-references.ts'
import { queryStrengthScore, queryStrengthScoreHistory, type StrengthScoreDeps } from './strength-score.ts'

const DAY = 86_400_000
const at = new Date('2026-06-01T12:00:00Z')

const curl: ExerciseSession = {
  activity_type: 'strength_training',
  id: 's1',
  items: [{ exercise: 'Barbell Curl', reps: 12, weight: 27 }],
  start_time: new Date(at.getTime() - 3 * DAY),
}

interface Fixture {
  periods: Period[]
  sessionsResult?: Awaited<ReturnType<typeof loadSessions>>
  sex?: 'female' | 'male' | null
  weights?: [Date, number][]
}

const depsOf = (fixture: Fixture): StrengthScoreDeps => ({
  getTimeSeries: async () => fixture.weights ?? [[new Date(at.getTime() - 30 * DAY), 75]],
  getUserSettings: async () =>
    fixture.sex === undefined ? null : ({ sex: fixture.sex } as unknown as UserSettings),
  loadSessions: async (_user, _type, _path, period) => {
    if (period) fixture.periods.push(period)
    return (
      fixture.sessionsResult ?? {
        data: {
          key: 'exercise',
          resolverOf: () => (value) =>
            value === 'Barbell Curl'
              ? ({ key: 'standing_barbell_bicep_curl' } as StoredExerciseCatalogEntry)
              : undefined,
          sessions: [curl],
        },
        success: true,
      }
    )
  },
  loadStrengthReferences,
})

const biceps = (groups: { group: string; score: number | null }[]) => groups.find((g) => g.group === 'biceps')

describe('queryStrengthScore', () => {
  test('loads the sessions of the window and scores them', async () => {
    const fixture: Fixture = { periods: [], sex: 'male' }
    const result = await queryStrengthScore('u', 'strength_training', 'sets.exercise', at, depsOf(fixture))
    expect(fixture.periods).toEqual([{ end: at, start: new Date(at.getTime() - 90 * DAY) }])
    if (!result.success) throw new Error(result.error)
    expect(result.data.missing).toEqual([])
    expect(result.data.field).toBe('sets.exercise')
    // 27 × 1.4 = 37.8 against 0.45 × 75 = 33.75
    expect(biceps(result.data.groups)?.score).toBe(112)
    expect(result.data.score).toBe(112)
  })

  test('missing sex and bodyweight', async () => {
    const result = await queryStrengthScore(
      'u',
      'strength_training',
      'sets.exercise',
      at,
      depsOf({ periods: [], sex: null, weights: [] }),
    )
    if (!result.success) throw new Error(result.error)
    expect(result.data.missing).toEqual(['sex', 'bodyweight'])
    expect(result.data.score).toBeNull()
  })

  test('passes on an error of the item path', async () => {
    const error = { error: 'Activity type "nope" not found', success: false as const }
    const result = await queryStrengthScore('u', 'nope', 'sets.exercise', at, {
      ...depsOf({ periods: [], sessionsResult: error }),
    })
    expect(result).toEqual(error)
  })
})

describe('queryStrengthScoreHistory', () => {
  test('loads the period widened by a window and gives a point per step', async () => {
    const fixture: Fixture = { periods: [], sex: 'male' }
    const period = { end: at, start: new Date(at.getTime() - 14 * DAY), step_days: 7 }
    const result = await queryStrengthScoreHistory(
      'u',
      'strength_training',
      'sets.exercise',
      period,
      depsOf(fixture),
    )
    expect(fixture.periods).toEqual([{ end: at, start: new Date(at.getTime() - 104 * DAY) }])
    if (!result.success) throw new Error(result.error)
    expect(result.data.points.map((p) => p.score)).toEqual([null, null, 112])
  })
})
