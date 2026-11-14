import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'

import { insertTimeSeries } from '../db/index.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  at,
  FIXTURE_DAY,
  FIXTURE_TIME_WEIGHTED_MEAN,
  FIXTURE_TIME_WEIGHTED_STDDEV,
  unevenlySampledDay,
} from '../test/time-weighted-fixture.ts'
import { getChartData } from './chart-data.ts'
import { getBaseline } from './correlations/baseline.ts'
import { getPeriodSummary } from './queries/period-summary.ts'
import { getTrend } from './trends.ts'

const CONTAINER_TIMEOUT = 120_000

beforeAll(async () => {
  await startTestDb()
}, CONTAINER_TIMEOUT)

afterAll(async () => {
  await stopTestDb()
})

beforeEach(async () => {
  await cleanTestDb()
  await insertTimeSeries(getTestUser(), [
    ...unevenlySampledDay('heart_rate'),
    ...unevenlySampledDay('stress_level'),
  ])
})

test('the stress baseline is the time-weighted mean', async () => {
  const baseline = await getBaseline(getTestUser(), new Date('2026-01-12T12:00:00Z'))

  expect(baseline.stress.avg7day).toBe(22.5)
  expect(baseline.stress.avg30day).toBe(22.5)
})

test('the period summary reports the time-weighted mean and deviation', async () => {
  const summary = await getPeriodSummary(getTestUser(), ['heart_rate'], at('00:00:00'), at('23:59:59'))
  const [hr] = summary.metrics

  expect(hr.avg).toBeCloseTo(FIXTURE_TIME_WEIGHTED_MEAN, 2)
  expect(hr.stddev).toBeCloseTo(FIXTURE_TIME_WEIGHTED_STDDEV, 2)
  expect(hr.outliers).toEqual([{ type: 'high', value: 80 }])
})

test('a metric trend averages each day time-weighted', async () => {
  const result = await getTrend(getTestUser(), {
    display_period: 'daily',
    end: new Date(`${FIXTURE_DAY}T12:00:00Z`),
    lookback_days: 7,
    pattern: 'stress_level',
    source_type: 'metric',
    tz: 'UTC',
  })

  expect(result.current_value).toBeCloseTo(FIXTURE_TIME_WEIGHTED_MEAN, 6)
})

test('chart means are time-weighted per day and plain per 5 minutes', async () => {
  const daily = await getChartData(getTestUser(), {
    aggregation: 'mean',
    bucket_size: '1d',
    end: at('23:59:59').toISOString(),
    pattern: 'heart_rate',
    source_type: 'metric',
    start: at('00:00:00').toISOString(),
    tz: 'UTC',
  })
  expect(daily.buckets).toHaveLength(1)
  expect((daily.buckets[0] as { value: number }).value).toBeCloseTo(FIXTURE_TIME_WEIGHTED_MEAN, 6)

  const fiveMinutes = await getChartData(getTestUser(), {
    aggregation: 'mean',
    bucket_size: '5m',
    end: at('10:04:59').toISOString(),
    pattern: 'heart_rate',
    source_type: 'metric',
    start: at('09:55:00').toISOString(),
    tz: 'UTC',
  })
  expect(fiveMinutes.buckets.map((b) => (b as { value: number }).value)).toEqual([20, 80])
})
