import { strengthScoreMetrics } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import type { StrengthScoreInputAggregates, TimeSeriesPoint } from '../../db/index.ts'
import type { ScoredSet } from '../strength-score.ts'

import { strengthReferencesOf } from '../strength-references.ts'
import { refreshStrengthScoreMetrics, type StrengthScoreMetricsDeps } from './refresh.ts'

const references = strengthReferencesOf({
  bodyweight_exponent: 0.67,
  groups: [{ key: 'chest', muscle_groups: ['chest'], name: 'Chest' }],
  lifts: [
    { group: 'chest', id: 'bench', keys: ['bench_press'], name: 'Bench', ratio: { female: 0.6, male: 1 } },
  ],
  reference_bodyweight_kg: 75,
  version: 3,
})

const benchSet: ScoredSet = {
  activity_type: 'strength_training',
  bodyweight: 75,
  catalog_key: 'bench_press',
  e1rm: 75,
  lift: references.lifts[0] as ScoredSet['lift'],
  reps: 1,
  session_id: 's',
  start_time: new Date('2026-06-01T08:00:00Z'),
  value: 'Bench press',
  weight: 75,
}

const aggregates: StrengthScoreInputAggregates = {
  activities: { changed_at: '2026-06-01 08:00:00+00', count: 1 },
  item_value_aliases: { changed_at: null, count: 0 },
  item_value_identities: { changed_at: null, count: 0 },
  shared_exercises: { changed_at: null, count: 0 },
  weight: { changed_at: null, count: 1, deleted: 0 },
}

const now = new Date('2026-06-02T18:00:00Z')

const fakeDeps = (overrides: Partial<StrengthScoreMetricsDeps> = {}) => {
  const calls = {
    reconciled: [] as { metrics: readonly string[]; points: TimeSeriesPoint[]; source: string }[],
    stamps: [] as string[],
  }
  let stored: string | null = null
  const deps: StrengthScoreMetricsDeps = {
    catalogVersion: () => '2026.11.0',
    expandActivityTypes: async (_user, types) => types,
    getDerivedMetricStamp: async () => stored,
    getInputAggregates: async () => aggregates,
    getUserSettings: async () => ({ sex: 'male' }),
    getUserTimezone: async () => 'UTC',
    loadScoredSets: async () => ({
      data: { references, sets: [benchSet], subject: { has_bodyweight: true, sex: 'male' } },
      success: true,
    }),
    loadStrengthReferences: () => references,
    reconcileTimeSeries: async (_user, source, metrics, points) => {
      calls.reconciled.push({ metrics, points, source })
      return { removed: 0, written: points.length }
    },
    setDerivedMetricStamp: async (_user, _name, stamp) => {
      calls.stamps.push(stamp)
      stored = stamp
    },
    ...overrides,
  }
  return { calls, deps }
}

describe('refreshStrengthScoreMetrics', () => {
  test('writes the daily points and stores the stamp, then skips while nothing changed', async () => {
    const { calls, deps } = fakeDeps()

    expect(await refreshStrengthScoreMetrics('alice', deps, now)).toEqual({
      removed: 0,
      skipped: false,
      written: 4,
    })
    expect(calls.reconciled).toHaveLength(1)
    expect(calls.reconciled[0]?.source).toBe('aurboda')
    expect(calls.reconciled[0]?.metrics).toEqual(strengthScoreMetrics)
    expect(calls.reconciled[0]?.points.map((p) => [p.metric, p.time.toISOString(), p.value])).toEqual([
      ['strength_score', '2026-06-01T12:00:00.000Z', 100],
      ['strength_score_chest', '2026-06-01T12:00:00.000Z', 100],
      ['strength_score', '2026-06-02T12:00:00.000Z', 100],
      ['strength_score_chest', '2026-06-02T12:00:00.000Z', 100],
    ])
    expect(calls.stamps).toHaveLength(1)

    expect(await refreshStrengthScoreMetrics('alice', deps, now)).toEqual({ skipped: true })
    expect(calls.reconciled).toHaveLength(1)
  })

  test('recalculates on a new day, a changed input or a changed setting', async () => {
    const { calls, deps } = fakeDeps()
    await refreshStrengthScoreMetrics('alice', deps, now)
    await refreshStrengthScoreMetrics('alice', deps, new Date('2026-06-03T01:00:00Z'))
    deps.getInputAggregates = async () => ({
      ...aggregates,
      weight: { changed_at: 'x', count: 2, deleted: 0 },
    })
    await refreshStrengthScoreMetrics('alice', deps, new Date('2026-06-03T01:00:00Z'))
    deps.getUserSettings = async () => ({ sex: 'female' })
    await refreshStrengthScoreMetrics('alice', deps, new Date('2026-06-03T01:00:00Z'))
    expect(calls.reconciled).toHaveLength(4)
    expect(new Set(calls.stamps).size).toBe(4)
  })

  test('a user without the strength type ends with no rows and a stored stamp', async () => {
    const { calls, deps } = fakeDeps({
      loadScoredSets: async () => ({ error: 'unknown activity type', success: false }),
    })
    expect(await refreshStrengthScoreMetrics('alice', deps, now)).toEqual({
      removed: 0,
      skipped: false,
      written: 0,
    })
    expect(calls.reconciled[0]?.points).toEqual([])
    expect(calls.stamps).toHaveLength(1)
  })

  test('a user without sessions or with a missing input ends with no rows', async () => {
    const none = fakeDeps({
      loadScoredSets: async () => ({
        data: { references, sets: [], subject: { has_bodyweight: true, sex: 'male' } },
        success: true,
      }),
    })
    await refreshStrengthScoreMetrics('alice', none.deps, now)
    expect(none.calls.reconciled[0]?.points).toEqual([])

    const missing = fakeDeps({
      loadScoredSets: async () => ({
        data: { references, sets: [benchSet], subject: { has_bodyweight: false, sex: 'male' } },
        success: true,
      }),
    })
    await refreshStrengthScoreMetrics('alice', missing.deps, now)
    expect(missing.calls.reconciled[0]?.points).toEqual([])
  })

  test('stores the stamp read before the calculation, so a change meanwhile is picked up next time', async () => {
    let weightCount = 1
    const { calls, deps } = fakeDeps({
      getInputAggregates: async () => ({
        ...aggregates,
        weight: { changed_at: null, count: weightCount, deleted: 0 },
      }),
    })
    const load = deps.loadScoredSets
    deps.loadScoredSets = async (...args) => {
      weightCount = 2
      return load(...args)
    }
    await refreshStrengthScoreMetrics('alice', deps, now)
    expect(calls.stamps[0]).toContain('"count":1,"deleted":0')

    expect(await refreshStrengthScoreMetrics('alice', deps, now)).toMatchObject({ skipped: false })
    expect(await refreshStrengthScoreMetrics('alice', deps, now)).toEqual({ skipped: true })
  })
})
