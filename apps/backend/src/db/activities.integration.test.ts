import { randomUUID } from 'crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper'
import {
  deleteActivity,
  getActivities,
  getActivityById,
  getSleepSessions,
  insertActivity,
  updateActivity,
} from './activities'

// Increase timeout for container startup
const CONTAINER_TIMEOUT = 60_000

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
        activityType: 'exercise',
        data: { calories: 300 },
        endTime: new Date('2024-01-15T11:00:00Z'),
        notes: 'Morning run',
        source: 'health_connect',
        startTime: new Date('2024-01-15T10:00:00Z'),
        title: 'Running',
      })

      const activities = await getActivities(
        user,
        'exercise',
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(activities).toHaveLength(1)
      expect(activities[0].activityType).toBe('exercise')
      expect(activities[0].title).toBe('Running')
      expect(activities[0].data).toEqual({ calories: 300 })
    })

    test('upserts on conflict (same source + type + start_time)', async () => {
      const user = getTestUser()

      await insertActivity(user, {
        activityType: 'sleep',
        source: 'oura',
        startTime: new Date('2024-01-15T23:00:00Z'),
        title: 'Sleep v1',
      })

      await insertActivity(user, {
        activityType: 'sleep',
        endTime: new Date('2024-01-16T07:00:00Z'),
        source: 'oura',
        startTime: new Date('2024-01-15T23:00:00Z'),
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
      expect(activities[0].endTime).toEqual(new Date('2024-01-16T07:00:00Z'))
    })
  })

  describe('getSleepSessions', () => {
    test('returns overnight sleep session on wake-up day', async () => {
      const user = getTestUser()

      // Sleep starting at 23:00 on Jan 14, ending at 07:00 on Jan 15
      await insertActivity(user, {
        activityType: 'sleep',
        data: { score: 85 },
        endTime: new Date('2024-01-15T07:00:00Z'),
        source: 'oura',
        startTime: new Date('2024-01-14T23:00:00Z'),
      })

      // Query for Jan 15's sleep - should find the overnight session
      const sessions = await getSleepSessions(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(sessions).toHaveLength(1)
      expect(sessions[0].startTime).toEqual(new Date('2024-01-14T23:00:00Z'))
      expect(sessions[0].endTime).toEqual(new Date('2024-01-15T07:00:00Z'))
    })

    test('returns sleep session that starts and ends on same day', async () => {
      const user = getTestUser()

      // A nap on Jan 15
      await insertActivity(user, {
        activityType: 'sleep',
        endTime: new Date('2024-01-15T15:30:00Z'),
        source: 'health_connect',
        startTime: new Date('2024-01-15T14:00:00Z'),
      })

      const sessions = await getSleepSessions(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(sessions).toHaveLength(1)
      expect(sessions[0].startTime).toEqual(new Date('2024-01-15T14:00:00Z'))
    })

    test('returns ongoing sleep session with no end_time', async () => {
      const user = getTestUser()

      // Sleep that started but hasn't ended yet
      await insertActivity(user, {
        activityType: 'sleep',
        source: 'oura',
        startTime: new Date('2024-01-14T23:00:00Z'),
      })

      const sessions = await getSleepSessions(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(sessions).toHaveLength(1)
      expect(sessions[0].endTime).toBeUndefined()
    })

    test('excludes sleep that ended before query range', async () => {
      const user = getTestUser()

      // Sleep that ended before query range
      await insertActivity(user, {
        activityType: 'sleep',
        endTime: new Date('2024-01-14T07:00:00Z'),
        source: 'oura',
        startTime: new Date('2024-01-13T23:00:00Z'),
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
        activityType: 'sleep',
        endTime: new Date('2024-01-17T07:00:00Z'),
        source: 'oura',
        startTime: new Date('2024-01-16T23:00:00Z'),
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
        activityType: 'exercise',
        endTime: new Date('2024-01-15T11:00:00Z'),
        source: 'health_connect',
        startTime: new Date('2024-01-15T10:00:00Z'),
      })

      await insertActivity(user, {
        activityType: 'sleep',
        endTime: new Date('2024-01-15T07:00:00Z'),
        source: 'oura',
        startTime: new Date('2024-01-14T23:00:00Z'),
      })

      const sessions = await getSleepSessions(
        user,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(sessions).toHaveLength(1)
      expect(sessions[0].activityType).toBe('sleep')
    })
  })

  describe('getActivityById', () => {
    test('retrieves activity by ID', async () => {
      const user = getTestUser()
      const activityId = randomUUID()

      await insertActivity(user, {
        activityType: 'exercise',
        endTime: new Date('2024-01-15T11:00:00Z'),
        id: activityId,
        source: 'manual',
        startTime: new Date('2024-01-15T10:00:00Z'),
        title: 'Morning run',
      })

      const activity = await getActivityById(user, activityId)

      expect(activity).not.toBeNull()
      expect(activity?.id).toBe(activityId)
      expect(activity?.activityType).toBe('exercise')
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
        activityType: 'exercise',
        endTime: new Date('2024-01-15T11:00:00Z'),
        id: activityId,
        source: 'manual',
        startTime: new Date('2024-01-15T10:00:00Z'),
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

  describe('updateActivity', () => {
    test('updates activity times', async () => {
      const user = getTestUser()
      const activityId = randomUUID()

      await insertActivity(user, {
        activityType: 'exercise',
        endTime: new Date('2024-01-15T11:00:00Z'),
        id: activityId,
        source: 'manual',
        startTime: new Date('2024-01-15T10:00:00Z'),
      })

      const updated = await updateActivity(user, activityId, {
        endTime: new Date('2024-01-15T12:00:00Z'),
        startTime: new Date('2024-01-15T09:00:00Z'),
      })

      expect(updated).not.toBeNull()
      expect(updated?.startTime).toEqual(new Date('2024-01-15T09:00:00Z'))
      expect(updated?.endTime).toEqual(new Date('2024-01-15T12:00:00Z'))
    })

    test('updates activity title and notes', async () => {
      const user = getTestUser()
      const activityId = randomUUID()

      await insertActivity(user, {
        activityType: 'exercise',
        endTime: new Date('2024-01-15T11:00:00Z'),
        id: activityId,
        source: 'manual',
        startTime: new Date('2024-01-15T10:00:00Z'),
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
        activityType: 'meditation',
        endTime: new Date('2024-01-15T08:00:00Z'),
        id: activityId,
        source: 'manual',
        startTime: new Date('2024-01-15T07:30:00Z'),
        title: 'Morning meditation',
      })

      const updated = await updateActivity(user, activityId, {})

      expect(updated).not.toBeNull()
      expect(updated?.title).toBe('Morning meditation')
    })
  })
})
