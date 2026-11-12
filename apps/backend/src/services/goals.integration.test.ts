import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { insertActivity, insertGoal } from '../db/index.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getGoalsProgress } from './goals.ts'
import { firstPeriodWeight } from './trends.ts'

const CONTAINER_TIMEOUT = 120_000

describe('trend goal progress integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('a series younger than its warm-up is scored on its own first sample, not on a climb from zero', async () => {
    const user = getTestUser()
    const start = new Date()
    start.setUTCHours(0, 0, 0, 0)
    await insertActivity(user, {
      activity_type: 'running',
      end_time: new Date(start.getTime() + 3_600_000),
      source: 'aurboda',
      start_time: start,
    })
    await insertGoal(user, {
      aggregation: 'sum',
      display_period: 'weekly',
      goal_type: 'trend',
      half_life_days: 15,
      id: '00000000-0000-4000-8000-000000001486',
      min: 1,
      pattern: 'running',
      source_type: 'activity_type',
    })

    const [progress] = await getGoalsProgress(user)

    expect(progress.goal_type).toBe('trend')
    expect(progress.current).toBeCloseTo(7 / firstPeriodWeight(15, 7), 6)
    expect(progress.current).toBeGreaterThan(1)
  })
})
