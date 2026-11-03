import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import {
  fetchCategoryMap,
  getActivities,
  getActivityById,
  getOverrideForActivity,
  insertActivity,
} from '../db/activities/index.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { updateActivity } from './mutations.ts'

const CONTAINER_TIMEOUT = 120_000

const sets = [
  { exercise: 'Bench Press', order: 1, reps: 8, set_type: 'normal', weight: 60 },
  { exercise: 'Bench Press', order: 2, reps: 6, set_type: 'normal', weight: 70 },
]

describe('updateActivity on a merged view (integration)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('the override created by a notes-only edit carries every source’s data', async () => {
    const user = getTestUser()
    const garminId = await insertActivity(user, {
      activity_type: 'strength_training',
      data: { avg_hr: 110, calories: 300 },
      end_time: new Date('2026-10-27T17:50:00Z'),
      external_id: 'garmin-merged-edit',
      source: 'garmin',
      start_time: new Date('2026-10-27T17:00:00Z'),
      title: 'Styrka',
    })
    const gravlId = await insertActivity(user, {
      activity_type: 'strength_training',
      data: { set_count: sets.length, sets },
      end_time: new Date('2026-10-27T17:45:00Z'),
      external_id: 'gravl-workout-merged-edit',
      source: 'gravl',
      start_time: new Date('2026-10-27T16:58:00Z'),
      title: 'Hotel gym',
    })

    const result = await updateActivity(user, garminId!, {
      notes: 'Felt strong',
      override_target_ids: [garminId!, gravlId!],
    })

    expect(result.success).toBe(true)
    const override = await getOverrideForActivity(user, gravlId!)
    expect(override?.id).toBe(result.id)
    expect(override?.override_target_ids?.sort()).toEqual([garminId, gravlId].sort())
    expect(override?.data).toMatchObject({ avg_hr: 110, calories: 300, sets })
    expect(override?.title).toBe('Hotel gym')
    expect(override?.start_time).toEqual(new Date('2026-10-27T16:58:00Z'))
    expect(override?.end_time).toEqual(new Date('2026-10-27T17:50:00Z'))
    expect((await getActivityById(user, gravlId!))?.data?.sets).toEqual(sets)
  })

  test('the override starts from the row the merged view shows when Garmin starts first', async () => {
    const user = getTestUser()
    const garminId = await insertActivity(user, {
      activity_type: 'strength_training',
      data: { avg_hr: 110 },
      end_time: new Date('2026-10-28T08:00:00Z'),
      external_id: 'garmin-first-merged-edit',
      source: 'garmin',
      start_time: new Date('2026-10-28T07:00:00Z'),
      title: 'Styrka',
    })
    const gravlId = await insertActivity(user, {
      activity_type: 'strength_training',
      data: { set_count: sets.length, sets },
      end_time: new Date('2026-10-28T07:58:00Z'),
      external_id: 'gravl-workout-garmin-first',
      source: 'gravl',
      start_time: new Date('2026-10-28T07:01:00Z'),
      title: 'Hotel gym',
    })
    const windowStart = new Date('2026-10-28T06:00:00Z')
    const windowEnd = new Date('2026-10-28T09:00:00Z')
    const view = async () =>
      getActivities(
        user,
        'strength_training',
        windowStart,
        windowEnd,
        undefined,
        undefined,
        await fetchCategoryMap(user),
      )
    expect((await view()).map((row) => row.title)).toEqual(['Styrka'])

    const result = await updateActivity(user, garminId!, {
      notes: 'Felt strong',
      override_target_ids: [garminId!, gravlId!],
    })

    expect(result.success).toBe(true)
    const override = await getOverrideForActivity(user, gravlId!)
    expect(override?.id).toBe(result.id)
    expect(override?.title).toBe('Styrka')
    expect(override?.data).toMatchObject({ avg_hr: 110, sets })
    expect(override?.start_time).toEqual(new Date('2026-10-28T07:00:00Z'))
    expect(override?.end_time).toEqual(new Date('2026-10-28T08:00:00Z'))

    const after = await view()
    expect(after).toHaveLength(1)
    expect(after[0].title).toBe('Styrka')
    expect(after[0].data?.sets).toEqual(sets)
  })
})
