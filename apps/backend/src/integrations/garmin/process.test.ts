import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { GarminActivityDetailResponse } from './client.ts'
import type { GarminProcessDeps } from './process.ts'

import { extractNumericValue, processActivityDetail, processGarminData } from './process.ts'

const mockDeps: GarminProcessDeps = {
  deleteGarminActivityWithWrongType: vi.fn().mockResolvedValue(null),
  insertActivity: vi.fn().mockResolvedValue(undefined),
  insertLocations: vi.fn().mockResolvedValue(undefined),
  insertRawRecord: vi.fn().mockResolvedValue(undefined),
  insertTimeSeries: vi.fn().mockResolvedValue(undefined),
  softDeleteLocationRange: vi.fn().mockResolvedValue(undefined),
}

/** Helper: noon UTC for a given date string. */
const noonUTC = (date: string): Date => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
}

describe('processGarminData', () => {
  const user = 'testuser'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================================================
  // Null / undefined guard
  // ==========================================================================

  test('returns 0 for null data', async () => {
    expect(await processGarminData(user, 'dailySummary', null, mockDeps)).toBe(0)
    expect(mockDeps.insertRawRecord).not.toHaveBeenCalled()
  })

  test('returns 0 for undefined data', async () => {
    expect(await processGarminData(user, 'heartRate', undefined, mockDeps)).toBe(0)
    expect(mockDeps.insertRawRecord).not.toHaveBeenCalled()
  })

  // ==========================================================================
  // Daily Summary
  // ==========================================================================

  describe('dailySummary', () => {
    const makeSummary = (overrides: Record<string, unknown> = {}) => ({
      activeKilocalories: 450,
      averageSpo2: 97,
      averageStressLevel: 32,
      calendarDate: '2025-01-15',
      floorsAscended: 10,
      restingHeartRate: 58,
      totalDistanceMeters: 6200,
      totalKilocalories: 2100,
      totalSteps: 8500,
      ...overrides,
    })

    test('inserts raw record with correct fields', async () => {
      await processGarminData(user, 'dailySummary', makeSummary(), mockDeps)

      expect(mockDeps.insertRawRecord).toHaveBeenCalledWith(user, {
        data: expect.objectContaining({ calendarDate: '2025-01-15' }),
        external_id: 'garmin-summary-2025-01-15',
        record_type: 'garmin_daily_summary',
        recorded_at: noonUTC('2025-01-15'),
        source: 'garmin',
      })
    })

    test('inserts all time series metrics', async () => {
      await processGarminData(user, 'dailySummary', makeSummary(), mockDeps)

      const points = vi.mocked(mockDeps.insertTimeSeries).mock.calls[0]![1]
      expect(points).toEqual(
        expect.arrayContaining([
          { metric: 'steps', source: 'garmin', time: noonUTC('2025-01-15'), unit: 'count', value: 8500 },
          { metric: 'distance', source: 'garmin', time: noonUTC('2025-01-15'), unit: 'm', value: 6200 },
          {
            metric: 'floors_climbed',
            source: 'garmin',
            time: noonUTC('2025-01-15'),
            unit: 'count',
            value: 10,
          },
          {
            metric: 'calories_active',
            source: 'garmin',
            time: noonUTC('2025-01-15'),
            unit: 'kcal',
            value: 450,
          },
          {
            metric: 'calories_total',
            source: 'garmin',
            time: noonUTC('2025-01-15'),
            unit: 'kcal',
            value: 2100,
          },
          {
            metric: 'resting_heart_rate',
            source: 'garmin',
            time: noonUTC('2025-01-15'),
            unit: 'bpm',
            value: 58,
          },
          { metric: 'stress_level', source: 'garmin', time: noonUTC('2025-01-15'), unit: 'score', value: 32 },
          { metric: 'spo2', source: 'garmin', time: noonUTC('2025-01-15'), unit: 'percent', value: 97 },
        ]),
      )
    })

    test('skips zero-value metrics', async () => {
      await processGarminData(
        user,
        'dailySummary',
        makeSummary({ floorsAscended: 0, totalSteps: 0 }),
        mockDeps,
      )

      const points = vi.mocked(mockDeps.insertTimeSeries).mock.calls[0]![1]
      const metrics = points.map((p: { metric: string }) => p.metric)
      expect(metrics).not.toContain('steps')
      expect(metrics).not.toContain('floors_climbed')
    })

    test('skips null metrics', async () => {
      await processGarminData(user, 'dailySummary', makeSummary({ averageSpo2: null }), mockDeps)

      const points = vi.mocked(mockDeps.insertTimeSeries).mock.calls[0]![1]
      const metrics = points.map((p: { metric: string }) => p.metric)
      expect(metrics).not.toContain('spo2')
    })

    test('returns 0 for missing calendarDate', async () => {
      expect(await processGarminData(user, 'dailySummary', { calendarDate: null }, mockDeps)).toBe(0)
      expect(mockDeps.insertRawRecord).not.toHaveBeenCalled()
    })

    test('returns 1 on success', async () => {
      expect(await processGarminData(user, 'dailySummary', makeSummary(), mockDeps)).toBe(1)
    })

    test('does not call insertTimeSeries when all metrics are zero', async () => {
      await processGarminData(
        user,
        'dailySummary',
        makeSummary({
          activeKilocalories: 0,
          averageSpo2: 0,
          averageStressLevel: 0,
          floorsAscended: 0,
          restingHeartRate: 0,
          totalDistanceMeters: 0,
          totalKilocalories: 0,
          totalSteps: 0,
        }),
        mockDeps,
      )

      expect(mockDeps.insertTimeSeries).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Heart Rate
  // ==========================================================================

  describe('heartRate', () => {
    test('inserts raw record with correct fields', async () => {
      const data = {
        calendarDate: '2025-01-15',
        heartRateValues: [[1736899200000, 72]],
      }

      await processGarminData(user, 'heartRate', data, mockDeps)

      expect(mockDeps.insertRawRecord).toHaveBeenCalledWith(user, {
        data: expect.objectContaining({ calendarDate: '2025-01-15' }),
        external_id: 'garmin-hr-2025-01-15',
        record_type: 'garmin_heart_rate',
        recorded_at: noonUTC('2025-01-15'),
        source: 'garmin',
      })
    })

    test('processes heartRateValues as time series', async () => {
      const data = {
        calendarDate: '2025-01-15',
        heartRateValues: [
          [1736899200000, 72],
          [1736899260000, 75],
        ],
      }

      await processGarminData(user, 'heartRate', data, mockDeps)

      const points = vi.mocked(mockDeps.insertTimeSeries).mock.calls[0]![1]
      expect(points).toEqual([
        { metric: 'heart_rate', source: 'garmin', time: new Date(1736899200000), unit: 'bpm', value: 72 },
        { metric: 'heart_rate', source: 'garmin', time: new Date(1736899260000), unit: 'bpm', value: 75 },
      ])
    })

    test('skips zero heart rate values', async () => {
      const data = {
        calendarDate: '2025-01-15',
        heartRateValues: [
          [1736899200000, 0],
          [1736899260000, 72],
        ],
      }

      await processGarminData(user, 'heartRate', data, mockDeps)

      const points = vi.mocked(mockDeps.insertTimeSeries).mock.calls[0]![1]
      expect(points).toHaveLength(1)
      expect(points[0].value).toBe(72)
    })

    test('returns 0 for missing calendarDate', async () => {
      expect(await processGarminData(user, 'heartRate', { heartRateValues: [] }, mockDeps)).toBe(0)
      expect(mockDeps.insertRawRecord).not.toHaveBeenCalled()
    })

    test('returns 0 when no valid HR points are produced', async () => {
      const data = {
        calendarDate: '2025-01-15',
        heartRateValues: null,
      }

      const result = await processGarminData(user, 'heartRate', data, mockDeps)
      expect(result).toBe(0)
      expect(mockDeps.insertTimeSeries).not.toHaveBeenCalled()
    })

    test('returns 1 when HR points are produced', async () => {
      const data = {
        calendarDate: '2025-01-15',
        heartRateValues: [[1736899200000, 72]],
      }

      expect(await processGarminData(user, 'heartRate', data, mockDeps)).toBe(1)
    })
  })

  // ==========================================================================
  // HRV
  // ==========================================================================

  describe('hrv', () => {
    test('inserts raw record with correct fields', async () => {
      const data = { calendarDate: '2025-01-15', lastNightAvg: 42, weeklyAvg: 40 }

      await processGarminData(user, 'hrv', data, mockDeps)

      expect(mockDeps.insertRawRecord).toHaveBeenCalledWith(user, {
        data: expect.objectContaining({ calendarDate: '2025-01-15' }),
        external_id: 'garmin-hrv-2025-01-15',
        record_type: 'garmin_hrv',
        recorded_at: noonUTC('2025-01-15'),
        source: 'garmin',
      })
    })

    test('inserts hrv_rmssd time series point', async () => {
      const data = { calendarDate: '2025-01-15', lastNightAvg: 42 }

      await processGarminData(user, 'hrv', data, mockDeps)

      expect(mockDeps.insertTimeSeries).toHaveBeenCalledWith(user, [
        { metric: 'hrv_rmssd', source: 'garmin', time: noonUTC('2025-01-15'), unit: 'ms', value: 42 },
      ])
    })

    test('skips time series when lastNightAvg is 0', async () => {
      const data = { calendarDate: '2025-01-15', lastNightAvg: 0 }

      await processGarminData(user, 'hrv', data, mockDeps)

      expect(mockDeps.insertTimeSeries).not.toHaveBeenCalled()
    })

    test('returns 0 for missing calendarDate', async () => {
      expect(await processGarminData(user, 'hrv', { lastNightAvg: 42 }, mockDeps)).toBe(0)
      expect(mockDeps.insertRawRecord).not.toHaveBeenCalled()
    })

    test('returns 1 on success', async () => {
      expect(
        await processGarminData(user, 'hrv', { calendarDate: '2025-01-15', lastNightAvg: 42 }, mockDeps),
      ).toBe(1)
    })
  })

  // ==========================================================================
  // Sleep
  // ==========================================================================

  describe('sleep', () => {
    const makeSleepData = (overrides: Record<string, unknown> = {}) => ({
      avgOvernightHrv: 45,
      dailySleepDTO: {
        awakeSleepSeconds: 1800,
        calendarDate: '2025-01-15',
        deepSleepSeconds: 3600,
        lightSleepSeconds: 7200,
        remSleepSeconds: 5400,
        sleepEndTimestampGMT: 1736924400000,
        sleepScores: { overall: { value: 82 } },
        sleepStartTimestampGMT: 1736899200000,
      },
      restingHeartRate: 52,
      sleepHeartRate: [{ startGMT: '2025-01-15T00:00:00', value: 55 }],
      ...overrides,
    })

    test('inserts raw record with correct fields', async () => {
      await processGarminData(user, 'sleep', makeSleepData(), mockDeps)

      expect(mockDeps.insertRawRecord).toHaveBeenCalledWith(user, {
        data: expect.objectContaining({ dailySleepDTO: expect.any(Object) }),
        external_id: 'garmin-sleep-2025-01-15',
        record_type: 'garmin_sleep',
        recorded_at: noonUTC('2025-01-15'),
        source: 'garmin',
      })
    })

    test('creates sleep activity with correct times and data', async () => {
      await processGarminData(user, 'sleep', makeSleepData(), mockDeps)

      expect(mockDeps.insertActivity).toHaveBeenCalledWith(user, {
        activity_type: 'sleep',
        data: {
          awake_seconds: 1800,
          deep_sleep_seconds: 3600,
          light_sleep_seconds: 7200,
          rem_sleep_seconds: 5400,
          sleep_score: 82,
        },
        end_time: new Date(1736924400000),
        source: 'garmin',
        start_time: new Date(1736899200000),
        title: 'Sleep',
      })
    })

    test('inserts sleep_score, resting_heart_rate, and hrv_rmssd time series', async () => {
      await processGarminData(user, 'sleep', makeSleepData(), mockDeps)

      const points = vi.mocked(mockDeps.insertTimeSeries).mock.calls[0]![1]
      expect(points).toEqual(
        expect.arrayContaining([
          { metric: 'sleep_score', source: 'garmin', time: noonUTC('2025-01-15'), unit: 'score', value: 82 },
          {
            metric: 'resting_heart_rate',
            source: 'garmin',
            time: noonUTC('2025-01-15'),
            unit: 'bpm',
            value: 52,
          },
          { metric: 'hrv_rmssd', source: 'garmin', time: noonUTC('2025-01-15'), unit: 'ms', value: 45 },
        ]),
      )
    })

    test('inserts heart rate samples from sleepHeartRate', async () => {
      await processGarminData(user, 'sleep', makeSleepData(), mockDeps)

      const points = vi.mocked(mockDeps.insertTimeSeries).mock.calls[0]![1]
      expect(points).toEqual(
        expect.arrayContaining([
          {
            metric: 'heart_rate',
            source: 'garmin',
            time: new Date('2025-01-15T00:00:00'),
            unit: 'bpm',
            value: 55,
          },
        ]),
      )
    })

    test('skips restingHeartRate when 0', async () => {
      await processGarminData(user, 'sleep', makeSleepData({ restingHeartRate: 0 }), mockDeps)

      const points = vi.mocked(mockDeps.insertTimeSeries).mock.calls[0]![1]
      const metrics = points.map((p: { metric: string }) => p.metric)
      expect(metrics).not.toContain('resting_heart_rate')
    })

    test('skips avgOvernightHrv when 0', async () => {
      await processGarminData(user, 'sleep', makeSleepData({ avgOvernightHrv: 0 }), mockDeps)

      const points = vi.mocked(mockDeps.insertTimeSeries).mock.calls[0]![1]
      const metrics = points.map((p: { metric: string }) => p.metric)
      expect(metrics).not.toContain('hrv_rmssd')
    })

    test('does not insert activity when sleep timestamps are missing', async () => {
      const data = makeSleepData({
        dailySleepDTO: {
          calendarDate: '2025-01-15',
          sleepEndTimestampGMT: null,
          sleepScores: { overall: { value: 80 } },
          sleepStartTimestampGMT: null,
        },
      })

      await processGarminData(user, 'sleep', data, mockDeps)

      expect(mockDeps.insertActivity).not.toHaveBeenCalled()
    })

    test('returns 0 for missing calendarDate in dailySleepDTO', async () => {
      const data = makeSleepData({
        dailySleepDTO: { calendarDate: null },
      })

      expect(await processGarminData(user, 'sleep', data, mockDeps)).toBe(0)
      expect(mockDeps.insertRawRecord).not.toHaveBeenCalled()
    })

    test('returns 1 on success', async () => {
      expect(await processGarminData(user, 'sleep', makeSleepData(), mockDeps)).toBe(1)
    })

    const makeSleepDataWithNaps = (naps: Record<string, unknown>[] | null) =>
      makeSleepData({
        dailySleepDTO: {
          awakeSleepSeconds: 1800,
          calendarDate: '2025-01-15',
          dailyNapDTOS: naps,
          deepSleepSeconds: 3600,
          lightSleepSeconds: 7200,
          remSleepSeconds: 5400,
          sleepEndTimestampGMT: 1736924400000,
          sleepScores: { overall: { value: 82 } },
          sleepStartTimestampGMT: 1736899200000,
        },
      })

    test('creates a nap activity for each entry in dailySleepDTO.dailyNapDTOS', async () => {
      const data = makeSleepDataWithNaps([
        {
          calendarDate: '2025-01-15',
          napEndTimestampGMT: '2025-01-15T12:39:46',
          napFeedback: 'IDEAL_DURATION_LOW_NEED',
          napSource: 0,
          napStartTimestampGMT: '2025-01-15T12:17:46',
          napTimeSec: 1320,
        },
      ])

      await processGarminData(user, 'sleep', data, mockDeps)

      expect(mockDeps.insertActivity).toHaveBeenCalledWith(user, {
        activity_type: 'nap',
        data: { nap_feedback: 'IDEAL_DURATION_LOW_NEED', nap_time_seconds: 1320 },
        end_time: new Date('2025-01-15T12:39:46Z'),
        external_id: 'garmin-nap-2025-01-15T12:17:46',
        source: 'garmin',
        start_time: new Date('2025-01-15T12:17:46Z'),
        title: 'Nap',
      })
    })

    test('parses nap timestamps that include a timezone offset', async () => {
      // Real Garmin responses return "...+02:00" suffixes despite the field name.
      const data = makeSleepDataWithNaps([
        {
          calendarDate: '2026-05-06',
          napEndTimestampGMT: '2026-05-06T15:00:20+02:00',
          napFeedback: 'IDEAL_TIMING_IDEAL_DURATION_LOW_NEED',
          napStartTimestampGMT: '2026-05-06T14:35:32+02:00',
          napTimeSec: 1488,
        },
      ])

      await processGarminData(user, 'sleep', data, mockDeps)

      expect(mockDeps.insertActivity).toHaveBeenCalledWith(user, {
        activity_type: 'nap',
        data: { nap_feedback: 'IDEAL_TIMING_IDEAL_DURATION_LOW_NEED', nap_time_seconds: 1488 },
        end_time: new Date('2026-05-06T15:00:20+02:00'),
        external_id: 'garmin-nap-2026-05-06T14:35:32+02:00',
        source: 'garmin',
        start_time: new Date('2026-05-06T14:35:32+02:00'),
        title: 'Nap',
      })
    })

    test('does not read dailyNapDTOS from the top level (real API nests it under dailySleepDTO)', async () => {
      // Top-level dailyNapDTOS must be ignored; only dailySleepDTO.dailyNapDTOS counts.
      const data = makeSleepData({
        dailyNapDTOS: [
          {
            calendarDate: '2025-01-15',
            napEndTimestampGMT: '2025-01-15T12:39:46',
            napStartTimestampGMT: '2025-01-15T12:17:46',
            napTimeSec: 1320,
          },
        ],
      })

      await processGarminData(user, 'sleep', data, mockDeps)

      expect(mockDeps.insertActivity).toHaveBeenCalledTimes(1)
      const activity = vi.mocked(mockDeps.insertActivity).mock.calls[0]![1]
      expect(activity.activity_type).toBe('sleep')
    })

    test('inserts both the sleep activity and multiple naps', async () => {
      const data = makeSleepDataWithNaps([
        {
          calendarDate: '2025-01-15',
          napEndTimestampGMT: '2025-01-15T13:00:00',
          napStartTimestampGMT: '2025-01-15T12:30:00',
          napTimeSec: 1800,
        },
        {
          calendarDate: '2025-01-15',
          napEndTimestampGMT: '2025-01-15T16:30:00',
          napStartTimestampGMT: '2025-01-15T16:00:00',
          napTimeSec: 1800,
        },
      ])

      await processGarminData(user, 'sleep', data, mockDeps)

      // 1 sleep + 2 naps
      expect(mockDeps.insertActivity).toHaveBeenCalledTimes(3)
      const activityTypes = vi
        .mocked(mockDeps.insertActivity)
        .mock.calls.map((call) => (call[1] as { activity_type: string }).activity_type)
      expect(activityTypes).toEqual(['sleep', 'nap', 'nap'])
    })

    test('skips nap entries with missing timestamps', async () => {
      const data = makeSleepDataWithNaps([
        {
          calendarDate: '2025-01-15',
          napEndTimestampGMT: null,
          napStartTimestampGMT: null,
          napTimeSec: 0,
        },
      ])

      await processGarminData(user, 'sleep', data, mockDeps)

      // Only the main sleep activity should be inserted.
      expect(mockDeps.insertActivity).toHaveBeenCalledTimes(1)
      const activity = vi.mocked(mockDeps.insertActivity).mock.calls[0]![1]
      expect(activity.activity_type).toBe('sleep')
    })

    test('handles null/missing dailyNapDTOS without error', async () => {
      const withNullNaps = makeSleepDataWithNaps(null)
      await expect(processGarminData(user, 'sleep', withNullNaps, mockDeps)).resolves.toBe(1)

      vi.clearAllMocks()

      const withoutField = makeSleepData()
      await expect(processGarminData(user, 'sleep', withoutField, mockDeps)).resolves.toBe(1)
    })
  })

  // ==========================================================================
  // Stress
  // ==========================================================================

  describe('stress', () => {
    test('inserts raw record with correct fields', async () => {
      const data = { calendarDate: '2025-01-15', overallStressLevel: 38, stressValuesArray: null }

      await processGarminData(user, 'stress', data, mockDeps)

      expect(mockDeps.insertRawRecord).toHaveBeenCalledWith(user, {
        data: expect.objectContaining({ calendarDate: '2025-01-15' }),
        external_id: 'garmin-stress-2025-01-15',
        record_type: 'garmin_stress',
        recorded_at: noonUTC('2025-01-15'),
        source: 'garmin',
      })
    })

    test('inserts granular stress time series from stressValuesArray', async () => {
      const data = {
        calendarDate: '2025-01-15',
        overallStressLevel: 38,
        stressValuesArray: [
          [1736935200000, 25],
          [1736935500000, 42],
          [1736935800000, -1],
          [1736936100000, 0],
          [1736936400000, 55],
        ] as [number, number][],
      }

      await processGarminData(user, 'stress', data, mockDeps)

      expect(mockDeps.insertTimeSeries).toHaveBeenCalledWith(user, [
        { metric: 'stress_level', source: 'garmin', time: new Date(1736935200000), unit: 'score', value: 25 },
        { metric: 'stress_level', source: 'garmin', time: new Date(1736935500000), unit: 'score', value: 42 },
        { metric: 'stress_level', source: 'garmin', time: new Date(1736936400000), unit: 'score', value: 55 },
      ])
    })

    test('falls back to overallStressLevel when stressValuesArray is null', async () => {
      const data = { calendarDate: '2025-01-15', overallStressLevel: 38, stressValuesArray: null }

      await processGarminData(user, 'stress', data, mockDeps)

      expect(mockDeps.insertTimeSeries).toHaveBeenCalledWith(user, [
        { metric: 'stress_level', source: 'garmin', time: noonUTC('2025-01-15'), unit: 'score', value: 38 },
      ])
    })

    test('skips time series when no valid data', async () => {
      const data = { calendarDate: '2025-01-15', overallStressLevel: 0, stressValuesArray: null }

      await processGarminData(user, 'stress', data, mockDeps)

      expect(mockDeps.insertTimeSeries).not.toHaveBeenCalled()
    })

    test('filters out negative and zero stress values', async () => {
      const data = {
        calendarDate: '2025-01-15',
        overallStressLevel: 0,
        stressValuesArray: [
          [1736935200000, -1],
          [1736935500000, -2],
          [1736935800000, 0],
        ] as [number, number][],
      }

      await processGarminData(user, 'stress', data, mockDeps)

      expect(mockDeps.insertTimeSeries).not.toHaveBeenCalled()
    })

    test('returns 0 for missing calendarDate', async () => {
      expect(await processGarminData(user, 'stress', { overallStressLevel: 38 }, mockDeps)).toBe(0)
      expect(mockDeps.insertRawRecord).not.toHaveBeenCalled()
    })

    test('returns 1 on success', async () => {
      expect(
        await processGarminData(
          user,
          'stress',
          { calendarDate: '2025-01-15', overallStressLevel: 38, stressValuesArray: null },
          mockDeps,
        ),
      ).toBe(1)
    })
  })

  // ==========================================================================
  // Body Battery
  // ==========================================================================

  describe('bodyBattery', () => {
    test('inserts raw record per day', async () => {
      const data = [{ bodyBatteryValuesArray: null, charged: 60, date: '2025-01-15', drained: 40 }]

      await processGarminData(user, 'bodyBattery', data, mockDeps)

      expect(mockDeps.insertRawRecord).toHaveBeenCalledWith(user, {
        data: expect.objectContaining({ date: '2025-01-15' }),
        external_id: 'garmin-bb-2025-01-15',
        record_type: 'garmin_body_battery',
        recorded_at: noonUTC('2025-01-15'),
        source: 'garmin',
      })
    })

    test('inserts time series from bodyBatteryValuesArray', async () => {
      const data = [
        {
          bodyBatteryValuesArray: [
            [1736899200000, 75],
            [1736902800000, 68],
          ],
          charged: 60,
          date: '2025-01-15',
          drained: 40,
        },
      ]

      await processGarminData(user, 'bodyBattery', data, mockDeps)

      const points = vi.mocked(mockDeps.insertTimeSeries).mock.calls[0]![1]
      expect(points).toEqual([
        { metric: 'body_battery', source: 'garmin', time: new Date(1736899200000), unit: 'score', value: 75 },
        { metric: 'body_battery', source: 'garmin', time: new Date(1736902800000), unit: 'score', value: 68 },
      ])
    })

    test('falls back to charged value when no bodyBatteryValuesArray', async () => {
      const data = [{ bodyBatteryValuesArray: null, charged: 60, date: '2025-01-15', drained: 40 }]

      await processGarminData(user, 'bodyBattery', data, mockDeps)

      expect(mockDeps.insertTimeSeries).toHaveBeenCalledWith(user, [
        { metric: 'body_battery', source: 'garmin', time: noonUTC('2025-01-15'), unit: 'score', value: 60 },
      ])
    })

    test('does not fall back when bodyBatteryValuesArray has data', async () => {
      const data = [
        {
          bodyBatteryValuesArray: [[1736899200000, 75]],
          charged: 60,
          date: '2025-01-15',
          drained: 40,
        },
      ]

      await processGarminData(user, 'bodyBattery', data, mockDeps)

      const points = vi.mocked(mockDeps.insertTimeSeries).mock.calls[0]![1]
      // Should only have the array value, not the charged fallback
      expect(points).toHaveLength(1)
      expect(points[0].value).toBe(75)
    })

    test('processes multiple days and returns count', async () => {
      const data = [
        { bodyBatteryValuesArray: null, charged: 60, date: '2025-01-15', drained: 40 },
        { bodyBatteryValuesArray: null, charged: 55, date: '2025-01-16', drained: 45 },
      ]

      const result = await processGarminData(user, 'bodyBattery', data, mockDeps)
      expect(result).toBe(2)
      expect(mockDeps.insertRawRecord).toHaveBeenCalledTimes(2)
    })

    test('returns 0 for empty array', async () => {
      expect(await processGarminData(user, 'bodyBattery', [], mockDeps)).toBe(0)
      expect(mockDeps.insertRawRecord).not.toHaveBeenCalled()
    })

    test('returns 0 for non-array data', async () => {
      expect(await processGarminData(user, 'bodyBattery', 'not-an-array', mockDeps)).toBe(0)
      expect(mockDeps.insertRawRecord).not.toHaveBeenCalled()
    })

    test('skips days with missing date', async () => {
      const data = [
        { bodyBatteryValuesArray: null, charged: 60, date: null, drained: 40 },
        { bodyBatteryValuesArray: null, charged: 55, date: '2025-01-16', drained: 45 },
      ]

      const result = await processGarminData(user, 'bodyBattery', data, mockDeps)
      expect(result).toBe(1)
      expect(mockDeps.insertRawRecord).toHaveBeenCalledTimes(1)
    })

    test('does not insert time series when charged is 0 and no valuesArray', async () => {
      const data = [{ bodyBatteryValuesArray: null, charged: 0, date: '2025-01-15', drained: 0 }]

      await processGarminData(user, 'bodyBattery', data, mockDeps)

      expect(mockDeps.insertTimeSeries).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Activities (exercise)
  // ==========================================================================

  describe('activities', () => {
    const makeActivity = (overrides: Record<string, unknown> = {}) => ({
      activityId: 12345,
      activityName: 'Morning Run',
      activityType: { typeKey: 'running' },
      averageHR: 145,
      beginTimestamp: 1736924400000,
      calories: 350,
      distance: 5000,
      duration: 1800,
      elapsedDuration: 1800,
      elevationGain: 50,
      maxHR: 175,
      startTimeGMT: '2025-01-15T07:00:00.000',
      steps: 6000,
      vO2MaxValue: 48.5,
      ...overrides,
    })

    test('inserts raw record with correct fields', async () => {
      await processGarminData(user, 'activities', [makeActivity()], mockDeps)

      expect(mockDeps.insertRawRecord).toHaveBeenCalledWith(user, {
        data: expect.objectContaining({ activityId: 12345 }),
        external_id: 'garmin-activity-12345',
        record_type: 'garmin_activity',
        recorded_at: new Date('2025-01-15T07:00:00.000'),
        source: 'garmin',
      })
    })

    test('creates exercise activity with correct fields', async () => {
      await processGarminData(user, 'activities', [makeActivity()], mockDeps)

      const startTime = new Date('2025-01-15T07:00:00.000')
      const endTime = new Date(startTime.getTime() + 1800 * 1000)

      expect(mockDeps.insertActivity).toHaveBeenCalledWith(user, {
        activity_type: 'running',
        data: {
          average_hr: 145,
          calories: 350,
          distance: 5000,
          elevation_gain: 50,
          garmin_activity_id: 12345,
          max_hr: 175,
          steps: 6000,
          vo2_max: 48.5,
        },
        end_time: endTime,
        source: 'garmin',
        start_time: startTime,
        title: 'Morning Run',
      })
    })

    test('inserts vo2_max time series when value > 0', async () => {
      await processGarminData(user, 'activities', [makeActivity()], mockDeps)

      expect(mockDeps.insertTimeSeries).toHaveBeenCalledWith(user, [
        {
          metric: 'vo2_max',
          source: 'garmin',
          time: new Date('2025-01-15T07:00:00.000'),
          unit: 'mL/kg/min',
          value: 48.5,
        },
      ])
    })

    test('skips vo2_max time series when value is 0', async () => {
      await processGarminData(user, 'activities', [makeActivity({ vO2MaxValue: 0 })], mockDeps)

      expect(mockDeps.insertTimeSeries).not.toHaveBeenCalled()
    })

    test('uses activityType.typeKey as title when activityName is missing', async () => {
      await processGarminData(user, 'activities', [makeActivity({ activityName: '' })], mockDeps)

      const activityArg = vi.mocked(mockDeps.insertActivity).mock.calls[0]![1]
      expect(activityArg.title).toBe('running')
    })

    test('uses "unknown" as activity_type when activityType is missing', async () => {
      await processGarminData(user, 'activities', [makeActivity({ activityType: null })], mockDeps)

      const activityArg = vi.mocked(mockDeps.insertActivity).mock.calls[0]![1]
      expect(activityArg.activity_type).toBe('unknown')
    })

    test('processes multiple activities and returns count', async () => {
      const data = [makeActivity({ activityId: 1 }), makeActivity({ activityId: 2 })]

      const result = await processGarminData(user, 'activities', data, mockDeps)
      expect(result).toBe(2)
      expect(mockDeps.insertRawRecord).toHaveBeenCalledTimes(2)
      expect(mockDeps.insertActivity).toHaveBeenCalledTimes(2)
    })

    test('returns 0 for empty array', async () => {
      expect(await processGarminData(user, 'activities', [], mockDeps)).toBe(0)
      expect(mockDeps.insertRawRecord).not.toHaveBeenCalled()
    })

    test('returns 0 for non-array data', async () => {
      expect(await processGarminData(user, 'activities', 'not-array', mockDeps)).toBe(0)
    })

    test('skips activities without activityId', async () => {
      const data = [makeActivity({ activityId: null }), makeActivity({ activityId: 99 })]

      const result = await processGarminData(user, 'activities', data, mockDeps)
      expect(result).toBe(1)
      expect(mockDeps.insertRawRecord).toHaveBeenCalledTimes(1)
    })

    test('calculates end time from duration', async () => {
      await processGarminData(user, 'activities', [makeActivity({ duration: 3600 })], mockDeps)

      const activityArg = vi.mocked(mockDeps.insertActivity).mock.calls[0]![1]
      const startTime = new Date('2025-01-15T07:00:00.000')
      const expectedEnd = new Date(startTime.getTime() + 3600 * 1000)
      expect(activityArg.end_time).toEqual(expectedEnd)
    })

    test('maps meditation typeKey to meditation activity_type', async () => {
      await processGarminData(
        user,
        'activities',
        [makeActivity({ activityType: { typeKey: 'meditation' }, activityName: 'Meditation' })],
        mockDeps,
      )

      const activityArg = vi.mocked(mockDeps.insertActivity).mock.calls[0]![1]
      expect(activityArg.activity_type).toBe('meditation')
      expect(activityArg.title).toBe('Meditation')
    })

    test('maps breathwork typeKey to meditation activity_type', async () => {
      await processGarminData(
        user,
        'activities',
        [makeActivity({ activityType: { typeKey: 'breathwork' }, activityName: 'Breathwork' })],
        mockDeps,
      )

      const activityArg = vi.mocked(mockDeps.insertActivity).mock.calls[0]![1]
      expect(activityArg.activity_type).toBe('meditation')
    })

    test('maps running typeKey to running activity_type', async () => {
      await processGarminData(user, 'activities', [makeActivity()], mockDeps)

      const activityArg = vi.mocked(mockDeps.insertActivity).mock.calls[0]![1]
      expect(activityArg.activity_type).toBe('running')
    })

    test('calls deleteGarminActivityWithWrongType before insert', async () => {
      await processGarminData(
        user,
        'activities',
        [makeActivity({ activityType: { typeKey: 'meditation' } })],
        mockDeps,
      )

      expect(mockDeps.deleteGarminActivityWithWrongType).toHaveBeenCalledWith(user, 12345, 'meditation')
      // Verify delete is called before insert
      const deleteOrder = vi.mocked(mockDeps.deleteGarminActivityWithWrongType).mock.invocationCallOrder[0]
      const insertOrder = vi.mocked(mockDeps.insertActivity).mock.invocationCallOrder[0]
      expect(deleteOrder).toBeLessThan(insertOrder!)
    })
  })

  // ==========================================================================
  // SpO2
  // ==========================================================================

  describe('spo2', () => {
    test('inserts raw record with correct fields', async () => {
      const data = { averageSpO2: 97, calendarDate: '2025-01-15' }

      await processGarminData(user, 'spo2', data, mockDeps)

      expect(mockDeps.insertRawRecord).toHaveBeenCalledWith(user, {
        data: expect.objectContaining({ calendarDate: '2025-01-15' }),
        external_id: 'garmin-spo2-2025-01-15',
        record_type: 'garmin_spo2',
        recorded_at: noonUTC('2025-01-15'),
        source: 'garmin',
      })
    })

    test('inserts spo2 time series point', async () => {
      const data = { averageSpO2: 97, calendarDate: '2025-01-15' }

      await processGarminData(user, 'spo2', data, mockDeps)

      expect(mockDeps.insertTimeSeries).toHaveBeenCalledWith(user, [
        { metric: 'spo2', source: 'garmin', time: noonUTC('2025-01-15'), unit: 'percent', value: 97 },
      ])
    })

    test('skips time series when averageSpO2 is 0', async () => {
      const data = { averageSpO2: 0, calendarDate: '2025-01-15' }

      await processGarminData(user, 'spo2', data, mockDeps)

      expect(mockDeps.insertTimeSeries).not.toHaveBeenCalled()
    })

    test('returns 0 for missing calendarDate', async () => {
      expect(await processGarminData(user, 'spo2', { averageSpO2: 97 }, mockDeps)).toBe(0)
      expect(mockDeps.insertRawRecord).not.toHaveBeenCalled()
    })

    test('returns 1 on success', async () => {
      expect(
        await processGarminData(user, 'spo2', { averageSpO2: 97, calendarDate: '2025-01-15' }, mockDeps),
      ).toBe(1)
    })
  })

  // ==========================================================================
  // Respiration
  // ==========================================================================

  describe('respiration', () => {
    test('inserts raw record with correct fields', async () => {
      const data = { avgWakingRespirationValue: 15.5, calendarDate: '2025-01-15' }

      await processGarminData(user, 'respiration', data, mockDeps)

      expect(mockDeps.insertRawRecord).toHaveBeenCalledWith(user, {
        data: expect.objectContaining({ calendarDate: '2025-01-15' }),
        external_id: 'garmin-resp-2025-01-15',
        record_type: 'garmin_respiration',
        recorded_at: noonUTC('2025-01-15'),
        source: 'garmin',
      })
    })

    test('inserts respiratory_rate time series point', async () => {
      const data = { avgWakingRespirationValue: 15.5, calendarDate: '2025-01-15' }

      await processGarminData(user, 'respiration', data, mockDeps)

      expect(mockDeps.insertTimeSeries).toHaveBeenCalledWith(user, [
        {
          metric: 'respiratory_rate',
          source: 'garmin',
          time: noonUTC('2025-01-15'),
          unit: 'brpm',
          value: 15.5,
        },
      ])
    })

    test('skips time series when avgWakingRespirationValue is 0', async () => {
      const data = { avgWakingRespirationValue: 0, calendarDate: '2025-01-15' }

      await processGarminData(user, 'respiration', data, mockDeps)

      expect(mockDeps.insertTimeSeries).not.toHaveBeenCalled()
    })

    test('returns 0 for missing calendarDate', async () => {
      expect(
        await processGarminData(user, 'respiration', { avgWakingRespirationValue: 15.5 }, mockDeps),
      ).toBe(0)
      expect(mockDeps.insertRawRecord).not.toHaveBeenCalled()
    })

    test('returns 1 on success', async () => {
      expect(
        await processGarminData(
          user,
          'respiration',
          { avgWakingRespirationValue: 15.5, calendarDate: '2025-01-15' },
          mockDeps,
        ),
      ).toBe(1)
    })
  })

  // ==========================================================================
  // Training Readiness
  // ==========================================================================

  describe('trainingReadiness', () => {
    test('inserts raw record with correct fields', async () => {
      const data = { calendarDate: '2025-01-15', level: 'HIGH', overallScore: 72 }

      await processGarminData(user, 'trainingReadiness', data, mockDeps)

      expect(mockDeps.insertRawRecord).toHaveBeenCalledWith(user, {
        data: expect.objectContaining({ calendarDate: '2025-01-15' }),
        external_id: 'garmin-tr-2025-01-15',
        record_type: 'garmin_training_readiness',
        recorded_at: noonUTC('2025-01-15'),
        source: 'garmin',
      })
    })

    test('inserts training_readiness time series point', async () => {
      const data = { calendarDate: '2025-01-15', level: 'HIGH', overallScore: 72 }

      await processGarminData(user, 'trainingReadiness', data, mockDeps)

      expect(mockDeps.insertTimeSeries).toHaveBeenCalledWith(user, [
        {
          metric: 'training_readiness',
          source: 'garmin',
          time: noonUTC('2025-01-15'),
          unit: 'score',
          value: 72,
        },
      ])
    })

    test('skips time series when overallScore is 0', async () => {
      const data = { calendarDate: '2025-01-15', level: 'LOW', overallScore: 0 }

      await processGarminData(user, 'trainingReadiness', data, mockDeps)

      expect(mockDeps.insertTimeSeries).not.toHaveBeenCalled()
    })

    test('skips time series when overallScore is null', async () => {
      const data = { calendarDate: '2025-01-15', level: 'LOW', overallScore: null }

      await processGarminData(user, 'trainingReadiness', data, mockDeps)

      expect(mockDeps.insertTimeSeries).not.toHaveBeenCalled()
    })

    test('returns 0 for missing calendarDate', async () => {
      expect(await processGarminData(user, 'trainingReadiness', { overallScore: 72 }, mockDeps)).toBe(0)
      expect(mockDeps.insertRawRecord).not.toHaveBeenCalled()
    })

    test('returns 1 on success', async () => {
      expect(
        await processGarminData(
          user,
          'trainingReadiness',
          { calendarDate: '2025-01-15', level: 'HIGH', overallScore: 72 },
          mockDeps,
        ),
      ).toBe(1)
    })
  })

  // ==========================================================================
  // Intensity Minutes
  // ==========================================================================

  describe('intensityMinutes', () => {
    test('inserts raw record with correct fields', async () => {
      const data = { calendarDate: '2025-01-15', moderateIntensityMinutes: 30, vigorousIntensityMinutes: 15 }

      await processGarminData(user, 'intensityMinutes', data, mockDeps)

      expect(mockDeps.insertRawRecord).toHaveBeenCalledWith(user, {
        data: expect.objectContaining({ calendarDate: '2025-01-15' }),
        external_id: 'garmin-im-2025-01-15',
        record_type: 'garmin_intensity_minutes',
        recorded_at: noonUTC('2025-01-15'),
        source: 'garmin',
      })
    })

    test('inserts intensity_minutes = moderate + vigorous*2', async () => {
      const data = { calendarDate: '2025-01-15', moderateIntensityMinutes: 30, vigorousIntensityMinutes: 15 }

      await processGarminData(user, 'intensityMinutes', data, mockDeps)

      // 30 + 15*2 = 60
      expect(mockDeps.insertTimeSeries).toHaveBeenCalledWith(user, [
        {
          metric: 'intensity_minutes',
          source: 'garmin',
          time: noonUTC('2025-01-15'),
          unit: 'min',
          value: 60,
        },
      ])
    })

    test('handles only moderate minutes', async () => {
      const data = { calendarDate: '2025-01-15', moderateIntensityMinutes: 45, vigorousIntensityMinutes: 0 }

      await processGarminData(user, 'intensityMinutes', data, mockDeps)

      expect(mockDeps.insertTimeSeries).toHaveBeenCalledWith(user, [
        {
          metric: 'intensity_minutes',
          source: 'garmin',
          time: noonUTC('2025-01-15'),
          unit: 'min',
          value: 45,
        },
      ])
    })

    test('handles only vigorous minutes', async () => {
      const data = { calendarDate: '2025-01-15', moderateIntensityMinutes: 0, vigorousIntensityMinutes: 20 }

      await processGarminData(user, 'intensityMinutes', data, mockDeps)

      // 0 + 20*2 = 40
      expect(mockDeps.insertTimeSeries).toHaveBeenCalledWith(user, [
        {
          metric: 'intensity_minutes',
          source: 'garmin',
          time: noonUTC('2025-01-15'),
          unit: 'min',
          value: 40,
        },
      ])
    })

    test('skips time series when both are 0', async () => {
      const data = { calendarDate: '2025-01-15', moderateIntensityMinutes: 0, vigorousIntensityMinutes: 0 }

      await processGarminData(user, 'intensityMinutes', data, mockDeps)

      expect(mockDeps.insertTimeSeries).not.toHaveBeenCalled()
    })

    test('returns 0 for missing calendarDate', async () => {
      expect(
        await processGarminData(
          user,
          'intensityMinutes',
          { moderateIntensityMinutes: 30, vigorousIntensityMinutes: 15 },
          mockDeps,
        ),
      ).toBe(0)
      expect(mockDeps.insertRawRecord).not.toHaveBeenCalled()
    })

    test('returns 1 on success', async () => {
      expect(
        await processGarminData(
          user,
          'intensityMinutes',
          { calendarDate: '2025-01-15', moderateIntensityMinutes: 30, vigorousIntensityMinutes: 15 },
          mockDeps,
        ),
      ).toBe(1)
    })
  })
})

// ============================================================================
// processActivityDetail
// ============================================================================

describe('processActivityDetail', () => {
  const user = 'testuser'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const makeDetail = (
    overrides: Partial<GarminActivityDetailResponse> = {},
  ): GarminActivityDetailResponse => ({
    activityDetailMetrics: [
      { metrics: [70, 0, 14, 1700000001000, 25, 0, 0, 0, 0, 72, 0, 0] },
      { metrics: [69, 0, 13, 1700000002000, 30, 1, 1, 0, 0, 68, 0, 0] },
      { metrics: [68, 0, 12, 1700000003000, 20, 2, 2, 0, 0, 65, 0, 0] },
    ],
    activityId: 99999,
    metricDescriptors: [
      { key: 'directBodyBattery', metricsIndex: 0, unit: { key: 'dimensionless' } },
      { key: 'sumMovingDuration', metricsIndex: 1, unit: { key: 'second' } },
      { key: 'directRespirationRate', metricsIndex: 2, unit: { key: 'breathsPerMinute' } },
      { key: 'directTimestamp', metricsIndex: 3, unit: { key: 'gmt' } },
      { key: 'directCurrentStress', metricsIndex: 4, unit: { key: 'dimensionless' } },
      { key: 'sumDuration', metricsIndex: 5, unit: { key: 'second' } },
      { key: 'sumElapsedDuration', metricsIndex: 6, unit: { key: 'second' } },
      { key: 'connectIQDeveloperField-07', metricsIndex: 7, unit: { key: 'dimensionless' } },
      { key: 'connectIQDeveloperField-08', metricsIndex: 8, unit: { key: 'dimensionless' } },
      { key: 'directHeartRate', metricsIndex: 9, unit: { key: 'bpm' } },
      { key: 'connectIQDeveloperField-06', metricsIndex: 10, unit: { key: 'dimensionless' } },
      { key: 'connectIQDeveloperField-09', metricsIndex: 11, unit: { key: 'dimensionless' } },
    ],
    ...overrides,
  })

  test('extracts stress, HR, respiration, body_battery from detail data', async () => {
    await processActivityDetail(user, makeDetail(), mockDeps)

    const points = vi.mocked(mockDeps.insertTimeSeries).mock.calls[0]![1]

    // 3 entries × 4 metrics = 12 points
    expect(points).toHaveLength(12)

    // Check first entry
    const t1 = new Date(1700000001000)
    expect(points).toEqual(
      expect.arrayContaining([
        { metric: 'stress_level', source: 'garmin', time: t1, unit: 'score', value: 25 },
        { metric: 'heart_rate', source: 'garmin', time: t1, unit: 'bpm', value: 72 },
        { metric: 'respiratory_rate', source: 'garmin', time: t1, unit: 'brpm', value: 14 },
        { metric: 'body_battery', source: 'garmin', time: t1, unit: 'score', value: 70 },
      ]),
    )
  })

  test('stores raw record', async () => {
    await processActivityDetail(user, makeDetail(), mockDeps)

    expect(mockDeps.insertRawRecord).toHaveBeenCalledWith(user, {
      data: expect.objectContaining({ activityId: 99999 }),
      external_id: 'garmin-activity-detail-99999',
      record_type: 'garmin_activity_detail',
      recorded_at: new Date(1700000001000),
      source: 'garmin',
    })
  })

  test('returns number of time series points inserted', async () => {
    const result = await processActivityDetail(user, makeDetail(), mockDeps)
    expect(result).toBe(12)
  })

  test('skips metrics with zero values', async () => {
    const detail = makeDetail({
      activityDetailMetrics: [{ metrics: [0, 0, 0, 1700000001000, 0, 0, 0, 0, 0, 72, 0, 0] }],
    })

    await processActivityDetail(user, detail, mockDeps)

    const points = vi.mocked(mockDeps.insertTimeSeries).mock.calls[0]![1]
    // Only HR should be present (stress=0, resp=0, bb=0 are skipped)
    expect(points).toHaveLength(1)
    expect(points[0]).toMatchObject({ metric: 'heart_rate', value: 72 })
  })

  test('skips metrics with null values', async () => {
    const detail = makeDetail({
      activityDetailMetrics: [
        {
          metrics: [
            null as unknown as number,
            0,
            null as unknown as number,
            1700000001000,
            15,
            0,
            0,
            0,
            0,
            null as unknown as number,
            0,
            0,
          ],
        },
      ],
    })

    await processActivityDetail(user, detail, mockDeps)

    const points = vi.mocked(mockDeps.insertTimeSeries).mock.calls[0]![1]
    expect(points).toHaveLength(1)
    expect(points[0]).toMatchObject({ metric: 'stress_level', value: 15 })
  })

  test('handles missing metric descriptors gracefully', async () => {
    const detail = makeDetail({
      metricDescriptors: [
        { key: 'directTimestamp', metricsIndex: 0, unit: { key: 'gmt' } },
        { key: 'directCurrentStress', metricsIndex: 1, unit: { key: 'dimensionless' } },
      ],
      activityDetailMetrics: [{ metrics: [1700000001000, 42] }],
    })

    await processActivityDetail(user, detail, mockDeps)

    const points = vi.mocked(mockDeps.insertTimeSeries).mock.calls[0]![1]
    expect(points).toHaveLength(1)
    expect(points[0]).toMatchObject({ metric: 'stress_level', value: 42 })
  })

  test('returns 0 for empty activityDetailMetrics', async () => {
    const detail = makeDetail({ activityDetailMetrics: [] })
    const result = await processActivityDetail(user, detail, mockDeps)
    expect(result).toBe(0)
    expect(mockDeps.insertTimeSeries).not.toHaveBeenCalled()
  })

  test('returns 0 when no timestamp descriptor exists', async () => {
    const detail = makeDetail({
      metricDescriptors: [{ key: 'directCurrentStress', metricsIndex: 0, unit: { key: 'dimensionless' } }],
      activityDetailMetrics: [{ metrics: [25] }],
    })

    const result = await processActivityDetail(user, detail, mockDeps)
    expect(result).toBe(0)
    expect(mockDeps.insertTimeSeries).not.toHaveBeenCalled()
  })

  test('uses dynamic index lookup from metricDescriptors', async () => {
    // Shuffle indices — stress at 0, timestamp at 1, HR at 2
    const detail = makeDetail({
      metricDescriptors: [
        { key: 'directCurrentStress', metricsIndex: 0, unit: { key: 'dimensionless' } },
        { key: 'directTimestamp', metricsIndex: 1, unit: { key: 'gmt' } },
        { key: 'directHeartRate', metricsIndex: 2, unit: { key: 'bpm' } },
      ],
      activityDetailMetrics: [{ metrics: [35, 1700000001000, 80] }],
    })

    await processActivityDetail(user, detail, mockDeps)

    const points = vi.mocked(mockDeps.insertTimeSeries).mock.calls[0]![1]
    expect(points).toHaveLength(2)
    expect(points).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: 'stress_level', value: 35 }),
        expect.objectContaining({ metric: 'heart_rate', value: 80 }),
      ]),
    )
  })

  test('extracts running dynamics metrics (cadence, stride, power, etc)', async () => {
    const detail: GarminActivityDetailResponse = {
      activityDetailMetrics: [
        {
          metrics: [
            { source: '1.7E12', parsedValue: 1700000001000 }, // directTimestamp
            { source: '167.0', parsedValue: 167 }, // directDoubleCadence
            87.3, // directStrideLength (cm)
            { source: '290.0', parsedValue: 290 }, // directGroundContactTime
            9.09, // directVerticalRatio
            161.2, // directElevation
            { source: '362.0', parsedValue: 362 }, // directPower
            2.42, // directSpeed
            7.94, // directVerticalOscillation
            -0.2, // directVerticalSpeed (negative = descending)
            2.43, // directGradeAdjustedSpeed
          ],
        },
      ],
      activityId: 88888,
      metricDescriptors: [
        { key: 'directTimestamp', metricsIndex: 0, unit: { key: 'gmt' } },
        { key: 'directDoubleCadence', metricsIndex: 1, unit: { key: 'spm' } },
        { key: 'directStrideLength', metricsIndex: 2, unit: { key: 'centimeter' } },
        { key: 'directGroundContactTime', metricsIndex: 3, unit: { key: 'ms' } },
        { key: 'directVerticalRatio', metricsIndex: 4, unit: { key: 'dimensionless' } },
        { key: 'directElevation', metricsIndex: 5, unit: { key: 'meter' } },
        { key: 'directPower', metricsIndex: 6, unit: { key: 'watt' } },
        { key: 'directSpeed', metricsIndex: 7, unit: { key: 'mps' } },
        { key: 'directVerticalOscillation', metricsIndex: 8, unit: { key: 'centimeter' } },
        { key: 'directVerticalSpeed', metricsIndex: 9, unit: { key: 'mps' } },
        { key: 'directGradeAdjustedSpeed', metricsIndex: 10, unit: { key: 'mps' } },
      ],
    }

    await processActivityDetail(user, detail, mockDeps)

    const points = vi.mocked(mockDeps.insertTimeSeries).mock.calls[0]![1]
    const t = new Date(1700000001000)

    expect(points).toEqual(
      expect.arrayContaining([
        { metric: 'run_cadence', source: 'garmin', time: t, unit: 'spm', value: 167 },
        { metric: 'stride_length', source: 'garmin', time: t, unit: 'm', value: 0.873 },
        { metric: 'ground_contact_time', source: 'garmin', time: t, unit: 'ms', value: 290 },
        { metric: 'vertical_ratio', source: 'garmin', time: t, unit: 'percent', value: 9.09 },
        { metric: 'elevation', source: 'garmin', time: t, unit: 'm', value: 161.2 },
        { metric: 'power', source: 'garmin', time: t, unit: 'W', value: 362 },
        { metric: 'speed', source: 'garmin', time: t, unit: 'm/s', value: 2.42 },
        { metric: 'vertical_oscillation', source: 'garmin', time: t, unit: 'cm', value: 7.94 },
        { metric: 'vertical_speed', source: 'garmin', time: t, unit: 'm/s', value: -0.2 },
        { metric: 'grade_adjusted_speed', source: 'garmin', time: t, unit: 'm/s', value: 2.43 },
      ]),
    )
  })

  test('handles parsedValue objects in metric values', async () => {
    const detail: GarminActivityDetailResponse = {
      activityDetailMetrics: [
        {
          metrics: [
            { source: '1.7E12', parsedValue: 1700000001000 },
            { source: '74.0', parsedValue: 74 },
          ],
        },
      ],
      activityId: 77777,
      metricDescriptors: [
        { key: 'directTimestamp', metricsIndex: 0, unit: { key: 'gmt' } },
        { key: 'directHeartRate', metricsIndex: 1, unit: { key: 'bpm' } },
      ],
    }

    await processActivityDetail(user, detail, mockDeps)

    const points = vi.mocked(mockDeps.insertTimeSeries).mock.calls[0]![1]
    expect(points).toHaveLength(1)
    expect(points[0]).toMatchObject({ metric: 'heart_rate', value: 74 })
  })

  test('allows negative elevation values', async () => {
    const detail: GarminActivityDetailResponse = {
      activityDetailMetrics: [{ metrics: [1700000001000, -10.5] }],
      activityId: 66666,
      metricDescriptors: [
        { key: 'directTimestamp', metricsIndex: 0, unit: { key: 'gmt' } },
        { key: 'directElevation', metricsIndex: 1, unit: { key: 'meter' } },
      ],
    }

    await processActivityDetail(user, detail, mockDeps)

    const points = vi.mocked(mockDeps.insertTimeSeries).mock.calls[0]![1]
    expect(points).toHaveLength(1)
    expect(points[0]).toMatchObject({ metric: 'elevation', value: -10.5 })
  })

  test('converts stride length from cm to m', async () => {
    const detail: GarminActivityDetailResponse = {
      activityDetailMetrics: [{ metrics: [1700000001000, 95.5] }],
      activityId: 55555,
      metricDescriptors: [
        { key: 'directTimestamp', metricsIndex: 0, unit: { key: 'gmt' } },
        { key: 'directStrideLength', metricsIndex: 1, unit: { key: 'centimeter' } },
      ],
    }

    await processActivityDetail(user, detail, mockDeps)

    const points = vi.mocked(mockDeps.insertTimeSeries).mock.calls[0]![1]
    expect(points).toHaveLength(1)
    expect(points[0]).toMatchObject({ metric: 'stride_length', value: 0.955 })
  })

  test('extracts GPS locations and soft-deletes owntracks', async () => {
    // GPS points 61s apart — both should be included (> 60s downsample interval)
    const detail: GarminActivityDetailResponse = {
      activityDetailMetrics: [
        { metrics: [1700000001000, 57.65, 12.62] },
        { metrics: [1700000062000, 57.66, 12.63] },
      ],
      activityId: 44444,
      metricDescriptors: [
        { key: 'directTimestamp', metricsIndex: 0, unit: { key: 'gmt' } },
        { key: 'directLatitude', metricsIndex: 1, unit: { key: 'dd' } },
        { key: 'directLongitude', metricsIndex: 2, unit: { key: 'dd' } },
      ],
    }

    await processActivityDetail(user, detail, mockDeps)

    // Should soft-delete owntracks in the time range
    expect(mockDeps.softDeleteLocationRange).toHaveBeenCalledWith(
      user,
      'owntracks',
      new Date(1700000001000),
      new Date(1700000062000),
    )

    // Should batch-insert 2 GPS points
    expect(mockDeps.insertLocations).toHaveBeenCalledWith(user, [
      { lat: 57.65, lon: 12.62, source: 'garmin', time: new Date(1700000001000) },
      { lat: 57.66, lon: 12.63, source: 'garmin', time: new Date(1700000062000) },
    ])
  })

  test('keeps all GPS points (no downsampling)', async () => {
    const detail: GarminActivityDetailResponse = {
      activityDetailMetrics: [
        { metrics: [1700000001000, 57.65, 12.62] },
        { metrics: [1700000030000, 57.66, 12.63] },
        { metrics: [1700000059000, 57.67, 12.64] },
      ],
      activityId: 33333,
      metricDescriptors: [
        { key: 'directTimestamp', metricsIndex: 0, unit: { key: 'gmt' } },
        { key: 'directLatitude', metricsIndex: 1, unit: { key: 'dd' } },
        { key: 'directLongitude', metricsIndex: 2, unit: { key: 'dd' } },
      ],
    }

    await processActivityDetail(user, detail, mockDeps)

    expect(mockDeps.insertLocations).toHaveBeenCalledWith(user, [
      { lat: 57.65, lon: 12.62, source: 'garmin', time: new Date(1700000001000) },
      { lat: 57.66, lon: 12.63, source: 'garmin', time: new Date(1700000030000) },
      { lat: 57.67, lon: 12.64, source: 'garmin', time: new Date(1700000059000) },
    ])
  })

  test('does not insert GPS when latitude/longitude are 0', async () => {
    const detail: GarminActivityDetailResponse = {
      activityDetailMetrics: [{ metrics: [1700000001000, 0, 0] }],
      activityId: 22222,
      metricDescriptors: [
        { key: 'directTimestamp', metricsIndex: 0, unit: { key: 'gmt' } },
        { key: 'directLatitude', metricsIndex: 1, unit: { key: 'dd' } },
        { key: 'directLongitude', metricsIndex: 2, unit: { key: 'dd' } },
      ],
    }

    await processActivityDetail(user, detail, mockDeps)

    expect(mockDeps.insertLocations).not.toHaveBeenCalled()
    expect(mockDeps.softDeleteLocationRange).not.toHaveBeenCalled()
  })

  test('falls back to geoPolylineDTO when metrics lack lat/lon', async () => {
    const detail: GarminActivityDetailResponse = {
      activityDetailMetrics: [{ metrics: [1700000001000, 120] }, { metrics: [1700000062000, 125] }],
      activityId: 55555,
      geoPolylineDTO: {
        polyline: [
          { lat: 57.65, lon: 12.62, timestampGMT: 1700000001000 },
          { lat: 57.66, lon: 12.63, timestampGMT: 1700000062000 },
        ],
      },
      metricDescriptors: [
        { key: 'directTimestamp', metricsIndex: 0, unit: { key: 'gmt' } },
        { key: 'directHeartRate', metricsIndex: 1, unit: { key: 'bpm' } },
      ],
    }

    await processActivityDetail(user, detail, mockDeps)

    expect(mockDeps.insertLocations).toHaveBeenCalledWith(user, [
      { lat: 57.65, lon: 12.62, source: 'garmin', time: new Date(1700000001000) },
      { lat: 57.66, lon: 12.63, source: 'garmin', time: new Date(1700000062000) },
    ])
  })

  test('prefers metric GPS over polyline when both present', async () => {
    const detail: GarminActivityDetailResponse = {
      activityDetailMetrics: [
        { metrics: [1700000001000, 57.65, 12.62] },
        { metrics: [1700000062000, 57.66, 12.63] },
      ],
      activityId: 66666,
      geoPolylineDTO: {
        polyline: [{ lat: 99.0, lon: 99.0, timestampGMT: 1700000001000 }],
      },
      metricDescriptors: [
        { key: 'directTimestamp', metricsIndex: 0, unit: { key: 'gmt' } },
        { key: 'directLatitude', metricsIndex: 1, unit: { key: 'dd' } },
        { key: 'directLongitude', metricsIndex: 2, unit: { key: 'dd' } },
      ],
    }

    await processActivityDetail(user, detail, mockDeps)

    // Should use metric GPS (57.65), not polyline (99.0)
    expect(mockDeps.insertLocations).toHaveBeenCalledWith(user, [
      { lat: 57.65, lon: 12.62, source: 'garmin', time: new Date(1700000001000) },
      { lat: 57.66, lon: 12.63, source: 'garmin', time: new Date(1700000062000) },
    ])
  })
})

// ============================================================================
// extractNumericValue
// ============================================================================

describe('extractNumericValue', () => {
  test('returns plain numbers as-is', () => {
    expect(extractNumericValue(42)).toBe(42)
    expect(extractNumericValue(0)).toBe(0)
    expect(extractNumericValue(-5.5)).toBe(-5.5)
  })

  test('extracts parsedValue from objects', () => {
    expect(extractNumericValue({ source: '77.0', parsedValue: 77 })).toBe(77)
    expect(extractNumericValue({ source: '0.0', parsedValue: 0 })).toBe(0)
  })

  test('returns null for null/undefined', () => {
    expect(extractNumericValue(null)).toBeNull()
    expect(extractNumericValue(undefined)).toBeNull()
  })

  test('returns null for non-numeric types', () => {
    expect(extractNumericValue('string')).toBeNull()
    expect(extractNumericValue({})).toBeNull()
  })
})
