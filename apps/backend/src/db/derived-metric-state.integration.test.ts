import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getDerivedMetricStamp, setDerivedMetricStamp } from './derived-metric-state.ts'

const CONTAINER_TIMEOUT = 120_000

describe('derived metric state integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('has no stamp until one is set, then gives the latest', async () => {
    const user = getTestUser()
    expect(await getDerivedMetricStamp(user, 'strength_score')).toBeNull()

    await setDerivedMetricStamp(user, 'strength_score', 'a')
    await setDerivedMetricStamp(user, 'strength_score', 'b')
    await setDerivedMetricStamp(user, 'other', 'c')

    expect(await getDerivedMetricStamp(user, 'strength_score')).toBe('b')
    expect(await getDerivedMetricStamp(user, 'other')).toBe('c')
  })
})
