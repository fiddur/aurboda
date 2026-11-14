import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  at,
  FIXTURE_COUNT,
  FIXTURE_DAY,
  FIXTURE_POOLED_MEAN,
  FIXTURE_SUM,
  FIXTURE_TIME_WEIGHTED_MEAN,
  FIXTURE_TIME_WEIGHTED_STDDEV,
  unevenlySampledDay,
} from '../test/time-weighted-fixture.ts'
import {
  getDailyAggregates,
  getTimeSeriesBucketed,
  getTimeSeriesStats,
  insertTimeSeries,
} from './time-series.ts'

const CONTAINER_TIMEOUT = 120_000

const dayStart = at('00:00:00')
const dayEnd = at('23:59:59')

describe('time-weighted averages', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    const user = getTestUser()
    await insertTimeSeries(user, [
      ...unevenlySampledDay('heart_rate'),
      ...unevenlySampledDay('stress_level'),
      ...unevenlySampledDay('weight'),
    ])
  })

  test('getTimeSeriesStats weighs every 5-minute bin alike for instantaneous-sample metrics', async () => {
    const stats = await getTimeSeriesStats(
      getTestUser(),
      ['heart_rate', 'stress_level', 'weight'],
      dayStart,
      dayEnd,
    )

    for (const metric of ['heart_rate', 'stress_level']) {
      const s = stats.find((x) => x.metric === metric)!
      expect(s.avg).toBeCloseTo(FIXTURE_TIME_WEIGHTED_MEAN, 6)
      expect(s.stddev).toBeCloseTo(FIXTURE_TIME_WEIGHTED_STDDEV, 6)
      expect(s).toMatchObject({ count: FIXTURE_COUNT, max: 80, min: 20 })
    }
    const weight = stats.find((x) => x.metric === 'weight')!
    expect(weight.avg).toBeCloseTo(FIXTURE_POOLED_MEAN, 6)
    expect(weight.count).toBe(FIXTURE_COUNT)
  })

  test('getDailyAggregates time-weights the daily mean and keeps the sum of the samples', async () => {
    const rows = await getDailyAggregates(getTestUser(), ['heart_rate', 'weight'], dayStart, dayEnd)

    expect(rows.map((r) => [r.metric, r.date])).toEqual([
      ['heart_rate', FIXTURE_DAY],
      ['weight', FIXTURE_DAY],
    ])
    expect(rows[0].avg).toBeCloseTo(FIXTURE_TIME_WEIGHTED_MEAN, 6)
    expect(rows[0].sum).toBeCloseTo(FIXTURE_SUM, 6)
    expect(rows[1].avg).toBeCloseTo(FIXTURE_POOLED_MEAN, 6)
  })

  test('getTimeSeriesBucketed time-weights buckets wider than 5 minutes', async () => {
    const [day] = await getTimeSeriesBucketed(
      getTestUser(),
      ['heart_rate'],
      dayStart,
      at('23:59:59'),
      '1 day',
    )

    expect(day.avg).toBeCloseTo(FIXTURE_TIME_WEIGHTED_MEAN, 6)
    expect(day).toMatchObject({
      count: FIXTURE_COUNT,
      first_time: dayStart,
      last_time: at('23:57:00'),
      max: 80,
      min: 20,
    })
    expect(day.sum).toBeCloseTo(FIXTURE_SUM, 6)
  })

  test('getTimeSeriesBucketed bins from the query start, so bins nest in buckets', async () => {
    const [straddling] = await getTimeSeriesBucketed(
      getTestUser(),
      ['heart_rate'],
      at('09:55:00'),
      at('10:05:00'),
      '10 minutes',
    )

    // 09:57 at 20 in [09:55, 10:00), 300 samples at 80 in [10:00, 10:05); pooled it would read 79.8.
    expect(straddling.avg).toBeCloseTo(50, 6)
    expect(straddling.count).toBe(301)
  })

  test('getTimeSeriesBucketed leaves buckets of 5 minutes or less the plain mean', async () => {
    const buckets = await getTimeSeriesBucketed(
      getTestUser(),
      ['heart_rate'],
      at('09:56:30'),
      at('10:01:30'),
      '5 minutes',
    )

    expect(buckets).toHaveLength(1)
    expect(buckets[0].avg).toBeCloseTo((20 + 90 * 80) / 91, 6)
  })
})
