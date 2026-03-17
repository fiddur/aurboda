import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { GarminProcessDeps } from './garmin-process.ts'

import { processGarminData } from './garmin-process.ts'

const mockDeps: GarminProcessDeps = {
  insertActivity: vi.fn().mockResolvedValue(undefined),
  insertRawRecord: vi.fn().mockResolvedValue(undefined),
  insertTimeSeries: vi.fn().mockResolvedValue(undefined),
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
  })

  // ==========================================================================
  // Stress
  // ==========================================================================

  describe('stress', () => {
    test('inserts raw record with correct fields', async () => {
      const data = { calendarDate: '2025-01-15', overallStressLevel: 38 }

      await processGarminData(user, 'stress', data, mockDeps)

      expect(mockDeps.insertRawRecord).toHaveBeenCalledWith(user, {
        data: expect.objectContaining({ calendarDate: '2025-01-15' }),
        external_id: 'garmin-stress-2025-01-15',
        record_type: 'garmin_stress',
        recorded_at: noonUTC('2025-01-15'),
        source: 'garmin',
      })
    })

    test('inserts stress_level time series point', async () => {
      const data = { calendarDate: '2025-01-15', overallStressLevel: 38 }

      await processGarminData(user, 'stress', data, mockDeps)

      expect(mockDeps.insertTimeSeries).toHaveBeenCalledWith(user, [
        { metric: 'stress_level', source: 'garmin', time: noonUTC('2025-01-15'), unit: 'score', value: 38 },
      ])
    })

    test('skips time series when overallStressLevel is 0', async () => {
      const data = { calendarDate: '2025-01-15', overallStressLevel: 0 }

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
          { calendarDate: '2025-01-15', overallStressLevel: 38 },
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
        activity_type: 'exercise',
        data: {
          activity_type_key: 'running',
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

    test('uses "unknown" when activityType is missing', async () => {
      await processGarminData(user, 'activities', [makeActivity({ activityType: null })], mockDeps)

      const activityArg = vi.mocked(mockDeps.insertActivity).mock.calls[0]![1]
      expect((activityArg.data as Record<string, unknown>).activity_type_key).toBe('unknown')
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
