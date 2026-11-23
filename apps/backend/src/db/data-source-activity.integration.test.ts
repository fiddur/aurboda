import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { query } from './connection.ts'
import { getRecentSourceActivity } from './data-source-activity.ts'
import { insertLocations } from './locations.ts'
import { insertProductivity } from './productivity.ts'
import { insertRawRecord } from './raw-records.ts'

const CONTAINER_TIMEOUT = 120_000

const since7d = new Date('2026-11-16T00:00:00Z')
const since30d = new Date('2026-10-24T00:00:00Z')

const screenTime = (source: 'activitywatch' | 'rescuetime', start: string, is_mobile = false) => ({
  activity: 'editor',
  duration_sec: 60,
  end_time: new Date(new Date(start).getTime() + 60_000),
  is_mobile,
  source,
  start_time: new Date(start),
})

describe('getRecentSourceActivity', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('answers nothing on an account without data', async () => {
    expect(await getRecentSourceActivity(getTestUser(), { since30d, since7d })).toEqual({
      health_connect: false,
      location_sources: [],
      productivity: [],
    })
  })

  test('lists each location source once, leaving out older and deleted fixes', async () => {
    const user = getTestUser()
    await insertLocations(user, [
      { lat: 59.3, lon: 18.0, source: 'owntracks', time: new Date('2026-11-20T10:00:00Z') },
      { lat: 59.3, lon: 18.0, source: 'owntracks', time: new Date('2026-11-20T11:00:00Z') },
      { lat: 59.3, lon: 18.0, source: 'home_assistant', time: new Date('2026-11-21T10:00:00Z') },
      { lat: 59.3, lon: 18.0, source: 'garmin', time: new Date('2026-11-01T10:00:00Z') },
      { lat: 59.3, lon: 18.0, source: 'strava', time: new Date('2026-11-22T10:00:00Z') },
    ])
    await query(user, `UPDATE locations SET deleted_at = NOW() WHERE source = 'strava'`)

    expect((await getRecentSourceActivity(user, { since30d, since7d })).location_sources).toEqual([
      'home_assistant',
      'owntracks',
    ])
  })

  test('lists each screen time source and device kind once, leaving out older and deleted records', async () => {
    const user = getTestUser()
    await insertProductivity(user, [
      screenTime('activitywatch', '2026-11-20T10:00:00Z'),
      screenTime('activitywatch', '2026-11-20T11:00:00Z'),
      screenTime('activitywatch', '2026-11-20T12:00:00Z', true),
      screenTime('rescuetime', '2026-11-01T10:00:00Z'),
    ])

    expect((await getRecentSourceActivity(user, { since30d, since7d })).productivity).toEqual([
      { is_mobile: false, source: 'activitywatch' },
      { is_mobile: true, source: 'activitywatch' },
    ])

    await query(user, `UPDATE productivity SET deleted_at = NOW() WHERE is_mobile`)

    expect((await getRecentSourceActivity(user, { since30d, since7d })).productivity).toEqual([
      { is_mobile: false, source: 'activitywatch' },
    ])
  })

  test('counts a Health Connect record within the last 30 days only', async () => {
    const user = getTestUser()
    await insertRawRecord(user, {
      data: {},
      external_id: 'old',
      record_type: 'HeartRate',
      recorded_at: new Date('2026-10-01T10:00:00Z'),
      source: 'health_connect',
    })
    await insertRawRecord(user, {
      data: {},
      external_id: 'garmin-1',
      record_type: 'sleep',
      recorded_at: new Date('2026-11-20T10:00:00Z'),
      source: 'garmin',
    })

    expect((await getRecentSourceActivity(user, { since30d, since7d })).health_connect).toBe(false)

    await insertRawRecord(user, {
      data: {},
      external_id: 'recent',
      record_type: 'HeartRate',
      recorded_at: new Date('2026-11-01T10:00:00Z'),
      source: 'health_connect',
    })

    expect((await getRecentSourceActivity(user, { since30d, since7d })).health_connect).toBe(true)
  })
})
