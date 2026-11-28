import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { Activity } from './types.ts'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { insertActivity, softDeleteActivityByExternalId } from './activities/index.ts'
import {
  getFirstActivityDay,
  getFirstActivityDayMatching,
  getFirstCategoryDay,
  getFirstMetricDay,
} from './first-day.ts'
import { insertTimeSeries } from './time-series.ts'

const CONTAINER_TIMEOUT = 120_000

const activity = (activity_type: string, start: string, extra: Partial<Activity> = {}): Activity => ({
  activity_type,
  end_time: new Date(new Date(start).getTime() + 30 * 60_000),
  source: 'aurboda' as const,
  start_time: new Date(start),
  ...extra,
})

describe('first day of a chart source', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('getFirstActivityDay: the local day of the earliest live activity of the types', async () => {
    const user = getTestUser()
    expect(await getFirstActivityDay(user, ['running'], 'UTC')).toBeUndefined()
    expect(await getFirstActivityDay(user, [], 'UTC')).toBeUndefined()

    await insertActivity(user, activity('running', '2019-06-30T23:30:00Z'))
    await insertActivity(user, activity('running', '2016-01-01T10:00:00Z', { external_id: 'old' }))
    await softDeleteActivityByExternalId(user, 'aurboda', 'old')
    await insertActivity(user, activity('yoga', '2010-05-05T10:00:00Z'))

    expect(await getFirstActivityDay(user, ['running'], 'UTC')).toBe('2019-06-30')
    expect(await getFirstActivityDay(user, ['running'], 'Europe/Stockholm')).toBe('2019-07-01')
    expect(await getFirstActivityDay(user, ['running', 'yoga'], 'UTC')).toBe('2010-05-05')
  })

  test('getFirstActivityDayMatching: by a case-insensitive type regex', async () => {
    const user = getTestUser()
    await insertActivity(user, activity('running', '2021-02-03T08:00:00Z'))
    await insertActivity(user, activity('meditation', '2018-02-03T08:00:00Z'))

    expect(await getFirstActivityDayMatching(user, '^RUN', 'UTC')).toBe('2021-02-03')
    expect(await getFirstActivityDayMatching(user, 'nothing', 'UTC')).toBeUndefined()
  })

  test('getFirstCategoryDay: the category and its sub-categories, not a sibling', async () => {
    const user = getTestUser()
    const span = (path: string, start: string) =>
      activity('screentime', start, { data: { category_path: path }, external_id: `${path}-${start}` })
    await insertActivity(user, span('Work > Programming', '2022-03-01T09:00:00Z'))
    await insertActivity(user, span('Work', '2023-03-01T09:00:00Z'))
    await insertActivity(user, span('Workout', '2020-03-01T09:00:00Z'))

    expect(await getFirstCategoryDay(user, 'Work', 'UTC')).toBe('2022-03-01')
    expect(await getFirstCategoryDay(user, 'Work > Programming', 'UTC')).toBe('2022-03-01')
    expect(await getFirstCategoryDay(user, 'Play', 'UTC')).toBeUndefined()
  })

  test('getFirstMetricDay: the earliest sample, from the given sources only', async () => {
    const user = getTestUser()
    expect(await getFirstMetricDay(user, 'steps', null, 'UTC')).toBeUndefined()

    await insertTimeSeries(user, [
      { metric: 'steps', source: 'garmin', time: new Date('2019-03-01T12:00:00Z'), value: 1200 },
      { metric: 'steps', source: 'oura', time: new Date('2017-03-01T12:00:00Z'), value: 900 },
    ])

    expect(await getFirstMetricDay(user, 'steps', null, 'UTC')).toBe('2017-03-01')
    expect(await getFirstMetricDay(user, 'steps', ['garmin'], 'UTC')).toBe('2019-03-01')
    expect(await getFirstMetricDay(user, 'weight', null, 'UTC')).toBeUndefined()
  })
})
