import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { insertCustomMetricDefinition } from '../db/custom-metrics.ts'
import { insertActivity } from '../db/index.ts'
import { deleteTimeSeriesPoint, insertTimeSeries } from '../db/time-series.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getTrend } from './trends.ts'

const CONTAINER_TIMEOUT = 120_000

describe('getTrend metric integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('a cumulative metric trend counts only allowed sources and non-deleted rows', async () => {
    const user = getTestUser()
    const yesterday = new Date()
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const at = (hour: number) => {
      const d = new Date(yesterday)
      d.setUTCHours(hour, 0, 0, 0)
      return d
    }

    await insertTimeSeries(user, [
      { metric: 'steps', source: 'health_connect_aggregate', time: at(12), value: 1000 },
      { metric: 'steps', source: 'aurboda', time: at(12), value: 200 },
      { metric: 'steps', source: 'garmin', time: at(12), value: 5000 },
      { metric: 'steps', source: 'aurboda', time: at(13), value: 300 },
    ])
    await deleteTimeSeriesPoint(user, 'steps', at(13), 'aurboda')

    const result = await getTrend(user, {
      aggregation: 'sum',
      display_period: 'daily',
      lookback_days: 7,
      missing_days: 'skip',
      pattern: 'steps',
      source_type: 'metric',
    })

    expect(result.current_value).toBeCloseTo(1200)
  })

  describe('missing days', () => {
    const daysAgo = (days: number) => {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - days)
      d.setUTCHours(12, 0, 0, 0)
      return d
    }
    const ibuprofen = { aggregation: 'sum' as const, name: 'ibuprofen_mg', unit: 'mg' }
    const ibuprofenTrend = (user: string, extra: { aggregation: 'count' | 'sum'; missing_days?: 'skip' }) =>
      getTrend(user, {
        custom_metrics: [ibuprofen],
        display_period: 'daily',
        lookback_days: 7,
        pattern: 'ibuprofen_mg',
        source_type: 'metric',
        ...extra,
      })

    beforeEach(async () => {
      const user = getTestUser()
      await insertCustomMetricDefinition(user, ibuprofen)
      await insertTimeSeries(user, [
        { metric: 'ibuprofen_mg', source: 'aurboda', time: daysAgo(7), unit: 'mg', value: 400 },
      ])
    })

    test('an amount metric falls toward zero on days without samples', async () => {
      const result = await ibuprofenTrend(getTestUser(), { aggregation: 'sum' })

      expect(result.missing_days).toBe('zero')
      expect(result.display_unit).toBe('mg per day')
      expect(result.current_value).toBeGreaterThan(0)
      expect(result.current_value).toBeLessThan(100)
    })

    test('skipping missing days keeps the amount of the sampled day', async () => {
      const result = await ibuprofenTrend(getTestUser(), { aggregation: 'sum', missing_days: 'skip' })

      expect(result.current_value).toBeCloseTo(400)
    })

    test('count is samples per day, zero-filled', async () => {
      const result = await ibuprofenTrend(getTestUser(), { aggregation: 'count' })

      expect(result.aggregation).toBe('count')
      expect(result.current_value).toBeGreaterThan(0)
      expect(result.current_value).toBeLessThan(1)
    })

    test('a level metric is never pulled toward zero', async () => {
      const user = getTestUser()
      await insertTimeSeries(user, [
        { metric: 'weight', source: 'aurboda', time: daysAgo(14), value: 70 },
        { metric: 'weight', source: 'aurboda', time: daysAgo(7), value: 72 },
      ])

      const result = await getTrend(user, {
        aggregation: 'mean',
        display_period: 'daily',
        lookback_days: 7,
        pattern: 'weight',
        source_type: 'metric',
      })

      expect(result.missing_days).toBe('skip')
      expect(result.current_value).toBeGreaterThan(70)
      expect(result.current_value).toBeLessThan(72)
    })
  })

  describe('measure trends (decaying best)', () => {
    const daysAgo = (days: number) => {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - days)
      d.setUTCHours(12, 0, 0, 0)
      return d
    }
    const dayKey = (d: Date) => d.toISOString().slice(0, 10)
    const set = (exercise: string, weight: number, reps: number) => ({
      distance: null,
      exercise,
      order: 0,
      reps,
      rpe: null,
      set_type: 'normal',
      time: null,
      weight,
    })
    const lift = (start: Date, sets: Record<string, unknown>[]) =>
      insertActivity(getTestUser(), {
        activity_type: 'strength_training',
        data: { sets },
        end_time: new Date(start.getTime() + 3_600_000),
        source: 'gravl',
        start_time: start,
      })
    const squatTrend = (lookbackDays: number) =>
      getTrend(getTestUser(), {
        filter_field: 'sets.exercise',
        filter_value: 'Squat',
        half_life_days: 10,
        lookback_days: lookbackDays,
        measure: 'e1rm',
        pattern: 'strength_training',
        source_type: 'activity_type',
      })

    test("one exercise's best e1RM, carried down by its half-life and lifted by a stronger session", async () => {
      await lift(daysAgo(70), [set('Squat', 200, 3)])
      await lift(daysAgo(20), [set('Squat', 100, 3), set('Bench Press', 80, 5)])
      await lift(daysAgo(10), [set('Squat', 40, 3)])
      await lift(daysAgo(5), [set('Squat', 100, 6), set('Bench Press', 150, 3)])

      const result = await squatTrend(30)
      const valueOn = (d: Date) => result.history.find((p) => p.date === dayKey(d))?.value

      expect(result.history[0]).toEqual({ date: dayKey(daysAgo(20)), value: 110 })
      expect(result.history).toHaveLength(21)
      expect(valueOn(daysAgo(10))).toBe(55)
      expect(valueOn(daysAgo(5))).toBe(120)
      expect(result.history.at(-1)).toEqual({ date: dayKey(daysAgo(0)), value: 84.9 })
      expect(result.current_value).toBe(84.9)
      expect(result).toMatchObject({
        aggregation: 'max',
        display_unit: 'kg',
        filter_field: 'sets.exercise',
        filter_value: 'Squat',
        measure: 'e1rm',
        source_type: 'activity_type',
      })
    })

    test('a session in the warm-up carries into the lookback', async () => {
      await lift(daysAgo(25), [set('Squat', 100, 3)])

      const result = await squatTrend(10)

      expect(result.history).toHaveLength(11)
      expect(result.history[0]).toEqual({ date: dayKey(daysAgo(10)), value: 38.9 })
      expect(result.current_value).toBe(19.4)
    })

    test('no sessions, no history', async () => {
      const result = await squatTrend(30)

      expect(result.history).toEqual([])
      expect(result.current_value).toBe(0)
    })
  })
})
