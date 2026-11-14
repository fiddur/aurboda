import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { insertActivity } from './activities/index.ts'
import { insertActivityTypeDefinition } from './activity-type-definitions.ts'
import { query } from './connection.ts'
import { countTimeSeriesInWindows, getFlaggedWindows } from './flagged-windows.ts'
import { getTimeSeriesBucketed, getTimeSeriesStats, insertTimeSeries } from './time-series.ts'

const CONTAINER_TIMEOUT = 120_000

const at = (iso: string) => new Date(iso)
const gathering = { end: at('2026-05-04T00:00:00Z'), start: at('2026-05-01T00:00:00Z') }

describe('flagged windows against the database', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    const user = getTestUser()
    await query(user, `DELETE FROM activity_type_definitions WHERE is_builtin = false`)
    for (const name of ['gathering', 'retreat']) {
      await insertActivityTypeDefinition(user, { display_category: 'other', display_name: name, name })
    }
    await insertActivity(user, {
      activity_type: 'gathering',
      data: { exclude_from_baseline: true },
      end_time: gathering.end,
      source: 'manual',
      start_time: gathering.start,
    })
    await insertActivity(user, {
      activity_type: 'gathering',
      data: { exclude_from_baseline: false },
      end_time: at('2026-06-03T00:00:00Z'),
      source: 'manual',
      start_time: at('2026-06-01T00:00:00Z'),
    })
    await insertActivity(user, {
      activity_type: 'retreat',
      data: { exclude_from_baseline: true },
      source: 'manual',
      start_time: at('2026-07-01T00:00:00Z'),
    })
    await insertTimeSeries(user, [
      { metric: 'resting_heart_rate', source: 'garmin', time: at('2026-04-30T06:00:00Z'), value: 50 },
      { metric: 'resting_heart_rate', source: 'garmin', time: at('2026-05-02T06:00:00Z'), value: 70 },
      { metric: 'resting_heart_rate', source: 'garmin', time: at('2026-05-05T06:00:00Z'), value: 52 },
      { metric: 'steps', source: 'aurboda', time: at('2026-04-30T12:00:00Z'), value: 1000 },
      { metric: 'steps', source: 'aurboda', time: at('2026-05-02T12:00:00Z'), value: 9000 },
    ])
  })

  test('getFlaggedWindows returns flagged activities with an end overlapping the range, any type', async () => {
    const user = getTestUser()
    const windows = await getFlaggedWindows(user, at('2026-04-01T00:00:00Z'), at('2026-08-01T00:00:00Z'))
    expect(windows).toEqual([
      {
        activity_id: expect.any(String),
        activity_type: 'gathering',
        end: gathering.end,
        start: gathering.start,
      },
    ])
    expect(await getFlaggedWindows(user, at('2026-05-04T00:00:00Z'), at('2026-05-10T00:00:00Z'))).toEqual([])
  })

  test('countTimeSeriesInWindows counts the samples inside the windows', async () => {
    const user = getTestUser()
    expect(await countTimeSeriesInWindows(user, ['resting_heart_rate', 'steps'], [gathering])).toBe(2)
    expect(await countTimeSeriesInWindows(user, ['resting_heart_rate'], [])).toBe(0)
  })

  test('getTimeSeriesStats leaves out the samples inside the outside windows', async () => {
    const user = getTestUser()
    const range = [at('2026-04-01T00:00:00Z'), at('2026-06-01T00:00:00Z')] as const
    const [all] = await getTimeSeriesStats(user, ['resting_heart_rate'], ...range)
    expect(all).toMatchObject({ avg: 172 / 3, count: 3 })
    const stats = await getTimeSeriesStats(user, ['resting_heart_rate', 'steps'], ...range, [gathering])
    expect(stats.map((s) => [s.metric, s.count, s.avg])).toEqual([
      ['resting_heart_rate', 2, 51],
      ['steps', 1, 1000],
    ])
  })

  test('getTimeSeriesBucketed leaves out the samples inside the outside windows', async () => {
    const user = getTestUser()
    const buckets = await getTimeSeriesBucketed(
      user,
      ['resting_heart_rate', 'steps'],
      at('2026-04-27T00:00:00Z'),
      at('2026-05-11T00:00:00Z'),
      '7 days',
      'UTC',
      [gathering],
    )
    const rows = buckets.map((b) => [b.bucket_start.toISOString(), b.metric, b.count, b.sum])
    expect(rows.toSorted((a, b) => String(a).localeCompare(String(b)))).toEqual([
      ['2026-04-27T00:00:00.000Z', 'resting_heart_rate', 1, 50],
      ['2026-04-27T00:00:00.000Z', 'steps', 1, 1000],
      ['2026-05-04T00:00:00.000Z', 'resting_heart_rate', 1, 52],
    ])
  })
})
