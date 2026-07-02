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
    // Only heart_rate is stored; HR-zone seconds are computed from it. Real
    // devices sample densely — computeHrZoneSecs caps gaps at 5s — so insert a
    // 5s cadence for ~5 min at 150 bpm.
    await insertTimeSeries(
      user,
      Array.from({ length: 60 }, (_, i) => ({
        metric: 'heart_rate' as const,
        source: 'garmin' as const,
        time: new Date(START.getTime() + 10 * 60_000 + i * 5_000),
        value: 150,
      })),
    )

    const scalars = await resolveActivityScalars(user, { end_time: END, start_time: START }, [
      'duration',
      'heart_rate_avg',
      'heart_rate_max',
      'hr_zone_minutes',
    ])
    const byKey = Object.fromEntries(scalars.map((s) => [s.key, s.value]))
    expect(byKey.duration).toBe(2400) // 40 min window
    expect(byKey.heart_rate_avg).toBe(150)
    expect(byKey.heart_rate_max).toBe(150)
    // hr_zone_minutes is derived from the heart_rate samples + effective zones,
    // not read from time_series — so it resolves to a non-empty per-zone record.
    const zones = byKey.hr_zone_minutes as Record<string, number>
    expect(typeof zones).toBe('object')
    expect(Object.values(zones).reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
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
