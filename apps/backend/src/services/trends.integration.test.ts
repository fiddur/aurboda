import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { insertCustomMetricDefinition } from '../db/custom-metrics.ts'
import { insertActivity } from '../db/index.ts'
import { deleteTimeSeriesPoint, insertTimeSeries } from '../db/time-series.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { firstPeriodWeight, getTrend } from './trends.ts'

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

  test('a trend anchored to a past day ends on that day', async () => {
    const user = getTestUser()
    await insertTimeSeries(user, [
      { metric: 'steps', source: 'aurboda', time: new Date('2026-03-10T12:00:00Z'), value: 4000 },
      { metric: 'steps', source: 'aurboda', time: new Date('2026-03-20T12:00:00Z'), value: 9000 },
    ])

    const result = await getTrend(user, {
      aggregation: 'sum',
      display_period: 'daily',
      end: new Date('2026-03-15T12:00:00Z'),
      lookback_days: 7,
      missing_days: 'skip',
      pattern: 'steps',
      source_type: 'metric',
      tz: 'UTC',
    })

    expect(result.history.at(-1)?.date).toBe('2026-03-15')
    expect(result.history[0]?.date).toBe('2026-03-10')
    expect(result.current_value).toBeCloseTo(4000)
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

  describe('calendar days in a timezone', () => {
    const utcDayKey = (d: Date) => d.toISOString().slice(0, 10)
    const at = (daysBack: number, hour: number, minute: number) => {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - daysBack)
      d.setUTCHours(hour, minute, 0, 0)
      return d
    }

    test('a metric sample counts for the local day it falls on', async () => {
      const user = getTestUser()
      const late = at(3, 23, 30)
      const early = at(2, 0, 30)
      await insertTimeSeries(user, [
        { metric: 'steps', source: 'aurboda', time: late, value: 100 },
        { metric: 'steps', source: 'aurboda', time: early, value: 200 },
      ])
      const stepsTrend = (tz?: string) =>
        getTrend(user, {
          aggregation: 'sum',
          display_period: 'daily',
          lookback_days: 7,
          missing_days: 'skip',
          pattern: 'steps',
          source_type: 'metric',
          ...(tz ? { tz } : {}),
        })

      const local = await stepsTrend('Pacific/Kiritimati')
      expect(local.history[0]).toEqual({ date: utcDayKey(early), value: 300 })

      const utc = await stepsTrend()
      expect(utc.history[0]).toEqual({ date: utcDayKey(late), value: 100 })
      expect(utc.history[1]?.date).toBe(utcDayKey(early))
    })

    test('an activity counts for the local day it starts on', async () => {
      const user = getTestUser()
      const start = at(3, 23, 30)
      await insertActivity(user, {
        activity_type: 'strength_training',
        end_time: new Date(start.getTime() + 600_000),
        source: 'aurboda',
        start_time: start,
      })
      const strengthTrend = (tz?: string) =>
        getTrend(user, {
          aggregation: 'count',
          display_period: 'daily',
          lookback_days: 7,
          pattern: 'strength_training',
          source_type: 'activity_type',
          ...(tz ? { tz } : {}),
        })
      const valueOn = (history: { date: string; value: number }[], key: string) =>
        history.find((p) => p.date === key)?.value
      const utcDay = utcDayKey(start)
      const nextDay = utcDayKey(at(2, 12, 0))

      const local = await strengthTrend('Pacific/Kiritimati')
      expect(valueOn(local.history, utcDay)).toBeUndefined()
      expect(local.history[0]?.date).toBe(nextDay)
      expect(valueOn(local.history, nextDay)).toBeGreaterThan(0)

      const utc = await strengthTrend()
      expect(valueOn(utc.history, utcDay)).toBeGreaterThan(0)
    })
  })

  describe('zero-filled trends start at their own first sample', () => {
    const daysAgo = (days: number) => {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - days)
      d.setUTCHours(12, 0, 0, 0)
      return d
    }
    const dayKey = (d: Date) => d.toISOString().slice(0, 10)
    const run = (start: Date, data?: Record<string, unknown>) =>
      insertActivity(getTestUser(), {
        activity_type: 'running',
        ...(data ? { data } : {}),
        end_time: new Date(start.getTime() + 3_600_000),
        source: 'aurboda',
        start_time: start,
      })
    const runningTrend = (extra: Record<string, unknown> = {}) =>
      getTrend(getTestUser(), {
        aggregation: 'sum',
        display_period: 'weekly',
        lookback_days: 30,
        pattern: 'running',
        source_type: 'activity_type',
        tz: 'UTC',
        ...extra,
      })

    test('a lone one-hour run reads about an hour per week from its own day on, with no points before it', async () => {
      await run(daysAgo(10))

      const result = await runningTrend()

      expect(result.history).toHaveLength(11)
      expect(result.history[0].date).toBe(dayKey(daysAgo(10)))
      expect(result.history[0].value).toBeCloseTo(7 / firstPeriodWeight(15, 7), 6)
    })

    test('a run count trend starts at the first run too', async () => {
      await run(daysAgo(3))

      const result = await runningTrend({ aggregation: 'count', display_period: 'daily' })

      expect(result.history.map((p) => p.date)).toEqual([3, 2, 1, 0].map((n) => dayKey(daysAgo(n))))
      expect(result.history[0].value).toBeCloseTo(1, 6)
    })

    test('no samples, no points', async () => {
      const result = await runningTrend()

      expect(result.history).toEqual([])
      expect(result.current_value).toBe(0)
    })

    test('a first sample before the window still counts the empty days in it as zeros', async () => {
      await run(daysAgo(200))
      await run(daysAgo(5))

      const result = await runningTrend()

      expect(result.history).toHaveLength(31)
      expect(result.history[0]).toEqual({ date: dayKey(daysAgo(30)), value: 0 })
    })

    test('a steady daily amount is flat from its first day', async () => {
      const user = getTestUser()
      await insertTimeSeries(
        user,
        [9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((n) => ({
          metric: 'steps' as const,
          source: 'aurboda',
          time: daysAgo(n),
          value: 1000,
        })),
      )

      const result = await getTrend(user, {
        aggregation: 'sum',
        display_period: 'daily',
        lookback_days: 30,
        pattern: 'steps',
        source_type: 'metric',
        tz: 'UTC',
      })

      expect(result.missing_days).toBe('zero')
      expect(result.history).toHaveLength(10)
      for (const point of result.history) expect(point.value).toBeCloseTo(1000, 6)
    })

    test('a screentime category trend starts at its first span', async () => {
      await insertActivity(getTestUser(), {
        activity_type: 'screentime',
        data: { category_path: 'Work > Programming' },
        end_time: new Date(daysAgo(4).getTime() + 7_200_000),
        source: 'aurboda',
        start_time: daysAgo(4),
      })

      const result = await getTrend(getTestUser(), {
        display_period: 'daily',
        lookback_days: 30,
        pattern: 'Work',
        source_type: 'productivity_category',
        tz: 'UTC',
      })

      expect(result.history[0]).toEqual({ date: dayKey(daysAgo(4)), value: 2 })
      expect(result.history).toHaveLength(5)
    })

    test('a series older than the window reads a full period from its oldest displayed point', async () => {
      for (let n = 0; n < 60; n++) await run(daysAgo(n))

      const result = await runningTrend({
        aggregation: 'count',
        display_period: 'monthly',
        half_life_days: 1,
        lookback_days: 5,
      })

      expect(result.history).toHaveLength(6)
      for (const point of result.history) expect(point.value).toBeCloseTo(30, 6)
    })

    test("a category's sub-category match escapes LIKE metacharacters in the path", async () => {
      const span = (path: string, start: Date) =>
        insertActivity(getTestUser(), {
          activity_type: 'screentime',
          data: { category_path: path },
          end_time: new Date(start.getTime() + 3_600_000),
          source: 'aurboda',
          start_time: start,
        })
      await span('AxB > C', daysAgo(6))
      await span('A_B%', daysAgo(5))
      await span('A_B > C', daysAgo(2))

      const trend = () =>
        getTrend(getTestUser(), {
          display_period: 'daily',
          lookback_days: 30,
          pattern: 'A_B',
          source_type: 'productivity_category',
          tz: 'UTC',
        })

      expect((await trend()).history[0]).toEqual({ date: dayKey(daysAgo(2)), value: 1 })

      await span('A_B', daysAgo(3))
      expect((await trend()).history[0]).toEqual({ date: dayKey(daysAgo(3)), value: 1 })
    })

    test('breakdown series share one x-axis from the earliest first sample', async () => {
      await run(daysAgo(10), { partner: 'alice' })
      await run(daysAgo(5), { partner: 'bob' })

      const result = await runningTrend({ breakdown_fields: ['partner'] })
      const alice = result.breakdown_histories!['alice']
      const bob = result.breakdown_histories!['bob']

      expect(alice[0].date).toBe(dayKey(daysAgo(10)))
      expect(bob.map((p) => p.date)).toEqual(alice.map((p) => p.date))
      expect(bob).toHaveLength(11)
      expect(bob.slice(0, 5).every((p) => p.value === 0)).toBe(true)
      expect(alice[0].value).toBeCloseTo(7 / firstPeriodWeight(15, 7), 6)
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
