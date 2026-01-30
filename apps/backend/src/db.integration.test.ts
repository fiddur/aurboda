/**
 * Database integration tests using testcontainers.
 *
 * These tests call the actual db.ts functions against a real PostgreSQL
 * instance to verify they work correctly.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  deleteTag,
  findMergeableTag,
  getActivities,
  getDailyAggregateValue,
  getSleepSessions,
  getTags,
  getTimeSeries,
  insertActivity,
  insertTag,
  insertTimeSeries,
  processDailyAggregate,
  updateTagEndTime,
} from './db'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from './test/db-test-helper'

// Increase timeout for container startup
const CONTAINER_TIMEOUT = 60_000

describe('Database Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  // ==========================================================================
  // Tags
  // ==========================================================================

  describe('insertTag', () => {
    test('inserts a tag with start time only', async () => {
      const user = getTestUser()

      await insertTag(user, {
        externalId: 'tag-1',
        source: 'manual',
        startTime: new Date('2024-01-15T10:00:00Z'),
        tag: 'coffee',
      })

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))
      expect(tags).toHaveLength(1)
      expect(tags[0].tag).toBe('coffee')
      expect(tags[0].externalId).toBe('tag-1')
      expect(tags[0].endTime).toBeUndefined()
    })

    test('inserts a tag with start and end time', async () => {
      const user = getTestUser()

      await insertTag(user, {
        endTime: new Date('2024-01-15T11:00:00Z'),
        externalId: 'tag-2',
        source: 'manual',
        startTime: new Date('2024-01-15T10:00:00Z'),
        tag: 'meditation',
      })

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))
      expect(tags).toHaveLength(1)
      expect(tags[0].tag).toBe('meditation')
      expect(tags[0].endTime).toEqual(new Date('2024-01-15T11:00:00Z'))
    })

    test('upserts tag on conflict (same source + external_id)', async () => {
      const user = getTestUser()

      await insertTag(user, {
        externalId: 'tag-3',
        source: 'manual',
        startTime: new Date('2024-01-15T10:00:00Z'),
        tag: 'coffee',
      })

      await insertTag(user, {
        externalId: 'tag-3',
        source: 'manual',
        startTime: new Date('2024-01-15T11:00:00Z'),
        tag: 'tea',
      })

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))
      expect(tags).toHaveLength(1)
      expect(tags[0].tag).toBe('tea')
      expect(tags[0].startTime).toEqual(new Date('2024-01-15T11:00:00Z'))
    })
  })

  describe('getTags', () => {
    test('returns tags within time range', async () => {
      const user = getTestUser()

      await insertTag(user, {
        externalId: 'tag-a',
        source: 'manual',
        startTime: new Date('2024-01-14T10:00:00Z'),
        tag: 'before-range',
      })
      await insertTag(user, {
        externalId: 'tag-b',
        source: 'manual',
        startTime: new Date('2024-01-15T10:00:00Z'),
        tag: 'in-range',
      })
      await insertTag(user, {
        externalId: 'tag-c',
        source: 'manual',
        startTime: new Date('2024-01-16T10:00:00Z'),
        tag: 'after-range',
      })

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))
      expect(tags).toHaveLength(1)
      expect(tags[0].tag).toBe('in-range')
    })

    test('returns empty array when no tags in range', async () => {
      const user = getTestUser()

      await insertTag(user, {
        externalId: 'tag-x',
        source: 'manual',
        startTime: new Date('2024-01-10T10:00:00Z'),
        tag: 'old-tag',
      })

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))
      expect(tags).toHaveLength(0)
    })
  })

  describe('deleteTag', () => {
    test('deletes tag and returns true when found', async () => {
      const user = getTestUser()

      await insertTag(user, {
        externalId: 'tag-to-delete',
        source: 'manual',
        startTime: new Date('2024-01-15T10:00:00Z'),
        tag: 'temporary',
      })

      const result = await deleteTag(user, 'tag-to-delete')
      expect(result).toBe(true)

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))
      expect(tags).toHaveLength(0)
    })

    test('returns false when tag not found', async () => {
      const user = getTestUser()

      const result = await deleteTag(user, 'nonexistent-tag')
      expect(result).toBe(false)
    })
  })

  describe('findMergeableTag', () => {
    test('finds tag with end_time within merge span', async () => {
      const user = getTestUser()

      await insertTag(user, {
        endTime: new Date('2024-01-15T09:59:00Z'),
        externalId: 'mergeable-tag',
        source: 'manual',
        startTime: new Date('2024-01-15T09:00:00Z'),
        tag: 'computer:dharma',
      })

      const result = await findMergeableTag(user, 'computer:dharma', new Date('2024-01-15T10:00:00Z'), 180)

      expect(result).toBeDefined()
      expect(result!.externalId).toBe('mergeable-tag')
      expect(result!.tag).toBe('computer:dharma')
    })

    test('finds point-in-time tag (no end_time) within merge span', async () => {
      const user = getTestUser()

      await insertTag(user, {
        externalId: 'point-tag',
        source: 'manual',
        startTime: new Date('2024-01-15T09:58:00Z'),
        tag: 'coffee',
      })

      const result = await findMergeableTag(user, 'coffee', new Date('2024-01-15T10:00:00Z'), 180)

      expect(result).toBeDefined()
      expect(result!.externalId).toBe('point-tag')
      expect(result!.endTime).toBeUndefined()
    })

    test('returns undefined when no tag within merge span', async () => {
      const user = getTestUser()

      await insertTag(user, {
        endTime: new Date('2024-01-15T09:50:00Z'),
        externalId: 'old-tag',
        source: 'manual',
        startTime: new Date('2024-01-15T09:00:00Z'),
        tag: 'computer:dharma',
      })

      const result = await findMergeableTag(user, 'computer:dharma', new Date('2024-01-15T10:00:00Z'), 180)

      expect(result).toBeUndefined()
    })

    test('only finds manual source tags', async () => {
      const user = getTestUser()

      await insertTag(user, {
        endTime: new Date('2024-01-15T09:59:00Z'),
        externalId: 'oura-tag',
        source: 'oura',
        startTime: new Date('2024-01-15T09:00:00Z'),
        tag: 'meditation',
      })

      const result = await findMergeableTag(user, 'meditation', new Date('2024-01-15T10:00:00Z'), 180)

      expect(result).toBeUndefined()
    })

    test('only finds tags with matching name', async () => {
      const user = getTestUser()

      await insertTag(user, {
        endTime: new Date('2024-01-15T09:59:00Z'),
        externalId: 'different-tag',
        source: 'manual',
        startTime: new Date('2024-01-15T09:00:00Z'),
        tag: 'different-name',
      })

      const result = await findMergeableTag(user, 'computer:dharma', new Date('2024-01-15T10:00:00Z'), 180)

      expect(result).toBeUndefined()
    })
  })

  describe('updateTagEndTime', () => {
    test('updates end_time and returns true when tag found', async () => {
      const user = getTestUser()

      await insertTag(user, {
        endTime: new Date('2024-01-15T10:30:00Z'),
        externalId: 'tag-to-update',
        source: 'manual',
        startTime: new Date('2024-01-15T10:00:00Z'),
        tag: 'session',
      })

      const result = await updateTagEndTime(user, 'tag-to-update', new Date('2024-01-15T11:00:00Z'))
      expect(result).toBe(true)

      const tags = await getTags(user, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'))
      expect(tags[0].endTime).toEqual(new Date('2024-01-15T11:00:00Z'))
    })

    test('returns false when tag not found', async () => {
      const user = getTestUser()

      const result = await updateTagEndTime(user, 'nonexistent', new Date('2024-01-15T11:00:00Z'))
      expect(result).toBe(false)
    })
  })

  // ==========================================================================
  // Time Series
  // ==========================================================================

  describe('insertTimeSeries', () => {
    test('inserts and retrieves time series data', async () => {
      const user = getTestUser()

      await insertTimeSeries(user, [
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:00:00Z'), value: 72 },
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:01:00Z'), value: 75 },
      ])

      const data = await getTimeSeries(
        user,
        'heart_rate',
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(data).toHaveLength(2)
      expect(data[0][1]).toBe(72)
      expect(data[1][1]).toBe(75)
    })

    test('upserts on conflict (same time + metric + source)', async () => {
      const user = getTestUser()

      await insertTimeSeries(user, [
        { metric: 'steps', source: 'health_connect', time: new Date('2024-01-15T00:00:00Z'), value: 5000 },
      ])

      await insertTimeSeries(user, [
        { metric: 'steps', source: 'health_connect', time: new Date('2024-01-15T00:00:00Z'), value: 10000 },
      ])

      const data = await getTimeSeries(
        user,
        'steps',
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(data).toHaveLength(1)
      expect(data[0][1]).toBe(10000)
    })

    test('handles empty array gracefully', async () => {
      const user = getTestUser()

      // Should not throw
      await insertTimeSeries(user, [])

      const data = await getTimeSeries(
        user,
        'heart_rate',
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      expect(data).toHaveLength(0)
    })

    test('deduplicates points with same time+metric+source before insert', async () => {
      const user = getTestUser()

      // Insert multiple points with same key - should keep last value
      await insertTimeSeries(user, [
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:00:00Z'), value: 72 },
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:00:00Z'), value: 75 },
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:00:00Z'), value: 78 },
      ])

      const data = await getTimeSeries(
        user,
        'heart_rate',
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(data).toHaveLength(1)
      expect(data[0][1]).toBe(78) // Last value wins
    })

    test('preserves points with different timestamps', async () => {
      const user = getTestUser()

      await insertTimeSeries(user, [
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:00:00Z'), value: 72 },
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:00:01Z'), value: 75 },
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:00:02Z'), value: 78 },
      ])

      const data = await getTimeSeries(
        user,
        'heart_rate',
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(data).toHaveLength(3)
    })

    test('deduplicates only matching time+metric+source combinations', async () => {
      const user = getTestUser()

      await insertTimeSeries(user, [
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:00:00Z'), value: 72 },
        {
          metric: 'resting_heart_rate',
          source: 'health_connect',
          time: new Date('2024-01-15T10:00:00Z'),
          value: 65,
        },
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:00:00Z'), value: 80 },
      ])

      const hrData = await getTimeSeries(
        user,
        'heart_rate',
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      const restingHrData = await getTimeSeries(
        user,
        'resting_heart_rate',
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(hrData).toHaveLength(1)
      expect(hrData[0][1]).toBe(80) // Last heart_rate value
      expect(restingHrData).toHaveLength(1)
      expect(restingHrData[0][1]).toBe(65) // resting_heart_rate unchanged
    })
  })

  // ==========================================================================
  // Daily Aggregates
  // ==========================================================================

  describe('processDailyAggregate', () => {
    test('stores valid steps aggregate', async () => {
      const user = getTestUser()

      await processDailyAggregate(user, {
        dataOrigins: ['com.oura.ring'],
        date: '2024-01-15',
        metric: 'steps',
        value: 10000,
      })

      const result = await getDailyAggregateValue(user, 'steps', new Date('2024-01-15'))
      expect(result).toBe(10000)
    })

    test('rejects invalid metric with warning', async () => {
      const user = getTestUser()
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await processDailyAggregate(user, {
        dataOrigins: [],
        date: '2024-01-15',
        metric: 'invalid_metric',
        value: 100,
      })

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid metric in daily aggregate'))
      consoleSpy.mockRestore()

      // Should not have stored anything
      const result = await getDailyAggregateValue(user, 'steps', new Date('2024-01-15'))
      expect(result).toBeNull()
    })

    test('rejects non-cumulative metric with warning', async () => {
      const user = getTestUser()
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await processDailyAggregate(user, {
        dataOrigins: [],
        date: '2024-01-15',
        metric: 'heart_rate', // Valid but not cumulative
        value: 72,
      })

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('is not a cumulative metric'))
      consoleSpy.mockRestore()
    })

    test('accepts all cumulative metrics', async () => {
      const user = getTestUser()
      const cumulativeMetrics = ['steps', 'distance', 'floors_climbed', 'calories_active', 'calories_total']

      for (const metric of cumulativeMetrics) {
        await processDailyAggregate(user, {
          dataOrigins: [],
          date: '2024-01-15',
          metric,
          value: 100,
        })
      }

      // Verify all were stored
      for (const metric of cumulativeMetrics) {
        const result = await getDailyAggregateValue(user, metric as 'steps', new Date('2024-01-15'))
        expect(result).toBe(100)
      }
    })

    test('upserts on same day', async () => {
      const user = getTestUser()

      await processDailyAggregate(user, {
        dataOrigins: [],
        date: '2024-01-15',
        metric: 'steps',
        value: 5000,
      })

      await processDailyAggregate(user, {
        dataOrigins: [],
        date: '2024-01-15',
        metric: 'steps',
        value: 10000,
      })

      const result = await getDailyAggregateValue(user, 'steps', new Date('2024-01-15'))
      expect(result).toBe(10000)
    })
  })

  describe('getDailyAggregateValue', () => {
    test('returns value when aggregate exists', async () => {
      const user = getTestUser()

      await processDailyAggregate(user, {
        dataOrigins: [],
        date: '2024-01-15',
        metric: 'steps',
        value: 12500,
      })

      const result = await getDailyAggregateValue(user, 'steps', new Date('2024-01-15'))
      expect(result).toBe(12500)
    })

    test('returns null when no aggregate exists', async () => {
      const user = getTestUser()

      const result = await getDailyAggregateValue(user, 'steps', new Date('2024-01-15'))
      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // Activities & Sleep Sessions
  // ==========================================================================

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
})
