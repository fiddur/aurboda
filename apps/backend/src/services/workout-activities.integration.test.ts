import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { insertActivities, insertActivity, insertOverride } from '../db/activities/index.ts'
import { insertActivityTypeDefinition } from '../db/activity-type-definitions.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getEarliestWorkoutStart, getWorkoutActivities } from './workout-activities.ts'

const CONTAINER_TIMEOUT = 120_000

const at = (day: number, hour: number, minute = 0) => new Date(Date.UTC(2026, 10, day, hour, minute))
const RANGE = [at(1, 0), at(30, 0)] as const

describe('workout activities (integration)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('typed sessions count as workouts, not only the generic exercise (#1822)', async () => {
    const user = getTestUser()
    await insertActivityTypeDefinition(user, {
      display_category: 'exercise',
      display_name: 'Yard Work',
      name: 'yard_work',
    })
    await insertActivityTypeDefinition(user, {
      display_category: 'other',
      display_name: 'Trail Run',
      name: 'trail_run',
      parent_type: 'running',
    })
    await insertActivities(user, [
      { activity_type: 'exercise', end_time: at(2, 11), source: 'garmin', start_time: at(2, 10) },
      { activity_type: 'running', end_time: at(3, 11), source: 'garmin', start_time: at(3, 10) },
      { activity_type: 'yoga', end_time: at(4, 11), source: 'aurboda', start_time: at(4, 10) },
      { activity_type: 'strength_training', end_time: at(5, 11), source: 'gravl', start_time: at(5, 10) },
      { activity_type: 'yard_work', end_time: at(6, 11), source: 'aurboda', start_time: at(6, 10) },
      { activity_type: 'trail_run', end_time: at(7, 11), source: 'aurboda', start_time: at(7, 10) },
      { activity_type: 'meditation', end_time: at(8, 11), source: 'aurboda', start_time: at(8, 10) },
      { activity_type: 'sleep', end_time: at(9, 6), source: 'garmin', start_time: at(8, 22) },
    ])

    const workouts = await getWorkoutActivities(user, ...RANGE)

    expect(workouts.map((w) => w.activity_type)).toEqual([
      'exercise',
      'running',
      'yoga',
      'strength_training',
      'yard_work',
      'trail_run',
    ])
  })

  test('the same workout from two sources counts once', async () => {
    const user = getTestUser()
    await insertActivities(user, [
      { activity_type: 'strength_training', end_time: at(5, 11), source: 'garmin', start_time: at(5, 10) },
      {
        activity_type: 'strength_training',
        end_time: at(5, 11),
        source: 'gravl',
        start_time: at(5, 10, 1),
      },
    ])

    expect(await getWorkoutActivities(user, ...RANGE)).toHaveLength(1)
  })

  test('the earliest workout start skips sessions that are not workouts', async () => {
    const user = getTestUser()
    expect(await getEarliestWorkoutStart(user)).toBeUndefined()

    await insertActivities(user, [
      { activity_type: 'meditation', end_time: at(1, 11), source: 'aurboda', start_time: at(1, 10) },
      { activity_type: 'yoga', end_time: at(4, 11), source: 'aurboda', start_time: at(4, 10) },
      { activity_type: 'running', end_time: at(6, 11), source: 'garmin', start_time: at(6, 10) },
    ])

    expect(await getEarliestWorkoutStart(user)).toEqual(at(4, 10))
  })

  test('a synced workout retyped to a non-workout type does not count (#1830)', async () => {
    const user = getTestUser()
    await insertActivityTypeDefinition(user, {
      display_category: 'other',
      display_name: 'Pipe Ceremony',
      name: 'pipe_ceremony',
    })
    const garminId = await insertActivity(user, {
      activity_type: 'other_workout',
      end_time: at(2, 11),
      source: 'garmin',
      start_time: at(2, 10),
    })
    await insertOverride(user, [garminId], {
      activity_type: 'pipe_ceremony',
      end_time: at(2, 11),
      start_time: at(2, 10),
    })

    expect(await getWorkoutActivities(user, ...RANGE)).toEqual([])
  })

  test('a session retyped into a workout type counts once, under the new type (#1830)', async () => {
    const user = getTestUser()
    const garminId = await insertActivity(user, {
      activity_type: 'meditation',
      end_time: at(2, 11),
      source: 'garmin',
      start_time: at(2, 10),
    })
    const override = await insertOverride(user, [garminId], {
      activity_type: 'yoga',
      end_time: at(2, 11),
      start_time: at(2, 10),
    })

    const workouts = await getWorkoutActivities(user, ...RANGE)
    expect(workouts.map((w) => [w.id, w.activity_type])).toEqual([[override!.id, 'yoga']])
  })

  test('a meditation logged by hand over a synced workout wins (#1830)', async () => {
    const user = getTestUser()
    await insertActivities(user, [
      { activity_type: 'other_workout', end_time: at(2, 11), source: 'garmin', start_time: at(2, 10) },
      {
        activity_type: 'meditation',
        end_time: at(2, 11),
        source: 'manual',
        start_time: new Date(at(2, 10).getTime() + 30_000),
      },
    ])

    expect(await getWorkoutActivities(user, ...RANGE)).toEqual([])
  })

  test('a generic exercise inside a meditation is absorbed (#1830)', async () => {
    const user = getTestUser()
    await insertActivities(user, [
      { activity_type: 'exercise', end_time: at(2, 10, 30), source: 'health_connect', start_time: at(2, 10) },
      { activity_type: 'meditation', end_time: at(2, 10, 40), source: 'oura', start_time: at(2, 10, 5) },
    ])

    expect(await getWorkoutActivities(user, ...RANGE)).toEqual([])
  })
})
