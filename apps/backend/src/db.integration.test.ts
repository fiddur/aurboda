/**
 * Database integration tests using testcontainers.
 *
 * These tests call the actual db.ts functions against a real PostgreSQL
 * instance to verify they work correctly.
 */

import { randomUUID } from 'crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  deleteActivity,
  deleteMcpSession,
  deleteTag,
  findMergeableTag,
  getActivities,
  getActivityById,
  getDailyAggregateValue,
  getMcpSession,
  getMcpSessionsForUser,
  getProgrammaticTags,
  getSleepSessions,
  getTags,
  getTimeSeries,
  getTimeSeriesBucketed,
  getUniqueTags,
  getUserSettings,
  insertActivity,
  insertTag,
  insertTimeSeries,
  isProgrammaticTag,
  processDailyAggregate,
  saveMcpSession,
  touchMcpSession,
  updateActivity,
  updateTagEndTime,
  upsertUserSettings,
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
  // Bucketed Time Series
  // ==========================================================================

  describe('getTimeSeriesBucketed', () => {
    test('returns aggregated buckets for a single metric', async () => {
      const user = getTestUser()

      // Insert heart rate data spread across two 15-minute buckets
      await insertTimeSeries(user, [
        // Bucket 1: 10:00-10:15 (values: 70, 72, 74)
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:00:00Z'), value: 70 },
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:05:00Z'), value: 72 },
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:10:00Z'), value: 74 },
        // Bucket 2: 10:15-10:30 (values: 80, 85, 90)
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:15:00Z'), value: 80 },
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:20:00Z'), value: 85 },
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:25:00Z'), value: 90 },
      ])

      const buckets = await getTimeSeriesBucketed(
        user,
        ['heart_rate'],
        new Date('2024-01-15T10:00:00Z'),
        new Date('2024-01-15T10:30:00Z'),
        15, // 15-minute buckets
      )

      expect(buckets).toHaveLength(2)

      // First bucket: 10:00-10:15
      expect(buckets[0].bucketStart).toEqual(new Date('2024-01-15T10:00:00Z'))
      expect(buckets[0].metric).toBe('heart_rate')
      expect(buckets[0].count).toBe(3)
      expect(buckets[0].min).toBe(70)
      expect(buckets[0].max).toBe(74)
      expect(buckets[0].avg).toBeCloseTo(72, 1) // (70+72+74)/3 = 72

      // Second bucket: 10:15-10:30
      expect(buckets[1].bucketStart).toEqual(new Date('2024-01-15T10:15:00Z'))
      expect(buckets[1].metric).toBe('heart_rate')
      expect(buckets[1].count).toBe(3)
      expect(buckets[1].min).toBe(80)
      expect(buckets[1].max).toBe(90)
      expect(buckets[1].avg).toBeCloseTo(85, 1) // (80+85+90)/3 = 85
    })

    test('returns buckets for multiple metrics', async () => {
      const user = getTestUser()

      await insertTimeSeries(user, [
        // Heart rate data
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:00:00Z'), value: 72 },
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:05:00Z'), value: 75 },
        // HRV data
        { metric: 'hrv_rmssd', source: 'health_connect', time: new Date('2024-01-15T10:00:00Z'), value: 45 },
        { metric: 'hrv_rmssd', source: 'health_connect', time: new Date('2024-01-15T10:05:00Z'), value: 50 },
      ])

      const buckets = await getTimeSeriesBucketed(
        user,
        ['heart_rate', 'hrv_rmssd'],
        new Date('2024-01-15T10:00:00Z'),
        new Date('2024-01-15T10:15:00Z'),
        15,
      )

      expect(buckets).toHaveLength(2) // One bucket per metric

      const hrBucket = buckets.find((b) => b.metric === 'heart_rate')
      const hrvBucket = buckets.find((b) => b.metric === 'hrv_rmssd')

      expect(hrBucket).toBeDefined()
      expect(hrBucket!.count).toBe(2)
      expect(hrBucket!.avg).toBeCloseTo(73.5, 1)

      expect(hrvBucket).toBeDefined()
      expect(hrvBucket!.count).toBe(2)
      expect(hrvBucket!.avg).toBeCloseTo(47.5, 1)
    })

    test('returns empty array when no data in range', async () => {
      const user = getTestUser()

      const buckets = await getTimeSeriesBucketed(
        user,
        ['heart_rate'],
        new Date('2024-01-15T10:00:00Z'),
        new Date('2024-01-15T11:00:00Z'),
        15,
      )

      expect(buckets).toHaveLength(0)
    })

    test('returns empty array for empty metrics array', async () => {
      const user = getTestUser()

      await insertTimeSeries(user, [
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:00:00Z'), value: 72 },
      ])

      const buckets = await getTimeSeriesBucketed(
        user,
        [],
        new Date('2024-01-15T10:00:00Z'),
        new Date('2024-01-15T11:00:00Z'),
        15,
      )

      expect(buckets).toHaveLength(0)
    })

    test('handles 5-minute bucket size', async () => {
      const user = getTestUser()

      await insertTimeSeries(user, [
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:00:00Z'), value: 70 },
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:02:00Z'), value: 72 },
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:05:00Z'), value: 80 },
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:07:00Z'), value: 82 },
      ])

      const buckets = await getTimeSeriesBucketed(
        user,
        ['heart_rate'],
        new Date('2024-01-15T10:00:00Z'),
        new Date('2024-01-15T10:10:00Z'),
        5, // 5-minute buckets
      )

      expect(buckets).toHaveLength(2)
      expect(buckets[0].bucketStart).toEqual(new Date('2024-01-15T10:00:00Z'))
      expect(buckets[0].count).toBe(2)
      expect(buckets[1].bucketStart).toEqual(new Date('2024-01-15T10:05:00Z'))
      expect(buckets[1].count).toBe(2)
    })

    test('handles 1-hour bucket size', async () => {
      const user = getTestUser()

      await insertTimeSeries(user, [
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:00:00Z'), value: 70 },
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:30:00Z'), value: 75 },
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T11:00:00Z'), value: 80 },
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T11:30:00Z'), value: 85 },
      ])

      const buckets = await getTimeSeriesBucketed(
        user,
        ['heart_rate'],
        new Date('2024-01-15T10:00:00Z'),
        new Date('2024-01-15T12:00:00Z'),
        60, // 1-hour buckets
      )

      expect(buckets).toHaveLength(2)
      expect(buckets[0].bucketStart).toEqual(new Date('2024-01-15T10:00:00Z'))
      expect(buckets[0].count).toBe(2)
      expect(buckets[0].avg).toBeCloseTo(72.5, 1)
      expect(buckets[1].bucketStart).toEqual(new Date('2024-01-15T11:00:00Z'))
      expect(buckets[1].count).toBe(2)
      expect(buckets[1].avg).toBeCloseTo(82.5, 1)
    })

    test('handles 1-day bucket size', async () => {
      const user = getTestUser()

      await insertTimeSeries(user, [
        // Day 1
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:00:00Z'), value: 70 },
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T20:00:00Z'), value: 80 },
        // Day 2
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-16T10:00:00Z'), value: 75 },
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-16T20:00:00Z'), value: 85 },
      ])

      const buckets = await getTimeSeriesBucketed(
        user,
        ['heart_rate'],
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-17T00:00:00Z'),
        1440, // 1-day buckets (24*60 minutes)
      )

      expect(buckets).toHaveLength(2)
      expect(buckets[0].bucketStart).toEqual(new Date('2024-01-15T00:00:00Z'))
      expect(buckets[0].count).toBe(2)
      expect(buckets[0].avg).toBeCloseTo(75, 1)
      expect(buckets[1].bucketStart).toEqual(new Date('2024-01-16T00:00:00Z'))
      expect(buckets[1].count).toBe(2)
      expect(buckets[1].avg).toBeCloseTo(80, 1)
    })

    test('only returns buckets with data (no empty buckets)', async () => {
      const user = getTestUser()

      // Only data in first and third 15-minute buckets
      await insertTimeSeries(user, [
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:00:00Z'), value: 70 },
        // Gap: 10:15-10:30 has no data
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:30:00Z'), value: 80 },
      ])

      const buckets = await getTimeSeriesBucketed(
        user,
        ['heart_rate'],
        new Date('2024-01-15T10:00:00Z'),
        new Date('2024-01-15T10:45:00Z'),
        15,
      )

      expect(buckets).toHaveLength(2)
      expect(buckets[0].bucketStart).toEqual(new Date('2024-01-15T10:00:00Z'))
      expect(buckets[1].bucketStart).toEqual(new Date('2024-01-15T10:30:00Z'))
    })

    test('excludes data outside the time range', async () => {
      const user = getTestUser()

      await insertTimeSeries(user, [
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T09:59:00Z'), value: 60 }, // Before range
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:00:00Z'), value: 70 },
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:14:00Z'), value: 75 },
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:15:00Z'), value: 80 }, // At end boundary (excluded)
      ])

      const buckets = await getTimeSeriesBucketed(
        user,
        ['heart_rate'],
        new Date('2024-01-15T10:00:00Z'),
        new Date('2024-01-15T10:15:00Z'),
        15,
      )

      expect(buckets).toHaveLength(1)
      expect(buckets[0].count).toBe(2) // Only 70 and 75, not 60 (before) or 80 (at/after end)
      expect(buckets[0].min).toBe(70)
      expect(buckets[0].max).toBe(75)
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

  // ==========================================================================
  // MCP Sessions
  // ==========================================================================

  describe('saveMcpSession', () => {
    test('saves a new session', async () => {
      const user = getTestUser()
      const sessionId = randomUUID()

      const result = await saveMcpSession(user, sessionId)

      expect(result.sessionId).toBe(sessionId)
      expect(result.username).toBe(user)
      expect(result.createdAt).toBeInstanceOf(Date)
      expect(result.lastActivity).toBeInstanceOf(Date)
    })

    test('upserts existing session and updates lastActivity', async () => {
      const user = getTestUser()
      const sessionId = randomUUID()

      const first = await saveMcpSession(user, sessionId)

      // Wait a bit to ensure timestamp changes
      await new Promise((r) => setTimeout(r, 10))

      const second = await saveMcpSession(user, sessionId)

      expect(second.sessionId).toBe(sessionId)
      expect(second.createdAt.getTime()).toBe(first.createdAt.getTime())
      expect(second.lastActivity.getTime()).toBeGreaterThanOrEqual(first.lastActivity.getTime())
    })
  })

  describe('getMcpSession', () => {
    test('retrieves existing session', async () => {
      const user = getTestUser()
      const sessionId = randomUUID()

      await saveMcpSession(user, sessionId)

      const result = await getMcpSession(user, sessionId)

      expect(result).not.toBeNull()
      expect(result!.sessionId).toBe(sessionId)
      expect(result!.username).toBe(user)
    })

    test('returns null for non-existent session', async () => {
      const user = getTestUser()

      const result = await getMcpSession(user, randomUUID())

      expect(result).toBeNull()
    })
  })

  describe('touchMcpSession', () => {
    test('updates lastActivity timestamp', async () => {
      const user = getTestUser()
      const sessionId = randomUUID()

      await saveMcpSession(user, sessionId)
      const before = await getMcpSession(user, sessionId)

      // Wait a bit to ensure timestamp changes
      await new Promise((r) => setTimeout(r, 10))

      await touchMcpSession(user, sessionId)
      const after = await getMcpSession(user, sessionId)

      expect(after!.lastActivity.getTime()).toBeGreaterThanOrEqual(before!.lastActivity.getTime())
    })
  })

  describe('deleteMcpSession', () => {
    test('deletes existing session and returns true', async () => {
      const user = getTestUser()
      const sessionId = randomUUID()

      await saveMcpSession(user, sessionId)

      const result = await deleteMcpSession(user, sessionId)

      expect(result).toBe(true)

      const check = await getMcpSession(user, sessionId)
      expect(check).toBeNull()
    })

    test('returns false for non-existent session', async () => {
      const user = getTestUser()

      const result = await deleteMcpSession(user, randomUUID())

      expect(result).toBe(false)
    })
  })

  describe('getMcpSessionsForUser', () => {
    test('returns all sessions for a user', async () => {
      const user = getTestUser()

      await saveMcpSession(user, randomUUID())
      await saveMcpSession(user, randomUUID())
      await saveMcpSession(user, randomUUID())

      const sessions = await getMcpSessionsForUser(user)

      expect(sessions).toHaveLength(3)
    })

    test('returns sessions ordered by lastActivity descending', async () => {
      const user = getTestUser()

      const oldSessionId = randomUUID()
      const newSessionId = randomUUID()

      await saveMcpSession(user, oldSessionId)
      await new Promise((r) => setTimeout(r, 10))
      await saveMcpSession(user, newSessionId)

      const sessions = await getMcpSessionsForUser(user)

      expect(sessions[0].sessionId).toBe(newSessionId)
      expect(sessions[1].sessionId).toBe(oldSessionId)
    })
  })

  // ==========================================================================
  // Tag Mappings
  // ==========================================================================

  describe('getUniqueTags', () => {
    test('returns empty array when no tags exist', async () => {
      const user = getTestUser()

      const tags = await getUniqueTags(user)

      expect(tags).toEqual([])
    })

    test('returns unique tag names sorted alphabetically', async () => {
      const user = getTestUser()

      await insertTag(user, {
        externalId: 'tag-1',
        source: 'manual',
        startTime: new Date('2024-01-15T10:00:00Z'),
        tag: 'coffee',
      })
      await insertTag(user, {
        externalId: 'tag-2',
        source: 'manual',
        startTime: new Date('2024-01-15T11:00:00Z'),
        tag: 'meditation',
      })
      await insertTag(user, {
        externalId: 'tag-3',
        source: 'manual',
        startTime: new Date('2024-01-15T12:00:00Z'),
        tag: 'coffee', // duplicate
      })
      await insertTag(user, {
        externalId: 'tag-4',
        source: 'oura',
        startTime: new Date('2024-01-15T13:00:00Z'),
        tag: 'apple',
      })

      const tags = await getUniqueTags(user)

      expect(tags).toEqual(['apple', 'coffee', 'meditation'])
    })
  })

  describe('isProgrammaticTag', () => {
    test('returns true for UUID tags', () => {
      expect(isProgrammaticTag('067e2862-8cf8-4307-a621-0636dd379cda')).toBe(true)
      expect(isProgrammaticTag('BD6D2689-103B-4AD8-9576-458E0C5325DF')).toBe(true) // uppercase
    })

    test('returns true for tag_* prefixed tags', () => {
      expect(isProgrammaticTag('tag_generic_coffee')).toBe(true)
      expect(isProgrammaticTag('tag_sleep_sauna')).toBe(true)
      expect(isProgrammaticTag('tag_generic_pain_killer')).toBe(true)
    })

    test('returns false for regular human-readable tags', () => {
      expect(isProgrammaticTag('coffee')).toBe(false)
      expect(isProgrammaticTag('Food')).toBe(false)
      expect(isProgrammaticTag('Hot Chocolate')).toBe(false)
      expect(isProgrammaticTag('meditation')).toBe(false)
    })
  })

  describe('getProgrammaticTags', () => {
    test('returns empty array when no tags exist', async () => {
      const user = getTestUser()

      const tags = await getProgrammaticTags(user)

      expect(tags).toEqual([])
    })

    test('returns UUID tags with counts from tags table', async () => {
      const user = getTestUser()
      const uuid1 = '067e2862-8cf8-4307-a621-0636dd379cda'
      const uuid2 = '4ddc8bc2-911d-467d-8c9d-dac2ece87d0a'

      // Insert tags directly to tags table (simulating how Oura sync stores them)
      await insertTag(user, {
        externalId: 'tag-1',
        source: 'oura',
        startTime: new Date('2024-01-15T10:00:00Z'),
        tag: uuid1,
      })
      await insertTag(user, {
        externalId: 'tag-2',
        source: 'oura',
        startTime: new Date('2024-01-15T11:00:00Z'),
        tag: uuid1, // same tag, counted twice
      })
      await insertTag(user, {
        externalId: 'tag-3',
        source: 'oura',
        startTime: new Date('2024-01-15T12:00:00Z'),
        tag: uuid2,
      })

      const tags = await getProgrammaticTags(user)

      expect(tags).toHaveLength(2)
      // Sorted by latest time descending
      expect(tags[0].tagKey).toBe(uuid2)
      expect(tags[0].count).toBe(1)
      expect(tags[1].tagKey).toBe(uuid1)
      expect(tags[1].count).toBe(2)
    })

    test('returns tag_* prefixed tags', async () => {
      const user = getTestUser()

      await insertTag(user, {
        externalId: 'tag-1',
        source: 'oura',
        startTime: new Date('2024-01-15T10:00:00Z'),
        tag: 'tag_generic_coffee',
      })
      await insertTag(user, {
        externalId: 'tag-2',
        source: 'oura',
        startTime: new Date('2024-01-15T11:00:00Z'),
        tag: 'tag_sleep_sauna',
      })

      const tags = await getProgrammaticTags(user)

      expect(tags).toHaveLength(2)
      expect(tags.map((t) => t.tagKey).sort()).toEqual(['tag_generic_coffee', 'tag_sleep_sauna'])
    })

    test('excludes regular human-readable tags', async () => {
      const user = getTestUser()
      const uuid = '067e2862-8cf8-4307-a621-0636dd379cda'

      await insertTag(user, {
        externalId: 'tag-1',
        source: 'oura',
        startTime: new Date('2024-01-15T10:00:00Z'),
        tag: uuid, // should be included
      })
      await insertTag(user, {
        externalId: 'tag-2',
        source: 'manual',
        startTime: new Date('2024-01-15T11:00:00Z'),
        tag: 'coffee', // should be excluded
      })
      await insertTag(user, {
        externalId: 'tag-3',
        source: 'manual',
        startTime: new Date('2024-01-15T12:00:00Z'),
        tag: 'Food', // should be excluded
      })

      const tags = await getProgrammaticTags(user)

      expect(tags).toHaveLength(1)
      expect(tags[0].tagKey).toBe(uuid)
    })
  })

  describe('User Settings with tagMappings', () => {
    test('stores and retrieves tagMappings', async () => {
      const user = getTestUser()
      const mappings = {
        '067e2862-8cf8-4307-a621-0636dd379cda': 'Hot Chocolate',
        '4ddc8bc2-911d-467d-8c9d-dac2ece87d0a': 'YinYoga',
      }

      await upsertUserSettings(user, { tagMappings: mappings })

      const settings = await getUserSettings(user)
      expect(settings?.tagMappings).toEqual(mappings)
    })

    test('updates tagMappings while preserving other settings', async () => {
      const user = getTestUser()

      // Set initial settings
      await upsertUserSettings(user, { birthDate: '1990-01-15' })

      // Add tag mappings
      const mappings = { 'test-uuid': 'Test Tag' }
      await upsertUserSettings(user, { tagMappings: mappings })

      const settings = await getUserSettings(user)
      expect(settings?.birthDate).toBe('1990-01-15')
      expect(settings?.tagMappings).toEqual(mappings)
    })

    test('replaces tagMappings with empty object to clear', async () => {
      const user = getTestUser()

      await upsertUserSettings(user, { tagMappings: { 'test-uuid': 'Test' } })
      // Setting to empty object effectively clears the mappings
      await upsertUserSettings(user, { tagMappings: {} })

      const settings = await getUserSettings(user)
      expect(settings?.tagMappings).toEqual({})
    })

    test('preserves tagMappings when update does not include tagMappings', async () => {
      const user = getTestUser()
      const mappings = { 'test-uuid': 'Test' }

      await upsertUserSettings(user, { tagMappings: mappings })
      // Updating other fields should not affect tagMappings
      await upsertUserSettings(user, { birthDate: '2000-01-01' })

      const settings = await getUserSettings(user)
      expect(settings?.tagMappings).toEqual(mappings)
      expect(settings?.birthDate).toBe('2000-01-01')
    })
  })
})
