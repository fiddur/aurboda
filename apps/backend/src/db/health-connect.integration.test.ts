import type { DataSource } from '@aurboda/api-spec'

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getActivityById, insertActivity } from './activities/index.ts'
import { query } from './connection.ts'
import {
  deleteHealthConnectRecords,
  getDailyAggregateValue,
  getDailyAggregateValues,
  processDailyAggregate,
  processHealthConnectBatch,
  processHealthConnectData,
} from './health-connect.ts'
import { deleteTimeSeriesPoint, getTimeSeries, insertTimeSeries } from './time-series.ts'

const CONTAINER_TIMEOUT = 120_000

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

  describe('getDailyAggregateValues', () => {
    test('equals getDailyAggregateValue for every day in the range', async () => {
      const user = getTestUser()
      const steps = (iso: string, value: number, source: DataSource) => ({
        metric: 'steps',
        source,
        time: new Date(iso),
        value,
      })
      await insertTimeSeries(user, [
        steps('2024-01-09T12:00:00Z', 111, 'health_connect_aggregate'),
        // Several sources on one day; garmin is not a trusted cumulative source
        steps('2024-01-10T00:00:00Z', 5000, 'health_connect_aggregate'),
        steps('2024-01-10T13:00:00Z', 7000, 'aurboda'),
        steps('2024-01-10T14:00:00Z', 90000, 'garmin'),
        // 2024-01-11 has no rows
        // The single-day window ends before 23:59:59.999, also on days inside the range
        steps('2024-01-12T23:59:59.998Z', 4000, 'aurboda'),
        steps('2024-01-12T23:59:59.999Z', 80000, 'aurboda'),
        steps('2024-01-13T06:00:00Z', 3000, 'health_connect_aggregate'),
        steps('2024-01-13T07:00:00Z', 6000, 'health_connect_aggregate'),
        steps('2024-01-14T22:00:00Z', 2500, 'aurboda'),
        steps('2024-01-15T00:00:00Z', 222, 'health_connect_aggregate'),
      ])
      // Neither version filters deleted_at
      await deleteTimeSeriesPoint(user, 'steps', new Date('2024-01-13T07:00:00Z'), 'health_connect_aggregate')

      const start = new Date('2024-01-10T15:00:00Z')
      const end = new Date('2024-01-14T03:00:00Z')
      const actual = await getDailyAggregateValues(user, 'steps', start, end)

      const expected = new Map<string, number>()
      for (const day of ['2024-01-10', '2024-01-11', '2024-01-12', '2024-01-13', '2024-01-14']) {
        const value = await getDailyAggregateValue(user, 'steps', new Date(`${day}T12:00:00Z`))
        if (value !== null) expected.set(day, value)
      }
      expect(actual).toEqual(expected)
      expect([...actual.entries()]).toEqual([
        ['2024-01-10', 7000],
        ['2024-01-12', 4000],
        ['2024-01-13', 6000],
        ['2024-01-14', 2500],
      ])
    })

    test('is empty when no day has a value', async () => {
      const user = getTestUser()

      const result = await getDailyAggregateValues(
        user,
        'steps',
        new Date('2024-01-10T00:00:00Z'),
        new Date('2024-01-12T00:00:00Z'),
      )
      expect(result.size).toBe(0)
    })
  })

  describe('deleteHealthConnectRecords', () => {
    test('deletes raw record and time_series for a weight record', async () => {
      const user = getTestUser()

      await processHealthConnectData(user, 'WeightRecord', {
        metadata: { id: 'weight-record-1' },
        time: '2024-01-15T08:00:00Z',
        weightInKilograms: 75.5,
      })

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

      const deleted = await deleteHealthConnectRecords(user, ['weight-record-1'])
      expect(deleted).toBe(1)

      const rawAfter = await query(user, `SELECT * FROM raw_records WHERE external_id = 'weight-record-1'`)
      expect(rawAfter.rows).toHaveLength(0)

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

      const activitiesBefore = await query(user, `SELECT * FROM activities WHERE source = 'health_connect'`)
      expect(activitiesBefore.rows).toHaveLength(1)

      const deleted = await deleteHealthConnectRecords(user, ['exercise-1'])
      expect(deleted).toBe(1)

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

      const deleted = await deleteHealthConnectRecords(user, ['steps-1'])
      expect(deleted).toBe(1)

      const aggregate = await getDailyAggregateValue(user, 'steps', new Date('2024-01-15'))
      expect(aggregate).toBe(10000)
    })
  })
  describe('source identity (#1080)', () => {
    const garminSession = (clientRecordId: string) => ({
      endTime: '2026-09-03T07:43:57.343+02:00',
      exerciseType: 70,
      metadata: {
        clientRecordId,
        dataOrigin: 'com.garmin.android.apps.connectmobile',
        id: `hc-${clientRecordId}`,
      },
      startTime: '2026-09-03T07:16:21+02:00',
    })

    test('stores a Garmin-origin exercise under the garmin identity and reports the arrival', async () => {
      const user = getTestUser()

      const arrivals = await processHealthConnectBatch(user, 'ExerciseSessionRecord', [
        garminSession('24218667980'),
      ])

      expect(arrivals).toEqual([{ key: '24218667980', kind: 'activity', provider: 'garmin' }])
      const rows = await query(
        user,
        `SELECT source, external_id, activity_type, data FROM activities WHERE deleted_at IS NULL`,
      )
      expect(rows.rows).toHaveLength(1)
      expect(rows.rows[0]).toMatchObject({
        activity_type: 'strength_training',
        external_id: 'garmin-activity-24218667980',
        source: 'garmin',
      })
      expect(rows.rows[0].data.garmin_activity_id).toBe(24218667980)
      expect(rows.rows[0].data.metadata.clientRecordId).toBe('24218667980')
    })

    test('enriches the legacy garmin row the scraper already wrote instead of duplicating it', async () => {
      const user = getTestUser()
      const legacyId = await insertActivity(user, {
        activity_type: 'strength_training',
        data: { calories: 300, garmin_activity_id: 24218667980 },
        end_time: new Date('2026-09-03T05:43:57Z'),
        source: 'garmin',
        start_time: new Date('2026-09-03T05:16:21Z'),
        title: 'Strength',
      })

      await processHealthConnectData(user, 'ExerciseSessionRecord', garminSession('24218667980'))

      const row = await getActivityById(user, legacyId!)
      expect(row?.external_id).toBe('garmin-activity-24218667980')
      expect(row?.data).toMatchObject({ calories: 300, garmin_activity_id: 24218667980 })
      const count = await query(user, `SELECT count(*)::int AS n FROM activities WHERE deleted_at IS NULL`)
      expect(count.rows[0].n).toBe(1)
    })

    test('re-sources an older health_connect row when HC re-sends the record', async () => {
      const user = getTestUser()
      const oldId = await insertActivity(user, {
        activity_type: 'strength_training',
        data: { metadata: { id: 'hc-old' } },
        source: 'health_connect',
        start_time: new Date('2026-09-03T05:16:21Z'),
      })

      await processHealthConnectBatch(user, 'ExerciseSessionRecord', [garminSession('24218667980')])

      const row = await getActivityById(user, oldId!)
      expect(row?.source).toBe('garmin')
      expect(row?.external_id).toBe('garmin-activity-24218667980')
    })

    test('keys a Garmin sleep by its local calendar date', async () => {
      const user = getTestUser()
      const arrivals = await processHealthConnectBatch(user, 'SleepSessionRecord', [
        {
          endTime: '2026-09-03T06:40:43+02:00',
          metadata: {
            clientRecordId: '1788386400000',
            dataOrigin: 'com.garmin.android.apps.connectmobile',
            id: 'hc-sleep',
          },
          stages: [],
          startTime: '2026-09-03T00:49:43+02:00',
        },
      ])
      expect(arrivals).toEqual([{ key: '2026-09-03', kind: 'sleep', provider: 'garmin' }])
      const rows = await query(user, `SELECT source, external_id FROM activities`)
      expect(rows.rows[0]).toEqual({ external_id: 'garmin-sleep-2026-09-03', source: 'garmin' })
    })

    test('leaves sessions from unknown apps as plain health_connect rows', async () => {
      const user = getTestUser()
      const arrivals = await processHealthConnectBatch(user, 'ExerciseSessionRecord', [
        {
          endTime: '2026-09-03T07:43:57+02:00',
          exerciseType: 56,
          metadata: { clientRecordId: 'abc', dataOrigin: 'com.polar.polarflow', id: 'hc-polar' },
          startTime: '2026-09-03T07:16:21+02:00',
        },
      ])
      expect(arrivals).toEqual([])
      const rows = await query(user, `SELECT source, external_id FROM activities`)
      expect(rows.rows[0]).toEqual({ external_id: null, source: 'health_connect' })
    })
  })
})
