import type { Goal } from '@aurboda/api-spec'

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { query } from './connection.ts'
import { getGoals, insertGoal } from './goals.ts'

const CONTAINER_TIMEOUT = 120_000

const ID = 'b0000001-0000-4000-8000-000000000001'

describe('goals', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('a measure goal round-trips, and replacing it with a metric goal nulls its columns', async () => {
    const user = getTestUser()
    const measure: Goal = {
      activity_type: 'strength_training',
      aggregation: 'max',
      filter_field: 'sets.exercise',
      filter_value: 'Bench Press',
      goal_type: 'measure',
      id: ID,
      measure: 'e1rm',
      min: 100,
      window: '30d',
    }
    await insertGoal(user, measure)

    expect(await getGoals(user)).toEqual([measure])

    const metric: Goal = { goal_type: 'metric', id: ID, metric: 'steps', min: 70000, window: '7d' }
    await insertGoal(user, metric)

    expect(await getGoals(user)).toEqual([metric])
    const row = await query(
      user,
      `SELECT activity_type, measure, filter_field, filter_value, aggregation FROM goals WHERE id = $1`,
      [ID],
    )
    expect(row.rows[0]).toEqual({
      activity_type: null,
      aggregation: null,
      filter_field: null,
      filter_value: null,
      measure: null,
    })
  })

  test('a measure trend goal round-trips with its measure fields, and a plain trend goal without them', async () => {
    const user = getTestUser()
    const measureTrend: Goal = {
      display_period: 'monthly',
      filter_field: 'sets.exercise',
      filter_value: 'Squat',
      goal_type: 'trend',
      half_life_days: 120,
      id: ID,
      measure: 'e1rm',
      min: 100,
      pattern: 'strength_training',
      source_type: 'activity_type',
    }
    await insertGoal(user, measureTrend)

    expect(await getGoals(user)).toEqual([measureTrend])

    const emaTrend: Goal = {
      aggregation: 'count',
      display_period: 'weekly',
      goal_type: 'trend',
      half_life_days: 15,
      id: ID,
      max: 3,
      pattern: 'coffee',
      source_type: 'activity_type',
    }
    await insertGoal(user, emaTrend)

    expect(await getGoals(user)).toEqual([emaTrend])
  })

  test('a sum measure goal without a filter round-trips', async () => {
    const user = getTestUser()
    const goal: Goal = {
      activity_type: 'strength_training',
      aggregation: 'sum',
      goal_type: 'measure',
      id: ID,
      max: 50000,
      measure: 'volume',
      window: '1w',
    }
    await insertGoal(user, goal)

    expect(await getGoals(user)).toEqual([goal])
  })
})
