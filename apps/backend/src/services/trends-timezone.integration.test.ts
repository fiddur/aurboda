import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { insertActivity, insertTimeSeries } from '../db/index.ts'
import { getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getTrend } from './trends.ts'

const CONTAINER_TIMEOUT = 120_000

describe('trend history labels under a process timezone east of UTC', () => {
  const processTz = process.env.TZ

  beforeAll(async () => {
    process.env.TZ = 'Europe/Stockholm'
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
    if (processTz === undefined) delete process.env.TZ
    else process.env.TZ = processTz
  })

  test('a point is labelled with the day it is for, not the day before', async () => {
    expect(new Date(2024, 2, 10).getTimezoneOffset()).toBe(-60)
    const user = getTestUser()
    await insertActivity(user, {
      activity_type: 'meditation',
      end_time: new Date('2024-03-10T12:30:00Z'),
      source: 'manual',
      start_time: new Date('2024-03-10T12:00:00Z'),
    })
    const end = new Date('2024-03-12T22:59:59Z')
    for (const source_type of ['activity_type', 'tag'] as const) {
      const trend = await getTrend(user, { end, pattern: 'meditation', source_type, tz: 'UTC' })
      expect(trend.history[0]?.date).toBe('2024-03-10')
      expect(trend.history.at(-1)?.date).toBe('2024-03-12')
    }
    const hours = await getTrend(user, {
      aggregation: 'sum',
      end,
      pattern: 'meditation',
      source_type: 'activity_type',
      tz: 'UTC',
    })
    expect(hours.history[0]?.date).toBe('2024-03-10')
    const byPerson = await getTrend(user, {
      breakdown_fields: ['activity_type'],
      end,
      pattern: 'meditation',
      source_type: 'activity_type',
      tz: 'UTC',
    })
    const series = Object.values(byPerson.breakdown_histories ?? {})[0] ?? []
    expect(series.find((point) => point.date === '2024-03-10')?.value).toBeGreaterThan(0)

    await insertTimeSeries(user, [
      { metric: 'weight', source: 'garmin', time: new Date('2024-03-11T07:00:00Z'), value: 80 },
    ])
    const weight = await getTrend(user, { end, pattern: 'weight', source_type: 'metric', tz: 'UTC' })
    expect(weight.history.map((point) => point.date)).toEqual(['2024-03-11', '2024-03-12'])
  })
})
