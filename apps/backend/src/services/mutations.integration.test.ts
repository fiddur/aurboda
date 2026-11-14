import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import {
  fetchCategoryMap,
  getActivities,
  getActivityById,
  getOverrideForActivity,
  insertActivity,
} from '../db/activities/index.ts'
import { getActivityTypeDefinition } from '../db/activity-type-definitions.ts'
import { query } from '../db/connection.ts'
import { getPendingOutboundSync } from '../db/outbound-sync.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { addActivity, deleteActivity, updateActivity } from './mutations.ts'

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

  test('a live session enqueues nothing for Health Connect until it is finished, then one update', async () => {
    const user = getTestUser()
    const start = new Date('2026-11-10T17:02:00Z')
    const added = await addActivity(user, {
      activity_type: 'strength_training',
      data: { in_progress: true, last_set_at: '2026-11-10T17:05:00Z', sets: sets.slice(0, 1) },
      start_time: start,
    })
    expect(added.success).toBe(true)
    expect((await getPendingOutboundSync(user)).entries).toEqual([])

    const changed = await updateActivity(user, added.id!, {
      data: { last_set_at: '2026-11-10T17:08:00Z', sets },
    })
    expect(changed.success).toBe(true)
    expect((await getPendingOutboundSync(user)).entries).toEqual([])

    const finished = await updateActivity(user, added.id!, {
      data: { in_progress: false },
      end_time: new Date('2026-11-10T18:00:00Z'),
    })
    expect(finished.success).toBe(true)
    const { entries } = await getPendingOutboundSync(user)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ entity_id: added.id, operation: 'update' })
    const stored = await getActivityById(user, added.id!)
    expect(stored?.data).toMatchObject({ in_progress: false, last_set_at: '2026-11-10T17:08:00Z', sets })
  })

  test('adding at the start time of an existing manual activity answers with the stored id', async () => {
    const user = getTestUser()
    const session = {
      activity_type: 'strength_training',
      end_time: new Date('2026-11-11T18:00:00Z'),
      start_time: new Date('2026-11-11T17:00:00Z'),
    }
    const first = await addActivity(user, { ...session, data: { sets: sets.slice(0, 1) } })

    const second = await addActivity(user, { ...session, data: { sets } })

    expect(second).toMatchObject({ id: first.id, success: true })
    expect((await getActivityById(user, first.id!))?.data?.sets).toEqual(sets)
  })

  test('adding at the start time of a deleted manual activity fails instead of answering with an id', async () => {
    const user = getTestUser()
    const session = {
      activity_type: 'strength_training',
      data: { sets },
      end_time: new Date('2026-11-11T18:00:00Z'),
      start_time: new Date('2026-11-11T17:00:00Z'),
    }
    const first = await addActivity(user, session)
    await deleteActivity(user, first.id!)

    const second = await addActivity(user, session)

    expect(second.success).toBe(false)
    expect(second.error).toContain('deleted activity')
    expect(second.id).toBeUndefined()
  })

  describe('a built-in catalogue type not used yet', () => {
    beforeEach(async () => {
      await query(getTestUser(), `DELETE FROM activity_type_definitions WHERE is_builtin = false`)
    })

    test('adding an activity of it adopts the type', async () => {
      const user = getTestUser()
      const added = await addActivity(user, {
        activity_type: 'headache',
        data: { severity: 4 },
        start_time: new Date('2026-11-12T08:00:00Z'),
      })
      expect(added.success).toBe(true)
      expect((await getActivityTypeDefinition(user, 'headache'))?.parent_type).toBe('symptom')
      expect((await getActivityById(user, added.id!))?.data).toMatchObject({ severity: 4 })
    })

    test('its data is validated against the adopted fields', async () => {
      const added = await addActivity(getTestUser(), {
        activity_type: 'headache',
        data: { severity: 11 },
        start_time: new Date('2026-11-12T09:00:00Z'),
      })
      expect(added.success).toBe(false)
      expect(added.error).toContain('Field "severity" value 11 is above the maximum 10')
    })

    test("changing an activity's type to it adopts the type", async () => {
      const user = getTestUser()
      const added = await addActivity(user, {
        activity_type: 'meditation',
        start_time: new Date('2026-11-12T10:00:00Z'),
      })
      const changed = await updateActivity(user, added.id!, { activity_type: 'sauna' })
      expect(changed.success).toBe(true)
      expect((await getActivityTypeDefinition(user, 'sauna'))?.display_category).toBe('wellness')
      expect((await getActivityById(user, added.id!))?.activity_type).toBe('sauna')
    })

    test('a refused add leaves no new type', async () => {
      const user = getTestUser()
      const added = await addActivity(user, {
        activity_type: 'headache',
        data: { severity: 11 },
        start_time: new Date('2026-11-12T09:30:00Z'),
      })
      expect(added.success).toBe(false)
      expect(await getActivityTypeDefinition(user, 'headache')).toBeNull()
      expect(await getActivityTypeDefinition(user, 'symptom')).toBeNull()
    })

    test('a refused type change leaves no new type', async () => {
      const user = getTestUser()
      const base = await addActivity(user, {
        activity_type: 'meditation',
        start_time: new Date('2026-11-12T10:30:00Z'),
      })
      const changed = await updateActivity(user, base.id!, {
        activity_type: 'headache',
        data: { severity: 11 },
      })
      expect(changed.success).toBe(false)
      expect(changed.error).toContain('Field "severity" value 11 is above the maximum 10')
      expect(await getActivityTypeDefinition(user, 'headache')).toBeNull()
      expect((await getActivityById(user, base.id!))?.activity_type).toBe('meditation')
    })

    test('a name outside the catalogue is still refused', async () => {
      const user = getTestUser()
      const added = await addActivity(user, {
        activity_type: 'not_a_catalogue_type',
        start_time: new Date('2026-11-12T11:00:00Z'),
      })
      expect(added).toMatchObject({ error: 'Unknown activity type: "not_a_catalogue_type"', success: false })
      const base = await addActivity(user, {
        activity_type: 'meditation',
        start_time: new Date('2026-11-12T12:00:00Z'),
      })
      const changed = await updateActivity(user, base.id!, { activity_type: 'not_a_catalogue_type' })
      expect(changed).toMatchObject({
        error: 'Unknown activity type: "not_a_catalogue_type"',
        success: false,
      })
    })
  })
})
