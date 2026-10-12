import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { insertCustomMetricDefinition } from '../db/custom-metrics.ts'
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
})
