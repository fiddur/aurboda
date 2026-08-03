/**
 * Integration test for Garmin activity type resolution.
 *
 * Runs processGarminData against a real PostgreSQL instance so the
 * activities → activity_type_definitions foreign key is actually enforced:
 * an unmapped Garmin typeKey must degrade to a defined type instead of
 * failing the insert and taking the rest of the batch with it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { query } from '../../db/connection.ts'
import {
  activityTypeExists,
  deleteGarminActivityWithWrongType,
  insertActivity,
  insertLocations,
  insertRawRecord,
  insertTimeSeries,
} from '../../db/index.ts'
import { softDeleteLocationRange } from '../../db/locations.ts'
import { auditError } from '../../services/audit-log.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../../test/db-test-helper.ts'
import { processGarminData } from './process.ts'

const CONTAINER_TIMEOUT = 120_000

const realDeps = {
  activityTypeExists,
  auditError,
  deleteGarminActivityWithWrongType,
  insertActivity,
  insertLocations,
  insertRawRecord,
  insertTimeSeries,
  softDeleteLocationRange,
}

const makeActivity = (overrides: Record<string, unknown> = {}) => ({
  activityId: 12345,
  activityName: 'Morning Row',
  activityType: { typeKey: 'rowing_v2' },
  averageHR: 145,
  beginTimestamp: 1736924400000,
  calories: 350,
  distance: 5000,
  duration: 1800,
  elapsedDuration: 1800,
  elevationGain: 0,
  maxHR: 175,
  startTimeGMT: '2025-01-15T07:00:00.000',
  steps: 0,
  vO2MaxValue: 0,
  ...overrides,
})

const getStoredActivities = async (user: string) => {
  const result = await query(
    user,
    `SELECT activity_type, title, data FROM activities WHERE source = 'garmin' ORDER BY start_time, title`,
    [],
  )
  return result.rows as { activity_type: string; data: Record<string, unknown>; title: string }[]
}

describe('Garmin activity type resolution (integration)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('stores a versioned typeKey under its unversioned activity type', async () => {
    const user = getTestUser()

    const count = await processGarminData(user, 'activities', [makeActivity()], realDeps)

    expect(count).toBe(1)
    const stored = await getStoredActivities(user)
    expect(stored).toHaveLength(1)
    expect(stored[0].activity_type).toBe('rowing')
    expect(stored[0].data.garmin_type_key).toBeUndefined()
  })

  test('stores an unknown typeKey as other_workout instead of violating the foreign key', async () => {
    const user = getTestUser()

    const count = await processGarminData(
      user,
      'activities',
      [makeActivity({ activityName: 'Kite Day', activityType: { typeKey: 'kitesurfing' } })],
      realDeps,
    )

    expect(count).toBe(1)
    const stored = await getStoredActivities(user)
    expect(stored).toHaveLength(1)
    expect(stored[0].activity_type).toBe('other_workout')
    expect(stored[0].data.garmin_type_key).toBe('kitesurfing')
  })

  test('a failing activity does not stop the rest of the batch', async () => {
    const user = getTestUser()

    // title is VARCHAR(255) — an over-long one fails at the DB, standing in for
    // any per-activity error Garmin might hand us.
    const data = [
      makeActivity({ activityId: 1, activityName: 'x'.repeat(300) }),
      makeActivity({ activityId: 2, activityName: 'Evening Row' }),
    ]

    const count = await processGarminData(user, 'activities', data, realDeps)

    expect(count).toBe(1)
    const stored = await getStoredActivities(user)
    expect(stored).toHaveLength(1)
    expect(stored[0].title).toBe('Evening Row')

    const audit = await query(user, `SELECT message, details FROM audit_log WHERE level = 'error'`, [])
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0].message).toContain('1')
  })
})
