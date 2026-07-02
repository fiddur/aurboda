import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  deleteActivity,
  getActivities,
  getActivityById,
  getActivitiesNeedingDetail,
  getNonSleepActivitiesMerged,
  getOverlappingActivities,
  getOverrideForActivity,
  getSleepSessions,
  insertActivities,
  insertActivity,
  insertOverride,
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

  describe('insertActivities batch dedupe', () => {
    test('dedupes duplicate (source, external_id) within a single batch (last write wins)', async () => {
      const user = getTestUser()

      await insertActivities(user, [
        {
          activity_type: 'exercise',
          data: { calories: 100 },
          end_time: new Date('2026-05-05T10:30:00Z'),
          external_id: 'hc-dup-1',
          source: 'health_connect',
          start_time: new Date('2026-05-05T10:00:00Z'),
          title: 'First',
        },
        {
          activity_type: 'exercise',
          data: { calories: 200 },
          end_time: new Date('2026-05-05T10:45:00Z'),
          external_id: 'hc-dup-1',
          source: 'health_connect',
          start_time: new Date('2026-05-05T10:00:00Z'),
          title: 'Second',
        },
      ])

      const activities = await getActivities(
        user,
        'exercise',
        new Date('2026-05-05T00:00:00Z'),
        new Date('2026-05-05T23:59:59Z'),
      )
      expect(activities).toHaveLength(1)
      expect(activities[0].title).toBe('Second')
      expect(activities[0].data).toEqual({ calories: 200 })
    })

    test('dedupes duplicate (source, type, start_time) without external_id', async () => {
      const user = getTestUser()

      await insertActivities(user, [
        {
          activity_type: 'sleep',
          end_time: new Date('2026-05-06T07:00:00Z'),
          source: 'health_connect',
          start_time: new Date('2026-05-05T23:00:00Z'),
          title: 'A',
        },
        {
          activity_type: 'sleep',
          end_time: new Date('2026-05-06T07:30:00Z'),
          source: 'health_connect',
          start_time: new Date('2026-05-05T23:00:00Z'),
          title: 'B',
        },
      ])

      const activities = await getActivities(
        user,
        'sleep',
        new Date('2026-05-05T00:00:00Z'),
        new Date('2026-05-06T23:59:59Z'),
      )
      expect(activities).toHaveLength(1)
      expect(activities[0].title).toBe('B')
      expect(activities[0].end_time).toEqual(new Date('2026-05-06T07:30:00Z'))
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

    test('updates activity title', async () => {
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
        title: 'Morning workout',
      })

      expect(updated).not.toBeNull()
      expect(updated?.title).toBe('Morning workout')
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
        title: 'Morning Run',
      })

      expect(updated).not.toBeNull()
      expect(updated?.title).toBe('Morning Run')
      expect(updated?.data).toEqual({ exerciseType: 56, exerciseTypeName: 'running' })
    })
  })

  describe('insertOverride / getOverrideForActivity (issue #715)', () => {
    test('insertOverride creates an aurboda row pointing at the synced activity', async () => {
      const user = getTestUser()
      const garminId = randomUUID()

      await insertActivity(user, {
        activity_type: 'meditation',
        end_time: new Date('2026-05-05T10:30:00Z'),
        external_id: 'garmin-12345',
        id: garminId,
        source: 'garmin',
        start_time: new Date('2026-05-05T10:00:00Z'),
        title: 'Meditation',
      })

      const override = await insertOverride(user, [garminId], {
        activity_type: 'walking',
        end_time: new Date('2026-05-05T10:30:00Z'),
        start_time: new Date('2026-05-05T10:00:00Z'),
        title: 'Pipe ceremony',
      })

      expect(override).not.toBeNull()
      expect(override?.source).toBe('aurboda')
      expect(override?.override_target_ids).toEqual([garminId])
      expect(override?.activity_type).toBe('walking')

      const looked = await getOverrideForActivity(user, garminId)
      expect(looked?.id).toBe(override?.id)
    })

    test('garmin re-sync upsert does not touch the override', async () => {
      const user = getTestUser()
      const garminId = randomUUID()

      // Initial garmin row
      await insertActivity(user, {
        activity_type: 'meditation',
        end_time: new Date('2026-05-05T10:30:00Z'),
        external_id: 'garmin-12345',
        id: garminId,
        source: 'garmin',
        start_time: new Date('2026-05-05T10:00:00Z'),
        title: 'Meditation',
      })

      // User overrides type
      const override = await insertOverride(user, [garminId], {
        activity_type: 'walking',
        end_time: new Date('2026-05-05T10:30:00Z'),
        start_time: new Date('2026-05-05T10:00:00Z'),
        title: 'Pipe ceremony',
      })

      // Re-sync from garmin (upsert by external_id) — overwrites garmin row only
      await insertActivity(user, {
        activity_type: 'meditation',
        data: { duration_secs: 1800 },
        end_time: new Date('2026-05-05T10:30:00Z'),
        external_id: 'garmin-12345',
        id: garminId,
        source: 'garmin',
        start_time: new Date('2026-05-05T10:00:00Z'),
        title: 'Meditation',
      })

      // Override row is unchanged
      const stillOverride = await getOverrideForActivity(user, garminId)
      expect(stillOverride?.id).toBe(override?.id)
      expect(stillOverride?.activity_type).toBe('walking')
    })

    test('cascade: deleting target hard-deletes the override', async () => {
      const user = getTestUser()
      const garminId = randomUUID()

      await insertActivity(user, {
        activity_type: 'meditation',
        end_time: new Date('2026-05-05T10:30:00Z'),
        external_id: 'garmin-12345',
        id: garminId,
        source: 'garmin',
        start_time: new Date('2026-05-05T10:00:00Z'),
      })

      const override = await insertOverride(user, [garminId], {
        activity_type: 'walking',
        end_time: new Date('2026-05-05T10:30:00Z'),
        start_time: new Date('2026-05-05T10:00:00Z'),
      })

      // Hard-delete the synced row to trigger cascade
      const { query } = await import('./connection.ts')
      await query(user, `DELETE FROM activities WHERE id = $1`, [garminId])

      const survivor = await getActivityById(user, override!.id!, true)
      expect(survivor).toBeNull()
    })

    test('multi-target cascade: deleting one of two targets keeps the override with the remaining target', async () => {
      const user = getTestUser()
      const garminId = randomUUID()
      const stravaId = randomUUID()

      await insertActivity(user, {
        activity_type: 'running',
        end_time: new Date('2026-05-05T10:30:00Z'),
        external_id: 'garmin-12345',
        id: garminId,
        source: 'garmin',
        start_time: new Date('2026-05-05T10:00:00Z'),
      })
      await insertActivity(user, {
        activity_type: 'running',
        end_time: new Date('2026-05-05T10:30:00Z'),
        external_id: 'strava-12345',
        id: stravaId,
        source: 'strava',
        start_time: new Date('2026-05-05T10:00:00Z'),
      })

      const override = await insertOverride(user, [garminId, stravaId], {
        activity_type: 'walking',
        end_time: new Date('2026-05-05T10:30:00Z'),
        start_time: new Date('2026-05-05T10:00:00Z'),
      })

      // Drop one target → override survives with the other.
      const { query } = await import('./connection.ts')
      await query(user, `DELETE FROM activities WHERE id = $1`, [garminId])

      const survivor = await getActivityById(user, override!.id!, true)
      expect(survivor).not.toBeNull()
      expect(survivor?.override_target_ids).toEqual([stravaId])
    })

    test('reuses an existing aurboda row at the same (type, start_time) instead of inserting a duplicate', async () => {
      // Real-world case: a previous override edit created an aurboda row
      // targeting one synced source. The user re-edits via a different
      // synced source in the same merge group (e.g. strava instead of
      // garmin). insertOverride should attach the new target to the
      // existing aurboda row rather than 23505-ing on idx_activities_type_time.
      const user = getTestUser()
      const garminId = randomUUID()
      const stravaId = randomUUID()

      await insertActivity(user, {
        activity_type: 'meditation',
        end_time: new Date('2026-05-10T10:30:00Z'),
        external_id: 'garmin-reuse',
        id: garminId,
        source: 'garmin',
        start_time: new Date('2026-05-10T10:00:00Z'),
      })
      await insertActivity(user, {
        activity_type: 'meditation',
        end_time: new Date('2026-05-10T10:30:00Z'),
        external_id: 'strava-reuse',
        id: stravaId,
        source: 'strava',
        start_time: new Date('2026-05-10T10:00:00Z'),
      })

      const first = await insertOverride(user, [garminId], {
        activity_type: 'walking',
        end_time: new Date('2026-05-10T10:30:00Z'),
        start_time: new Date('2026-05-10T10:00:00Z'),
        title: 'first title',
      })

      const second = await insertOverride(user, [stravaId], {
        activity_type: 'walking',
        end_time: new Date('2026-05-10T10:25:00Z'),
        start_time: new Date('2026-05-10T10:00:00Z'),
        title: 'second title',
      })

      // Same row reused.
      expect(second?.id).toBe(first?.id)
      // Fields updated to the latest input.
      expect(second?.title).toBe('second title')
      expect(second?.end_time).toEqual(new Date('2026-05-10T10:25:00Z'))
      // Both target ids now linked.
      expect(second?.override_target_ids?.sort()).toEqual([garminId, stravaId].sort())
    })

    test('reuses a soft-deleted aurboda row at the same (type, start_time) by reviving it', async () => {
      // Real-world case: user edits → override created. User clicks "revert
      // to source" → override soft-deleted (deleted_at set). User edits
      // again to the same type → must NOT 23505 on idx_activities_type_time
      // (which doesn't filter on deleted_at). Revive the existing row.
      const user = getTestUser()
      const garminId = randomUUID()

      await insertActivity(user, {
        activity_type: 'meditation',
        end_time: new Date('2026-05-11T10:30:00Z'),
        external_id: 'garmin-revive',
        id: garminId,
        source: 'garmin',
        start_time: new Date('2026-05-11T10:00:00Z'),
      })

      const first = await insertOverride(user, [garminId], {
        activity_type: 'walking',
        end_time: new Date('2026-05-11T10:30:00Z'),
        start_time: new Date('2026-05-11T10:00:00Z'),
        title: 'before revert',
      })

      // Soft-delete the override (mimics the "revert to source" flow).
      const { query } = await import('./connection.ts')
      await query(user, `UPDATE activities SET deleted_at = NOW() WHERE id = $1`, [first!.id])

      // New edit at the same (type, start_time) — must succeed by reviving.
      const second = await insertOverride(user, [garminId], {
        activity_type: 'walking',
        end_time: new Date('2026-05-11T10:25:00Z'),
        start_time: new Date('2026-05-11T10:00:00Z'),
        title: 'after revive',
      })

      expect(second?.id).toBe(first?.id)
      expect(second?.title).toBe('after revive')
      expect(second?.deleted_at).toBeUndefined()
    })

    test('multi-target cascade: deleting the last target removes the override (delete_orphan_override trigger)', async () => {
      const user = getTestUser()
      const garminId = randomUUID()
      const stravaId = randomUUID()

      await insertActivity(user, {
        activity_type: 'running',
        end_time: new Date('2026-05-05T10:30:00Z'),
        external_id: 'garmin-67890',
        id: garminId,
        source: 'garmin',
        start_time: new Date('2026-05-05T10:00:00Z'),
      })
      await insertActivity(user, {
        activity_type: 'running',
        end_time: new Date('2026-05-05T10:30:00Z'),
        external_id: 'strava-67890',
        id: stravaId,
        source: 'strava',
        start_time: new Date('2026-05-05T10:00:00Z'),
      })

      const override = await insertOverride(user, [garminId, stravaId], {
        activity_type: 'walking',
        end_time: new Date('2026-05-05T10:30:00Z'),
        start_time: new Date('2026-05-05T10:00:00Z'),
      })

      const { query } = await import('./connection.ts')
      await query(user, `DELETE FROM activities WHERE id = $1`, [garminId])
      await query(user, `DELETE FROM activities WHERE id = $1`, [stravaId])

      const survivor = await getActivityById(user, override!.id!, true)
      expect(survivor).toBeNull()
    })
  })

  describe('getNonSleepActivitiesMerged', () => {
    const dayStart = new Date('2026-05-05T00:00:00Z')
    const dayEnd = new Date('2026-05-05T23:59:59Z')

    test('excludes activity types flagged show_on_timeline = false', async () => {
      const user = getTestUser()

      // show_on_timeline = true (built-in default)
      await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2026-05-05T11:00:00Z'),
        source: 'health_connect',
        start_time: new Date('2026-05-05T10:00:00Z'),
        title: 'Morning run',
      })

      // show_on_timeline = false — seeded that way for these built-in types
      await insertActivity(user, {
        activity_type: 'music_scrobble',
        data: { artist: 'Aphex Twin', track: 'Avril 14th' },
        source: 'lastfm',
        start_time: new Date('2026-05-05T12:00:00Z'),
      })
      await insertActivity(user, {
        activity_type: 'screentime',
        data: { category_path: 'Work>IDE' },
        end_time: new Date('2026-05-05T13:30:00Z'),
        source: 'rescuetime',
        start_time: new Date('2026-05-05T13:00:00Z'),
      })

      const result = await getNonSleepActivitiesMerged(user, dayStart, dayEnd)

      expect(result.map((a) => a.activity_type)).toEqual(['exercise'])
    })

    test('still excludes sleep_rest types', async () => {
      const user = getTestUser()

      await insertActivity(user, {
        activity_type: 'sleep',
        end_time: new Date('2026-05-05T07:00:00Z'),
        source: 'oura',
        start_time: new Date('2026-05-05T01:00:00Z'),
      })
      await insertActivity(user, {
        activity_type: 'exercise',
        end_time: new Date('2026-05-05T11:00:00Z'),
        source: 'health_connect',
        start_time: new Date('2026-05-05T10:00:00Z'),
      })

      const result = await getNonSleepActivitiesMerged(user, dayStart, dayEnd)

      expect(result.map((a) => a.activity_type)).toEqual(['exercise'])
    })
  })
})
