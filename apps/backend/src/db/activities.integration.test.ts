import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  deleteActivity,
  getActivities,
  getActivityById,
  getActivitiesNeedingDetail,
  getOverlappingActivities,
  getSleepSessions,
  insertActivity,
  markActivityDetailSynced,
  updateActivity,
} from './activities/index.ts'

// Increase timeout for container startup
const CONTAINER_TIMEOUT = 120_000

describe('Activities Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('insertActivity', () => {
    test('inserts activity with all fields', async () => {
      const user = getTestUser()

      await insertActivity(user, {
        activity_type: 'exercise',
        data: { calories: 300 },
        end_time: new Date('2024-01-15T11:00:00Z'),
        notes: 'Morning run',
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Running',
      })

      const activities = await getActivities(
        user,
        'exercise',
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(activities).toHaveLength(1)
      expect(activities[0].activity_type).toBe('exercise')
      expect(activities[0].title).toBe('Running')
      expect(activities[0].data).toEqual({ calories: 300 })
    })

    test('upserts on conflict (same source + type + start_time)', async () => {
      const user = getTestUser()

      await insertActivity(user, {
        activity_type: 'sleep',
        source: 'oura',
        start_time: new Date('2024-01-15T23:00:00Z'),
        title: 'Sleep v1',
      })

      await insertActivity(user, {
        activity_type: 'sleep',
        end_time: new Date('2024-01-16T07:00:00Z'),
        source: 'oura',
        start_time: new Date('2024-01-15T23:00:00Z'),
        title: 'Sleep v2',
      })

      const activities = await getActivities(
        user,
        'sleep',
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(activities).toHaveLength(1)
      expect(activities[0].title).toBe('Sleep v2')
      expect(activities[0].end_time).toEqual(new Date('2024-01-16T07:00:00Z'))
    })

    test('merges data on upsert, preserving existing keys like detail_synced', async () => {
      const user = getTestUser()

      // First insert: Garmin activity with some data
      const activityId = await insertActivity(user, {
        activity_type: 'exercise',
        data: { garmin_activity_id: 123, calories: 200 },
        source: 'garmin',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Run',
      })

      // Mark detail as synced (simulates what happens after fetching per-second metrics)
      await markActivityDetailSynced(user, activityId)

      // Re-sync: upsert same activity with updated data (without detail_synced)
      await insertActivity(user, {
        activity_type: 'exercise',
        data: { garmin_activity_id: 123, calories: 250 },
        source: 'garmin',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Run',
      })

      const activities = await getActivities(
        user,
        'exercise',
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(activities).toHaveLength(1)
      expect(activities[0].data).toEqual({
        calories: 250,
        detail_synced: true,
        garmin_activity_id: 123,
      })

      // Should NOT need detail re-sync
      const needingDetail = await getActivitiesNeedingDetail(user)
      expect(needingDetail).toHaveLength(0)
    })
  })

  describe('getSleepSessions', () => {
    test('returns overnight sleep session on wake-up day', async () => {
      const user = getTestUser()

      // Sleep starting at 23:00 on Jan 14, ending at 07:00 on Jan 15
      await insertActivity(user, {
        activity_type: 'sleep',
        data: { score: 85 },
        end_time: new Date('2024-01-15T07:00:00Z'),
        source: 'oura',
        start_time: new Date('2024-01-14T23:00:00Z'),
      })

      // Query for Jan 15's sleep - should find the overnight session
      const sessions = await getSleepSessions(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(sessions).toHaveLength(1)
      expect(sessions[0].start_time).toEqual(new Date('2024-01-14T23:00:00Z'))
      expect(sessions[0].end_time).toEqual(new Date('2024-01-15T07:00:00Z'))
    })

    test('returns sleep session that starts and ends on same day', async () => {
      const user = getTestUser()

      // A nap on Jan 15
      await insertActivity(user, {
        activity_type: 'sleep',
        end_time: new Date('2024-01-15T15:30:00Z'),
        source: 'health_connect',
        start_time: new Date('2024-01-15T14:00:00Z'),
      })

      const sessions = await getSleepSessions(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(sessions).toHaveLength(1)
      expect(sessions[0].start_time).toEqual(new Date('2024-01-15T14:00:00Z'))
    })

    test('returns ongoing sleep session with no end_time', async () => {
      const user = getTestUser()

      // Sleep that started but hasn't ended yet
      await insertActivity(user, {
        activity_type: 'sleep',
        source: 'oura',
        start_time: new Date('2024-01-14T23:00:00Z'),
      })

      const sessions = await getSleepSessions(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(sessions).toHaveLength(1)
      expect(sessions[0].end_time).toBeUndefined()
    })

    test('excludes sleep that ended before query range', async () => {
      const user = getTestUser()

      // Sleep that ended before query range
      await insertActivity(user, {
        activity_type: 'sleep',
        end_time: new Date('2024-01-14T07:00:00Z'),
        source: 'oura',
        start_time: new Date('2024-01-13T23:00:00Z'),
      })

      const sessions = await getSleepSessions(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(sessions).toHaveLength(0)
    })

    test('excludes sleep that starts after query range', async () => {
      const user = getTestUser()

      // Sleep that starts after query range
      await insertActivity(user, {
        activity_type: 'sleep',
        end_time: new Date('2024-01-17T07:00:00Z'),
        source: 'oura',
        start_time: new Date('2024-01-16T23:00:00Z'),
      })

      const sessions = await getSleepSessions(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(sessions).toHaveLength(0)
    })

    test('returns empty array when no sleep sessions', async () => {
      const user = getTestUser()

      const sessions = await getSleepSessions(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(sessions).toEqual([])
    })

    test('only returns sleep activities, not other types', async () => {
      const user = getTestUser()

      await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T11:00:00Z'),
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
      })

      await insertActivity(user, {
        activity_type: 'sleep',
        end_time: new Date('2024-01-15T07:00:00Z'),
        source: 'oura',
        start_time: new Date('2024-01-14T23:00:00Z'),
      })

      const sessions = await getSleepSessions(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(sessions).toHaveLength(1)
      expect(sessions[0].activity_type).toBe('sleep')
    })
  })

  describe('getActivityById', () => {
    test('retrieves activity by ID', async () => {
      const user = getTestUser()
      const activityId = randomUUID()

      await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: activityId,
        source: 'aurboda',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Morning run',
      })

      const activity = await getActivityById(user, activityId)

      expect(activity).not.toBeNull()
      expect(activity?.id).toBe(activityId)
      expect(activity?.activity_type).toBe('exercise')
      expect(activity?.title).toBe('Morning run')
    })

    test('returns null for non-existent activity', async () => {
      const user = getTestUser()
      const nonExistentId = randomUUID()

      const activity = await getActivityById(user, nonExistentId)

      expect(activity).toBeNull()
    })
  })

  describe('deleteActivity', () => {
    test('deletes activity and returns true when found', async () => {
      const user = getTestUser()
      const activityId = randomUUID()

      await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: activityId,
        source: 'aurboda',
        start_time: new Date('2024-01-15T10:00:00Z'),
      })

      const result = await deleteActivity(user, activityId)
      expect(result).toBe(true)

      const activity = await getActivityById(user, activityId)
      expect(activity).toBeNull()
    })

    test('returns false when activity not found', async () => {
      const user = getTestUser()
      const nonExistentId = randomUUID()

      const result = await deleteActivity(user, nonExistentId)
      expect(result).toBe(false)
    })
  })

  describe('getOverlappingActivities', () => {
    test('returns overlapping activities of the same type', async () => {
      const user = getTestUser()
      const id1 = randomUUID()
      const id2 = randomUUID()

      // Two overlapping exercises from different sources
      await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: id1,
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'From Gravl',
      })

      await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T10:45:00Z'),
        id: id2,
        source: 'garmin',
        start_time: new Date('2024-01-15T10:05:00Z'),
        title: 'From Fitbit',
      })

      const activity = await getActivityById(user, id1)
      expect(activity).not.toBeNull()

      const overlapping = await getOverlappingActivities(user, activity!)
      expect(overlapping).toHaveLength(2)
      expect(overlapping.map((a) => a.id).sort()).toEqual([id1, id2].sort())
    })

    test('does not return non-overlapping activities', async () => {
      const user = getTestUser()
      const id1 = randomUUID()
      const id2 = randomUUID()

      await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: id1,
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
      })

      await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T15:00:00Z'),
        id: id2,
        source: 'garmin',
        start_time: new Date('2024-01-15T14:00:00Z'),
      })

      const activity = await getActivityById(user, id1)
      const overlapping = await getOverlappingActivities(user, activity!)
      expect(overlapping).toHaveLength(1)
      expect(overlapping[0]!.id).toBe(id1)
    })

    test('does not return activities of a different type', async () => {
      const user = getTestUser()
      const id1 = randomUUID()
      const id2 = randomUUID()

      await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: id1,
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
      })

      await insertActivity(user, {
        activity_type: 'sleep',
        end_time: new Date('2024-01-15T10:30:00Z'),
        id: id2,
        source: 'oura',
        start_time: new Date('2024-01-15T10:00:00Z'),
      })

      const activity = await getActivityById(user, id1)
      const overlapping = await getOverlappingActivities(user, activity!)
      expect(overlapping).toHaveLength(1)
      expect(overlapping[0]!.id).toBe(id1)
    })

    test('excludes deleted activities', async () => {
      const user = getTestUser()
      const id1 = randomUUID()
      const id2 = randomUUID()

      await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: id1,
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
      })

      await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T10:45:00Z'),
        id: id2,
        source: 'garmin',
        start_time: new Date('2024-01-15T10:05:00Z'),
      })

      await deleteActivity(user, id2)

      const activity = await getActivityById(user, id1)
      const overlapping = await getOverlappingActivities(user, activity!)
      expect(overlapping).toHaveLength(1)
      expect(overlapping[0]!.id).toBe(id1)
    })

    test('finds transitively connected activities', async () => {
      const user = getTestUser()
      const idA = randomUUID()
      const idB = randomUUID()
      const idC = randomUUID()

      // A: 10:00-10:30, B: 10:20-11:00, C: 10:50-11:30
      // A overlaps B, B overlaps C, but A does NOT directly overlap C
      await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T10:30:00Z'),
        id: idA,
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Part A',
      })

      await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: idB,
        source: 'garmin',
        start_time: new Date('2024-01-15T10:20:00Z'),
        title: 'Part B',
      })

      await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T11:30:00Z'),
        id: idC,
        source: 'aurboda',
        start_time: new Date('2024-01-15T10:50:00Z'),
        title: 'Part C',
      })

      const activity = await getActivityById(user, idA)
      expect(activity).not.toBeNull()

      const overlapping = await getOverlappingActivities(user, activity!)
      expect(overlapping).toHaveLength(3)
      expect(overlapping.map((a) => a.id).sort()).toEqual([idA, idB, idC].sort())
    })
  })

  describe('updateActivity', () => {
    test('updates activity times', async () => {
      const user = getTestUser()
      const activityId = randomUUID()

      await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: activityId,
        source: 'aurboda',
        start_time: new Date('2024-01-15T10:00:00Z'),
      })

      const updated = await updateActivity(user, activityId, {
        end_time: new Date('2024-01-15T12:00:00Z'),
        start_time: new Date('2024-01-15T09:00:00Z'),
      })

      expect(updated).not.toBeNull()
      expect(updated?.start_time).toEqual(new Date('2024-01-15T09:00:00Z'))
      expect(updated?.end_time).toEqual(new Date('2024-01-15T12:00:00Z'))
    })

    test('updates activity title and notes', async () => {
      const user = getTestUser()
      const activityId = randomUUID()

      await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: activityId,
        source: 'aurboda',
        start_time: new Date('2024-01-15T10:00:00Z'),
      })

      const updated = await updateActivity(user, activityId, {
        notes: 'Felt great!',
        title: 'Morning workout',
      })

      expect(updated).not.toBeNull()
      expect(updated?.title).toBe('Morning workout')
      expect(updated?.notes).toBe('Felt great!')
    })

    test('returns null when activity not found', async () => {
      const user = getTestUser()
      const nonExistentId = randomUUID()

      const updated = await updateActivity(user, nonExistentId, {
        title: 'New title',
      })

      expect(updated).toBeNull()
    })

    test('returns existing activity when no updates provided', async () => {
      const user = getTestUser()
      const activityId = randomUUID()

      await insertActivity(user, {
        activity_type: 'meditation',
        end_time: new Date('2024-01-15T08:00:00Z'),
        id: activityId,
        source: 'aurboda',
        start_time: new Date('2024-01-15T07:30:00Z'),
        title: 'Morning meditation',
      })

      const updated = await updateActivity(user, activityId, {})

      expect(updated).not.toBeNull()
      expect(updated?.title).toBe('Morning meditation')
    })

    test('updates data field on activity', async () => {
      const user = getTestUser()
      const activityId = randomUUID()

      await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: activityId,
        source: 'aurboda',
        start_time: new Date('2024-01-15T10:00:00Z'),
      })

      const updated = await updateActivity(user, activityId, {
        data: { exerciseType: 81, exerciseTypeName: 'weightlifting' },
      })

      expect(updated).not.toBeNull()
      expect(updated?.data).toEqual({ exerciseType: 81, exerciseTypeName: 'weightlifting' })
    })

    test('replaces entire data field (no partial merge at db level)', async () => {
      const user = getTestUser()
      const activityId = randomUUID()

      await insertActivity(user, {
        activity_type: 'exercise',
        data: { calories: 300, exerciseType: 70, exerciseTypeName: 'strength_training' },
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: activityId,
        source: 'aurboda',
        start_time: new Date('2024-01-15T10:00:00Z'),
      })

      // DB layer replaces data entirely; merging is done in the service layer
      const updated = await updateActivity(user, activityId, {
        data: { exerciseType: 81, exerciseTypeName: 'weightlifting' },
      })

      expect(updated).not.toBeNull()
      expect(updated?.data).toEqual({ exerciseType: 81, exerciseTypeName: 'weightlifting' })
    })

    test('preserves data when updating other fields', async () => {
      const user = getTestUser()
      const activityId = randomUUID()

      await insertActivity(user, {
        activity_type: 'exercise',
        data: { exerciseType: 81, exerciseTypeName: 'weightlifting' },
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: activityId,
        source: 'aurboda',
        start_time: new Date('2024-01-15T10:00:00Z'),
      })

      const updated = await updateActivity(user, activityId, {
        title: 'Heavy lifting session',
      })

      expect(updated).not.toBeNull()
      expect(updated?.title).toBe('Heavy lifting session')
      expect(updated?.data).toEqual({ exerciseType: 81, exerciseTypeName: 'weightlifting' })
    })

    test('updates data and other fields together', async () => {
      const user = getTestUser()
      const activityId = randomUUID()

      await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: activityId,
        source: 'aurboda',
        start_time: new Date('2024-01-15T10:00:00Z'),
      })

      const updated = await updateActivity(user, activityId, {
        data: { exerciseType: 56, exerciseTypeName: 'running' },
        notes: 'Morning run in the park',
        title: 'Morning Run',
      })

      expect(updated).not.toBeNull()
      expect(updated?.title).toBe('Morning Run')
      expect(updated?.notes).toBe('Morning run in the park')
      expect(updated?.data).toEqual({ exerciseType: 56, exerciseTypeName: 'running' })
    })
  })
})
