import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { insertActivity } from '../db/index.ts'
import { insertTimeSeries } from '../db/time-series.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getLatestSleep } from './latest-sleep.ts'

const CONTAINER_TIMEOUT = 120_000

describe('getLatestSleep integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  const now = new Date('2026-09-25T09:00:00Z')

  test('returns null without a recent sleep', async () => {
    expect(await getLatestSleep(getTestUser(), now)).toBeNull()
  })

  test('summarises the newest sleep with stages and vitals', async () => {
    const user = getTestUser()
    await insertActivity(user, {
      activity_type: 'sleep',
      end_time: new Date('2026-09-24T05:00:00Z'),
      external_id: 'garmin-sleep-2026-09-24',
      source: 'garmin',
      start_time: new Date('2026-09-23T21:00:00Z'),
    })
    const id = await insertActivity(user, {
      activity_type: 'sleep',
      data: {
        sleep_score: 81,
        stages: [
          { endTime: '2026-09-24T23:00:00Z', stage: 4, startTime: '2026-09-24T21:00:00Z' },
          { endTime: '2026-09-25T00:30:00Z', stage: 5, startTime: '2026-09-24T23:00:00Z' },
          { endTime: '2026-09-25T00:40:00Z', stage: 1, startTime: '2026-09-25T00:30:00Z' },
          { endTime: '2026-09-25T05:00:00Z', stage: 6, startTime: '2026-09-25T00:40:00Z' },
        ],
      },
      end_time: new Date('2026-09-25T05:00:00Z'),
      external_id: 'garmin-sleep-2026-09-25',
      source: 'garmin',
      start_time: new Date('2026-09-24T21:00:00Z'),
    })
    await insertTimeSeries(user, [
      { metric: 'resting_heart_rate', source: 'garmin', time: new Date('2026-09-10T12:00:00Z'), value: 50 },
      { metric: 'resting_heart_rate', source: 'garmin', time: new Date('2026-09-20T12:00:00Z'), value: 52 },
      { metric: 'resting_heart_rate', source: 'garmin', time: new Date('2026-09-25T12:00:00Z'), value: 48 },
      { metric: 'hrv_rmssd', source: 'garmin', time: new Date('2026-09-20T12:00:00Z'), value: 60 },
      { metric: 'hrv_rmssd', source: 'garmin', time: new Date('2026-09-25T12:00:00Z'), value: 66 },
      { metric: 'body_battery', source: 'garmin', time: new Date('2026-09-24T21:00:00Z'), value: 18 },
      { metric: 'body_battery', source: 'garmin', time: new Date('2026-09-25T04:57:00Z'), value: 83 },
    ])

    const result = await getLatestSleep(user, now)

    expect(result).toMatchObject({
      activity_id: id,
      body_battery_end: 83,
      body_battery_start: 18,
      end_time: '2026-09-25T05:00:00.000Z',
      hrv: 66,
      hrv_baseline: 60,
      resting_hr: 48,
      resting_hr_baseline: 51,
      sleep_score: 81,
      stage_minutes: { awake: 10, deep: 90, light: 120, rem: 260 },
      start_time: '2026-09-24T21:00:00.000Z',
      time_in_bed_min: 480,
      total_sleep_min: 470,
    })
    expect(result?.stages).toHaveLength(4)
    expect(result?.stages[0]).toEqual({
      end_time: '2026-09-24T23:00:00.000Z',
      stage: 4,
      start_time: '2026-09-24T21:00:00.000Z',
    })
  })
})
