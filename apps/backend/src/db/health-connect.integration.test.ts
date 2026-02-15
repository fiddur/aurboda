import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper'
import { query } from './connection'
import {
  deleteHealthConnectRecords,
  getDailyAggregateValue,
  processDailyAggregate,
  processHealthConnectData,
} from './health-connect'
import { getTimeSeries } from './time-series'

const CONTAINER_TIMEOUT = 60_000

describe('Health Connect Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('processDailyAggregate', () => {
    test('stores valid steps aggregate', async () => {
      const user = getTestUser()

      await processDailyAggregate(user, {
        data_origins: ['com.oura.ring'],
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
        data_origins: [],
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
        data_origins: [],
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
          data_origins: [],
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
        data_origins: [],
        date: '2024-01-15',
        metric: 'steps',
        value: 5000,
      })

      await processDailyAggregate(user, {
        data_origins: [],
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
        data_origins: [],
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

  describe('deleteHealthConnectRecords', () => {
    test('deletes raw record and time_series for a weight record', async () => {
      const user = getTestUser()

      // Insert a weight record via processHealthConnectData
      await processHealthConnectData(user, 'WeightRecord', {
        metadata: { id: 'weight-record-1' },
        time: '2024-01-15T08:00:00Z',
        weightInKilograms: 75.5,
      })

      // Verify data exists
      const rawBefore = await query(user, `SELECT * FROM raw_records WHERE external_id = 'weight-record-1'`)
      expect(rawBefore.rows).toHaveLength(1)

      const tsBefore = await getTimeSeries(
        user,
        'weight',
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      expect(tsBefore).toHaveLength(1)
      expect(tsBefore[0][1]).toBe(75.5)

      // Delete the record
      const deleted = await deleteHealthConnectRecords(user, ['weight-record-1'])
      expect(deleted).toBe(1)

      // Verify raw record is gone
      const rawAfter = await query(user, `SELECT * FROM raw_records WHERE external_id = 'weight-record-1'`)
      expect(rawAfter.rows).toHaveLength(0)

      // Verify time_series entry is gone
      const tsAfter = await getTimeSeries(
        user,
        'weight',
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z'),
      )
      expect(tsAfter).toHaveLength(0)
    })

    test('deletes raw record and activity for an exercise record', async () => {
      const user = getTestUser()

      await processHealthConnectData(user, 'ExerciseSessionRecord', {
        endTime: '2024-01-15T11:00:00Z',
        metadata: { id: 'exercise-1' },
        startTime: '2024-01-15T10:00:00Z',
        title: 'Morning Run',
      })

      // Verify activity exists
      const activitiesBefore = await query(user, `SELECT * FROM activities WHERE source = 'health_connect'`)
      expect(activitiesBefore.rows).toHaveLength(1)

      const deleted = await deleteHealthConnectRecords(user, ['exercise-1'])
      expect(deleted).toBe(1)

      // Verify activity is gone
      const activitiesAfter = await query(user, `SELECT * FROM activities WHERE source = 'health_connect'`)
      expect(activitiesAfter.rows).toHaveLength(0)
    })

    test('handles batch deletions', async () => {
      const user = getTestUser()

      await processHealthConnectData(user, 'WeightRecord', {
        metadata: { id: 'w1' },
        time: '2024-01-15T08:00:00Z',
        weightInKilograms: 75.0,
      })
      await processHealthConnectData(user, 'WeightRecord', {
        metadata: { id: 'w2' },
        time: '2024-01-16T08:00:00Z',
        weightInKilograms: 74.8,
      })

      const deleted = await deleteHealthConnectRecords(user, ['w1', 'w2'])
      expect(deleted).toBe(2)

      const rawAfter = await query(user, `SELECT * FROM raw_records WHERE source = 'health_connect'`)
      expect(rawAfter.rows).toHaveLength(0)
    })

    test('returns 0 for non-existent record IDs', async () => {
      const user = getTestUser()
      const deleted = await deleteHealthConnectRecords(user, ['non-existent-id'])
      expect(deleted).toBe(0)
    })

    test('deletes raw record for steps but preserves aggregate time_series', async () => {
      const user = getTestUser()

      // Insert raw steps record
      await processHealthConnectData(user, 'StepsRecord', {
        count: 500,
        metadata: { id: 'steps-1' },
        startTime: '2024-01-15T10:00:00Z',
      })

      // Also insert a daily aggregate (which should be preserved)
      await processDailyAggregate(user, {
        data_origins: ['com.fitbit'],
        date: '2024-01-15',
        metric: 'steps',
        value: 10000,
      })

      // Delete the raw record
      const deleted = await deleteHealthConnectRecords(user, ['steps-1'])
      expect(deleted).toBe(1)

      // Aggregate should still exist
      const aggregate = await getDailyAggregateValue(user, 'steps', new Date('2024-01-15'))
      expect(aggregate).toBe(10000)
    })
  })
})
