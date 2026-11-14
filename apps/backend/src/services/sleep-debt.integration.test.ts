import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { insertActivity, upsertUserSettings } from '../db/index.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getSleepDebt } from './sleep-debt.ts'

const CONTAINER_TIMEOUT = 120_000

describe('getSleepDebt integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  const night = (wake: string, hours: number, source: 'garmin' | 'oura' = 'oura') => {
    const end = new Date(`${wake}T06:00:00Z`)
    return insertActivity(getTestUser(), {
      activity_type: 'sleep',
      end_time: end,
      external_id: `${source}-sleep-${wake}`,
      source,
      start_time: new Date(end.getTime() - hours * 3600_000),
    })
  }

  test('judges stored nights and naps, merged across sources, against the sleep need setting', async () => {
    const user = getTestUser()
    await upsertUserSettings(user, { sleep_need_minutes: 450 })
    await night('2026-03-01', 6)
    await night('2026-03-01', 6, 'garmin')
    await night('2026-03-02', 7)
    await insertActivity(user, {
      activity_type: 'nap',
      end_time: new Date('2026-03-02T13:40:00Z'),
      external_id: 'oura-nap-2026-03-02',
      source: 'oura',
      start_time: new Date('2026-03-02T13:00:00Z'),
    })
    await night('2026-03-04', 7.5)

    const result = await getSleepDebt(user, { end: '2026-03-04', start: '2026-03-01', tz: 'UTC' })

    expect(result).toEqual({
      days: [
        { date: '2026-03-01', debt_minutes: 90, severity: 'mild', slept_minutes: 360 },
        { date: '2026-03-02', debt_minutes: 87, severity: 'mild', slept_minutes: 440 },
        { date: '2026-03-03', debt_minutes: 74, severity: 'mild', slept_minutes: null },
        { date: '2026-03-04', debt_minutes: 62, severity: 'mild', slept_minutes: 450 },
      ],
      debt_minutes: 62,
      severity: 'mild',
      sleep_need_minutes: 450,
    })
  })
})
