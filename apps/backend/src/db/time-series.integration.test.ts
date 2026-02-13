/**
 * Time series integration tests using testcontainers.
 *
 * Tests insertTimeSeries, getTimeSeries, and getTimeSeriesBucketed against a real
 * PostgreSQL instance.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper'
import { getTimeSeries, getTimeSeriesBucketed, insertTimeSeries } from './time-series'

// Increase timeout for container startup
const CONTAINER_TIMEOUT = 60_000

describe('Time Series Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

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

      // Use a non-cumulative metric since cumulative metrics (steps, distance, etc.)
      // filter by aggregate source in getTimeSeries
      await insertTimeSeries(user, [
        { metric: 'weight', source: 'health_connect', time: new Date('2024-01-15T00:00:00Z'), value: 75.5 },
      ])

      await insertTimeSeries(user, [
        { metric: 'weight', source: 'health_connect', time: new Date('2024-01-15T00:00:00Z'), value: 76.0 },
      ])

      const data = await getTimeSeries(
        user,
        'weight',
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(data).toHaveLength(1)
      expect(data[0][1]).toBe(76.0)
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

    test('cumulative metrics (steps) only return aggregate source data', async () => {
      const user = getTestUser()

      // Insert raw health_connect data (individual readings throughout the day)
      await insertTimeSeries(user, [
        { metric: 'steps', source: 'health_connect', time: new Date('2024-01-15T10:00:00Z'), value: 500 },
        { metric: 'steps', source: 'health_connect', time: new Date('2024-01-15T12:00:00Z'), value: 1200 },
        { metric: 'steps', source: 'health_connect', time: new Date('2024-01-15T14:00:00Z'), value: 800 },
      ])

      // Insert aggregate data (deduplicated daily totals)
      await insertTimeSeries(user, [
        {
          metric: 'steps',
          source: 'health_connect_aggregate',
          time: new Date('2024-01-15T00:00:00Z'),
          value: 8500,
        },
      ])

      // getTimeSeries should only return the aggregate, not the raw readings
      const data = await getTimeSeries(
        user,
        'steps',
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(data).toHaveLength(1)
      expect(data[0][1]).toBe(8500) // Only the aggregate, not sum of raw readings
    })

    test('non-cumulative metrics (heart_rate) return all source data', async () => {
      const user = getTestUser()

      // Insert data from multiple sources
      await insertTimeSeries(user, [
        { metric: 'heart_rate', source: 'health_connect', time: new Date('2024-01-15T10:00:00Z'), value: 72 },
        { metric: 'heart_rate', source: 'oura', time: new Date('2024-01-15T10:05:00Z'), value: 74 },
      ])

      // getTimeSeries should return all sources for non-cumulative metrics
      const data = await getTimeSeries(
        user,
        'heart_rate',
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )

      expect(data).toHaveLength(2)
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
})
