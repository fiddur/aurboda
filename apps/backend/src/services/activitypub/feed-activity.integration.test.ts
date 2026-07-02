import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

/**
 * Integration test for the DB-backed shared-scalar resolver: aggregates real
 * time-series over the activity window and maps the user's selection.
 */
import { insertTimeSeries } from '../../db/time-series.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../../test/db-test-helper.ts'
import { resolveActivityScalars } from './feed-activity.ts'

const CONTAINER_TIMEOUT = 120_000
const START = new Date('2026-07-01T06:30:00Z')
const END = new Date('2026-07-01T07:10:00Z')

describe('resolveActivityScalars', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('aggregates window metrics into the selected scalar summaries', async () => {
    const user = getTestUser()
    await insertTimeSeries(user, [
      { metric: 'heart_rate', source: 'garmin', time: new Date('2026-07-01T06:40:00Z'), value: 140 },
      { metric: 'heart_rate', source: 'garmin', time: new Date('2026-07-01T06:50:00Z'), value: 160 },
      { metric: 'hr_zone_2_sec', source: 'garmin', time: new Date('2026-07-01T06:45:00Z'), value: 1320 },
    ])

    const scalars = await resolveActivityScalars(user, { end_time: END, start_time: START }, [
      'duration',
      'heart_rate_avg',
      'heart_rate_max',
      'hr_zone_minutes',
    ])
    const byKey = Object.fromEntries(scalars.map((s) => [s.key, s.value]))
    expect(byKey.duration).toBe(2400) // 40 min window
    expect(byKey.heart_rate_avg).toBe(150) // (140+160)/2
    expect(byKey.heart_rate_max).toBe(160)
    expect(byKey.hr_zone_minutes).toEqual({ z2: 22 }) // 1320s → 22 min
  })

  test('omits scalars whose metrics have no data in the window', async () => {
    const user = getTestUser()
    // heart_rate exists but distance does not.
    await insertTimeSeries(user, [
      { metric: 'heart_rate', source: 'garmin', time: new Date('2026-07-01T06:40:00Z'), value: 150 },
    ])
    const scalars = await resolveActivityScalars(user, { end_time: END, start_time: START }, [
      'heart_rate_avg',
      'distance',
      'calories',
    ])
    expect(scalars.map((s) => s.key)).toEqual(['heart_rate_avg'])
  })
})
