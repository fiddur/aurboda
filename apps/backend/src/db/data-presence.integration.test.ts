import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { insertActivity, softDeleteActivityByExternalId } from './activities/index.ts'
import { getDataPresence } from './data-presence.ts'
import { insertTimeSeries } from './time-series.ts'

const CONTAINER_TIMEOUT = 120_000

describe('getDataPresence', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('answers false for everything on an account without data', async () => {
    expect(await getDataPresence(getTestUser(), ['steps', 'mood'], ['exercise'])).toEqual({
      activity_types: { exercise: false },
      metrics: { mood: false, steps: false },
    })
  })

  test('a metric counts with any sample at any time', async () => {
    const user = getTestUser()
    await insertTimeSeries(user, [
      { metric: 'steps', source: 'garmin', time: new Date('2019-03-01T12:00:00Z'), value: 1200 },
    ])

    expect((await getDataPresence(user, ['steps', 'hrv_rmssd'], [])).metrics).toEqual({
      hrv_rmssd: false,
      steps: true,
    })
  })

  test('an activity type counts its subtypes and not its deleted activities', async () => {
    const user = getTestUser()
    await insertActivity(user, {
      activity_type: 'running',
      end_time: new Date('2024-01-15T11:00:00Z'),
      source: 'health_connect',
      start_time: new Date('2024-01-15T10:00:00Z'),
    })
    await insertActivity(user, {
      activity_type: 'meditation',
      end_time: new Date('2024-01-15T08:20:00Z'),
      external_id: 'm1',
      source: 'oura',
      start_time: new Date('2024-01-15T08:00:00Z'),
    })
    await softDeleteActivityByExternalId(user, 'oura', 'm1')

    expect(
      (await getDataPresence(user, [], ['exercise', 'running', 'sleep', 'meditation'])).activity_types,
    ).toEqual({
      exercise: true,
      meditation: false,
      running: true,
      sleep: false,
    })
  })
})
