import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

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
      pattern: 'steps',
      source_type: 'metric',
    })

    expect(result.current_value).toBeCloseTo(1200)
  })
})
