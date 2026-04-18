/**
 * Integration tests for persisted supersession (`superseded_by` column).
 *
 * Verifies that:
 *   1. Cross-source duplicates get marked correctly during sync.
 *   2. Chart/trend queries skip superseded rows.
 *   3. Materialization is idempotent.
 *   4. Backfill works for historical data.
 *   5. Restoring/deleting activities re-materializes correctly.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  backfillSuperseded,
  getActivityById,
  insertActivities,
  insertActivity,
  materializeSuperseded,
} from './activities.ts'
import { query } from './connection.ts'

const CONTAINER_TIMEOUT = 60_000

/** Count non-deleted, non-superseded rows for a given activity_type. */
const countActive = async (user: string, activityType: string): Promise<number> => {
  const result = await query(
    user,
    `SELECT COUNT(*)::int AS n
       FROM activities
      WHERE activity_type = $1
        AND deleted_at IS NULL
        AND superseded_by IS NULL`,
    [activityType],
  )
  return result.rows[0].n as number
}

/** Sum duration in hours for a given activity_type (what chart sum aggregations do). */
const sumHours = async (user: string, activityType: string): Promise<number> => {
  const result = await query(
    user,
    `SELECT COALESCE(
              SUM(EXTRACT(EPOCH FROM (COALESCE(end_time, start_time + interval '1 hour') - start_time))) / 3600.0,
              0
            ) AS hours
       FROM activities
      WHERE activity_type = $1
        AND deleted_at IS NULL
        AND superseded_by IS NULL`,
    [activityType],
  )
  return Number(result.rows[0].hours)
}

describe('superseded_by materialization', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('same-type duplicates from two sources get collapsed to a single active row', async () => {
    const user = getTestUser()

    const garminId = await insertActivity(user, {
      activity_type: 'running',
      source: 'garmin',
      start_time: new Date('2024-01-15T10:00:00Z'),
      end_time: new Date('2024-01-15T10:21:00Z'),
    })
    const ouraId = await insertActivity(user, {
      activity_type: 'running',
      source: 'oura',
      start_time: new Date('2024-01-15T10:00:30Z'),
      end_time: new Date('2024-01-15T10:20:30Z'),
    })

    // Only one row should be active. The winner's end_time covers the union.
    expect(await countActive(user, 'running')).toBe(1)

    // Chart sum should reflect ~21 minutes, not ~41.
    const hours = await sumHours(user, 'running')
    expect(hours).toBeGreaterThan(0.3)
    expect(hours).toBeLessThan(0.4)

    // Source priority: garmin(3) > oura(2), so the Garmin row wins.
    const garmin = await getActivityById(user, garminId)
    const oura = await getActivityById(user, ouraId)
    expect(garmin?.superseded_by).toBeUndefined()
    expect(oura?.superseded_by).toBe(garminId)
  })

  test('strava and garmin duplicates of the same run collapse to one', async () => {
    const user = getTestUser()

    // Strava activities always have an external_id. Both sources will be
    // caught by the cross-source / same-type merge pipeline.
    const garminId = await insertActivity(user, {
      activity_type: 'running',
      source: 'garmin',
      external_id: 'garmin-activity-12345',
      start_time: new Date('2024-01-15T10:00:00Z'),
      end_time: new Date('2024-01-15T10:21:00Z'),
    })
    const stravaId = await insertActivity(user, {
      activity_type: 'running',
      source: 'strava',
      external_id: 'strava-activity-98765',
      start_time: new Date('2024-01-15T10:00:15Z'),
      end_time: new Date('2024-01-15T10:20:45Z'),
    })

    expect(await countActive(user, 'running')).toBe(1)

    // Garmin outranks Strava in the priority table, so Garmin keeps the winner slot.
    const garmin = await getActivityById(user, garminId)
    const strava = await getActivityById(user, stravaId)
    expect(garmin?.superseded_by).toBeUndefined()
    expect(strava?.superseded_by).toBe(garminId)
  })

  test('same-type merge uses earliest start_time as winner', async () => {
    const user = getTestUser()

    // Within a single type, same-type merge picks the earliest as winner and
    // extends the range. Priority only matters for cross-source merge of
    // DIFFERENT types in the same category.
    const earlyId = await insertActivity(user, {
      activity_type: 'meditation',
      source: 'oura',
      start_time: new Date('2024-01-15T07:00:00Z'),
      end_time: new Date('2024-01-15T07:20:00Z'),
    })
    const lateId = await insertActivity(user, {
      activity_type: 'meditation',
      source: 'aurboda',
      start_time: new Date('2024-01-15T07:00:30Z'),
      end_time: new Date('2024-01-15T07:21:00Z'),
    })

    expect(await countActive(user, 'meditation')).toBe(1)
    const early = await getActivityById(user, earlyId)
    const late = await getActivityById(user, lateId)
    expect(early?.superseded_by).toBeUndefined()
    expect(late?.superseded_by).toBe(earlyId)
  })

  test('non-overlapping activities stay independent', async () => {
    const user = getTestUser()

    await insertActivity(user, {
      activity_type: 'running',
      source: 'garmin',
      start_time: new Date('2024-01-15T09:00:00Z'),
      end_time: new Date('2024-01-15T09:30:00Z'),
    })
    await insertActivity(user, {
      activity_type: 'running',
      source: 'garmin',
      start_time: new Date('2024-01-15T18:00:00Z'),
      end_time: new Date('2024-01-15T18:30:00Z'),
    })

    expect(await countActive(user, 'running')).toBe(2)
  })

  test('materializeSuperseded is idempotent', async () => {
    const user = getTestUser()

    await insertActivity(user, {
      activity_type: 'running',
      source: 'garmin',
      start_time: new Date('2024-01-15T10:00:00Z'),
      end_time: new Date('2024-01-15T10:30:00Z'),
    })
    await insertActivity(user, {
      activity_type: 'running',
      source: 'oura',
      start_time: new Date('2024-01-15T10:00:30Z'),
      end_time: new Date('2024-01-15T10:29:30Z'),
    })

    const before = await countActive(user, 'running')
    await materializeSuperseded(user, new Date('2024-01-15T10:15:00Z'))
    await materializeSuperseded(user, new Date('2024-01-15T10:15:00Z'))
    const after = await countActive(user, 'running')

    expect(after).toBe(before)
    expect(after).toBe(1)
  })

  test('ical-sourced activities do not trigger cross-source merging', async () => {
    const user = getTestUser()

    // Two overlapping calendar events from different integrations should
    // NOT be deduped — calendar events are never physical sessions.
    const a = await insertActivity(user, {
      activity_type: 'calendar_event',
      source: 'calendar',
      external_id: 'cal-1',
      start_time: new Date('2024-01-15T10:00:00Z'),
      end_time: new Date('2024-01-15T11:00:00Z'),
    })
    const b = await insertActivity(user, {
      activity_type: 'calendar_event',
      source: 'calendar',
      external_id: 'cal-2',
      start_time: new Date('2024-01-15T10:30:00Z'),
      end_time: new Date('2024-01-15T11:30:00Z'),
    })

    const ra = await getActivityById(user, a)
    const rb = await getActivityById(user, b)
    expect(ra?.superseded_by).toBeUndefined()
    expect(rb?.superseded_by).toBeUndefined()
  })

  test('backfillSuperseded marks historical duplicates after the column is introduced', async () => {
    const user = getTestUser()

    // Simulate pre-existing data by inserting raw rows without going through
    // the insert path that triggers materialization.
    await query(
      user,
      `INSERT INTO activities (source, activity_type, start_time, end_time)
       VALUES ('garmin', 'running', $1, $2), ('oura', 'running', $3, $4)`,
      [
        new Date('2024-01-10T10:00:00Z'),
        new Date('2024-01-10T10:30:00Z'),
        new Date('2024-01-10T10:00:30Z'),
        new Date('2024-01-10T10:29:30Z'),
      ],
    )

    // Before backfill: no row is marked superseded, chart would double-count.
    expect(await countActive(user, 'running')).toBe(2)

    const { days } = await backfillSuperseded(user)
    expect(days).toBeGreaterThan(0)

    // After backfill: duplicates are marked.
    expect(await countActive(user, 'running')).toBe(1)
  })

  test('insertActivities (batch) materializes all affected days', async () => {
    const user = getTestUser()

    await insertActivities(user, [
      {
        activity_type: 'running',
        source: 'garmin',
        start_time: new Date('2024-01-10T10:00:00Z'),
        end_time: new Date('2024-01-10T10:30:00Z'),
      },
      {
        activity_type: 'running',
        source: 'oura',
        start_time: new Date('2024-01-10T10:00:30Z'),
        end_time: new Date('2024-01-10T10:29:30Z'),
      },
      {
        activity_type: 'running',
        source: 'garmin',
        start_time: new Date('2024-01-11T10:00:00Z'),
        end_time: new Date('2024-01-11T10:30:00Z'),
      },
    ])

    // Day 10: two sources overlap → 1 active. Day 11: only garmin → 1 active.
    expect(await countActive(user, 'running')).toBe(2)
  })
})
