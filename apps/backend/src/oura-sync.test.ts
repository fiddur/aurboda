import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from './db/index.ts'
import {
  calculateRetryAfter,
  computeSleepMinutes,
  convertOuraSleepPhases,
  isRateLimited,
  processOuraData,
  syncOuraDataType,
} from './oura-sync.ts'

// Mock the db module
vi.mock('./db', () => ({
  getSyncState: vi.fn(),
  getUserSettings: vi.fn(),
  insertActivity: vi.fn(),
  insertRawRecord: vi.fn(),
  insertTag: vi.fn().mockResolvedValue('tag-uuid-123'),
  insertTimeSeries: vi.fn(),
  resolveOrCreateTagDefinition: vi
    .fn()
    .mockImplementation((_user: string, tagName: string) =>
      Promise.resolve({ aliases: [tagName.toLowerCase()], id: 'def-uuid', name: tagName }),
    ),
  upsertSyncState: vi.fn(),
  upsertSyncedNote: vi.fn(),
}))

describe('calculateRetryAfter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'))
  })

  test('uses Retry-After header when available (seconds)', () => {
    const result = calculateRetryAfter('120', 0)
    expect(result).toEqual(new Date('2025-01-01T12:02:00Z'))
  })

  test('uses exponential backoff when no header (attempt 0)', () => {
    const result = calculateRetryAfter(undefined, 0)
    expect(result).toEqual(new Date('2025-01-01T12:01:00Z'))
  })

  test('uses exponential backoff when no header (attempt 1)', () => {
    const result = calculateRetryAfter(undefined, 1)
    expect(result).toEqual(new Date('2025-01-01T12:05:00Z'))
  })

  test('uses exponential backoff when no header (attempt 2)', () => {
    const result = calculateRetryAfter(undefined, 2)
    expect(result).toEqual(new Date('2025-01-01T12:15:00Z'))
  })

  test('caps backoff at max value (attempt >= 3)', () => {
    const result = calculateRetryAfter(undefined, 5)
    expect(result).toEqual(new Date('2025-01-01T13:00:00Z'))
  })

  test('handles invalid Retry-After header', () => {
    const result = calculateRetryAfter('invalid', 0)
    expect(result).toEqual(new Date('2025-01-01T12:01:00Z'))
  })
})

describe('isRateLimited', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'))
  })

  test('returns false when syncState is null', () => {
    expect(isRateLimited(null)).toBe(false)
  })

  test('returns false when status is not rate_limited', () => {
    expect(
      isRateLimited({
        data_type: 'dailyReadiness',
        provider: 'oura',
        retry_after: new Date('2025-01-01T13:00:00Z'),
        status: 'idle',
      }),
    ).toBe(false)
  })

  test('returns false when retry_after is in the past', () => {
    expect(
      isRateLimited({
        data_type: 'dailyReadiness',
        provider: 'oura',
        retry_after: new Date('2025-01-01T11:00:00Z'),
        status: 'rate_limited',
      }),
    ).toBe(false)
  })

  test('returns true when rate_limited and retry_after is in the future', () => {
    expect(
      isRateLimited({
        data_type: 'dailyReadiness',
        provider: 'oura',
        retry_after: new Date('2025-01-01T13:00:00Z'),
        status: 'rate_limited',
      }),
    ).toBe(true)
  })
})

describe('convertOuraSleepPhases', () => {
  const bedtime = new Date('2025-01-15T23:00:00Z')

  test('converts basic Oura phases to HC stages', () => {
    // 1=deep→5, 2=light→4, 3=REM→6, 4=awake→1
    const stages = convertOuraSleepPhases('1234', bedtime)
    expect(stages).toEqual([
      { endTime: '2025-01-15T23:05:00.000Z', stage: 5, startTime: '2025-01-15T23:00:00.000Z' },
      { endTime: '2025-01-15T23:10:00.000Z', stage: 4, startTime: '2025-01-15T23:05:00.000Z' },
      { endTime: '2025-01-15T23:15:00.000Z', stage: 6, startTime: '2025-01-15T23:10:00.000Z' },
      { endTime: '2025-01-15T23:20:00.000Z', stage: 1, startTime: '2025-01-15T23:15:00.000Z' },
    ])
  })

  test('merges consecutive same-stage epochs', () => {
    // Three consecutive deep (1) then one awake (4)
    const stages = convertOuraSleepPhases('1114', bedtime)
    expect(stages).toEqual([
      { endTime: '2025-01-15T23:15:00.000Z', stage: 5, startTime: '2025-01-15T23:00:00.000Z' },
      { endTime: '2025-01-15T23:20:00.000Z', stage: 1, startTime: '2025-01-15T23:15:00.000Z' },
    ])
  })

  test('returns empty array for null input', () => {
    expect(convertOuraSleepPhases(null, bedtime)).toEqual([])
  })

  test('returns empty array for empty string', () => {
    expect(convertOuraSleepPhases('', bedtime)).toEqual([])
  })

  test('skips unknown digit characters', () => {
    // '0' and '9' are not valid Oura phases — they should be skipped
    const stages = convertOuraSleepPhases('091', bedtime)
    // Only the '1' (deep) at position 2 should be converted
    // Position 0 (0) and position 1 (9) are skipped, position 2 (1) is deep
    expect(stages).toEqual([
      { endTime: '2025-01-15T23:15:00.000Z', stage: 5, startTime: '2025-01-15T23:10:00.000Z' },
    ])
  })

  test('handles realistic sleep phase string', () => {
    // A short sequence: deep, deep, light, light, REM, awake
    const stages = convertOuraSleepPhases('112234', bedtime)
    expect(stages).toEqual([
      { endTime: '2025-01-15T23:10:00.000Z', stage: 5, startTime: '2025-01-15T23:00:00.000Z' }, // deep 10min
      { endTime: '2025-01-15T23:20:00.000Z', stage: 4, startTime: '2025-01-15T23:10:00.000Z' }, // light 10min
      { endTime: '2025-01-15T23:25:00.000Z', stage: 6, startTime: '2025-01-15T23:20:00.000Z' }, // REM 5min
      { endTime: '2025-01-15T23:30:00.000Z', stage: 1, startTime: '2025-01-15T23:25:00.000Z' }, // awake 5min
    ])
  })
})

describe('computeSleepMinutes', () => {
  test('returns 0 for empty stages', () => {
    expect(computeSleepMinutes([])).toBe(0)
  })

  test('returns 0 when all stages are awake', () => {
    expect(
      computeSleepMinutes([
        { endTime: '2025-01-15T23:10:00.000Z', stage: 1, startTime: '2025-01-15T23:00:00.000Z' },
        { endTime: '2025-01-15T23:20:00.000Z', stage: 1, startTime: '2025-01-15T23:10:00.000Z' },
      ]),
    ).toBe(0)
  })

  test('sums non-awake stages correctly', () => {
    expect(
      computeSleepMinutes([
        { endTime: '2025-01-15T23:10:00.000Z', stage: 1, startTime: '2025-01-15T23:00:00.000Z' }, // awake 10min
        { endTime: '2025-01-15T23:25:00.000Z', stage: 4, startTime: '2025-01-15T23:10:00.000Z' }, // light 15min
        { endTime: '2025-01-15T23:30:00.000Z', stage: 1, startTime: '2025-01-15T23:25:00.000Z' }, // awake 5min
      ]),
    ).toBe(15)
  })

  test('counts all sleep stage types (light, deep, REM)', () => {
    expect(
      computeSleepMinutes([
        { endTime: '2025-01-15T23:10:00.000Z', stage: 4, startTime: '2025-01-15T23:00:00.000Z' }, // light 10min
        { endTime: '2025-01-15T23:15:00.000Z', stage: 5, startTime: '2025-01-15T23:10:00.000Z' }, // deep 5min
        { endTime: '2025-01-15T23:20:00.000Z', stage: 6, startTime: '2025-01-15T23:15:00.000Z' }, // REM 5min
      ]),
    ).toBe(20)
  })
})

describe('processOuraData', () => {
  const user = 'testuser'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('handles empty data array', async () => {
    await processOuraData(user, 'dailyReadiness', [])
    expect(db.insertRawRecord).not.toHaveBeenCalled()
    expect(db.insertTimeSeries).not.toHaveBeenCalled()
  })

  describe('dailyCardiovascularAge', () => {
    test('processes cardiovascular age data', async () => {
      const data = [
        {
          id: 'cv-1',
          timestamp: '2025-01-01T00:00:00Z',
          vascular_age: 35,
        },
        {
          day: '2025-01-02',
          id: 'cv-2',
          vascular_age: 34,
        },
      ]

      await processOuraData(user, 'dailyCardiovascularAge', data)

      expect(db.insertRawRecord).toHaveBeenCalledTimes(2)
      expect(db.insertRawRecord).toHaveBeenCalledWith(user, {
        data: data[0],
        external_id: 'cv-1',
        record_type: 'daily_cardiovascular_age',
        recorded_at: new Date('2025-01-01T00:00:00Z'),
        source: 'oura',
      })

      expect(db.insertTimeSeries).toHaveBeenCalledWith(user, [
        {
          metric: 'cardiovascular_age',
          source: 'oura',
          time: new Date('2025-01-01T00:00:00Z'),
          value: 35,
        },
        {
          metric: 'cardiovascular_age',
          source: 'oura',
          time: new Date('2025-01-02'),
          value: 34,
        },
      ])
    })
  })

  describe('dailyReadiness', () => {
    test('processes readiness score data', async () => {
      const data = [
        {
          contributors: { activity_balance: 90 },
          id: 'rd-1',
          score: 85,
          timestamp: '2025-01-01T06:00:00Z',
        },
      ]

      await processOuraData(user, 'dailyReadiness', data)

      expect(db.insertRawRecord).toHaveBeenCalledWith(user, {
        data: data[0],
        external_id: 'rd-1',
        record_type: 'daily_readiness',
        recorded_at: new Date('2025-01-01T06:00:00Z'),
        source: 'oura',
      })

      expect(db.insertTimeSeries).toHaveBeenCalledWith(user, [
        {
          metric: 'readiness_score',
          source: 'oura',
          time: new Date('2025-01-01T06:00:00Z'),
          value: 85,
        },
      ])
    })
  })

  describe('dailyResilience', () => {
    test('processes resilience level data', async () => {
      const data = [
        { id: 'rs-1', level: 'solid', timestamp: '2025-01-01T00:00:00Z' },
        { id: 'rs-2', level: 'exceptional', timestamp: '2025-01-02T00:00:00Z' },
        { id: 'rs-3', level: 'limited', timestamp: '2025-01-03T00:00:00Z' },
        { id: 'rs-4', level: 'strong', timestamp: '2025-01-04T00:00:00Z' },
      ]

      await processOuraData(user, 'dailyResilience', data)

      expect(db.insertRawRecord).toHaveBeenCalledTimes(4)
      expect(db.insertTimeSeries).toHaveBeenCalledWith(user, [
        { metric: 'resilience_score', source: 'oura', time: new Date('2025-01-01T00:00:00Z'), value: 75 },
        { metric: 'resilience_score', source: 'oura', time: new Date('2025-01-02T00:00:00Z'), value: 100 },
        { metric: 'resilience_score', source: 'oura', time: new Date('2025-01-03T00:00:00Z'), value: 25 },
        { metric: 'resilience_score', source: 'oura', time: new Date('2025-01-04T00:00:00Z'), value: 50 },
      ])
    })

    test('handles unknown resilience level', async () => {
      const data = [{ id: 'rs-1', level: 'unknown_level', timestamp: '2025-01-01T00:00:00Z' }]

      await processOuraData(user, 'dailyResilience', data)

      expect(db.insertRawRecord).toHaveBeenCalled()
      expect(db.insertTimeSeries).not.toHaveBeenCalled()
    })
  })

  describe('dailySleep', () => {
    test('processes daily sleep score data', async () => {
      const data = [
        {
          contributors: { deep_sleep: 88 },
          id: 'sl-1',
          score: 92,
          timestamp: '2025-01-01T07:00:00Z',
        },
      ]

      await processOuraData(user, 'dailySleep', data)

      expect(db.insertRawRecord).toHaveBeenCalledWith(user, {
        data: data[0],
        external_id: 'sl-1',
        record_type: 'daily_sleep',
        recorded_at: new Date('2025-01-01T07:00:00Z'),
        source: 'oura',
      })

      // Should include both the main score and contributor
      expect(db.insertTimeSeries).toHaveBeenCalledWith(
        user,
        expect.arrayContaining([
          {
            metric: 'sleep_score',
            source: 'oura',
            time: new Date('2025-01-01T07:00:00Z'),
            value: 92,
          },
          {
            metric: 'sleep_deep_score',
            source: 'oura',
            time: new Date('2025-01-01T07:00:00Z'),
            value: 88,
          },
        ]),
      )
    })

    test('extracts all sleep contributors as metrics', async () => {
      const data = [
        {
          contributors: {
            deep_sleep: 85,
            efficiency: 90,
            latency: 95,
            rem_sleep: 80,
            restfulness: 75,
            timing: 70,
            total_sleep: 88,
          },
          id: 'sl-2',
          score: 82,
          timestamp: '2025-01-02T07:00:00Z',
        },
      ]

      await processOuraData(user, 'dailySleep', data)

      const insertCall = vi.mocked(db.insertTimeSeries).mock.calls[0]
      const points = insertCall[1]

      // Should have main score + 7 contributors = 8 points
      expect(points).toHaveLength(8)

      expect(points).toContainEqual({
        metric: 'sleep_score',
        source: 'oura',
        time: new Date('2025-01-02T07:00:00Z'),
        value: 82,
      })
      expect(points).toContainEqual({
        metric: 'sleep_efficiency',
        source: 'oura',
        time: new Date('2025-01-02T07:00:00Z'),
        value: 90,
      })
      expect(points).toContainEqual({
        metric: 'sleep_latency',
        source: 'oura',
        time: new Date('2025-01-02T07:00:00Z'),
        value: 95,
      })
      expect(points).toContainEqual({
        metric: 'sleep_restfulness',
        source: 'oura',
        time: new Date('2025-01-02T07:00:00Z'),
        value: 75,
      })
      expect(points).toContainEqual({
        metric: 'sleep_timing',
        source: 'oura',
        time: new Date('2025-01-02T07:00:00Z'),
        value: 70,
      })
      expect(points).toContainEqual({
        metric: 'sleep_deep_score',
        source: 'oura',
        time: new Date('2025-01-02T07:00:00Z'),
        value: 85,
      })
      expect(points).toContainEqual({
        metric: 'sleep_rem_score',
        source: 'oura',
        time: new Date('2025-01-02T07:00:00Z'),
        value: 80,
      })
      expect(points).toContainEqual({
        metric: 'sleep_total_score',
        source: 'oura',
        time: new Date('2025-01-02T07:00:00Z'),
        value: 88,
      })
    })

    test('handles missing contributors gracefully', async () => {
      const data = [
        {
          id: 'sl-3',
          score: 78,
          timestamp: '2025-01-03T07:00:00Z',
          // no contributors field
        },
      ]

      await processOuraData(user, 'dailySleep', data)

      expect(db.insertTimeSeries).toHaveBeenCalledWith(user, [
        {
          metric: 'sleep_score',
          source: 'oura',
          time: new Date('2025-01-03T07:00:00Z'),
          value: 78,
        },
      ])
    })
  })

  describe('sessions', () => {
    test('processes meditation session data', async () => {
      // Data is pre-transformed by oura.ts getSessions()
      const data = [
        {
          endTime: new Date('2025-01-01T10:30:00Z'),
          heartRate: { interval: 5, items: [60, 62, 58] },
          hrv: { interval: 5, items: [50, 55] },
          id: 'sess-1',
          mood: 'good',
          motion: { interval: 5, items: [1, 0, 2] },
          startTime: new Date('2025-01-01T10:00:00Z'),
          type: 'meditation',
        },
      ]

      await processOuraData(user, 'sessions', data)

      expect(db.insertRawRecord).toHaveBeenCalledWith(user, {
        data: data[0],
        external_id: 'sess-1',
        record_type: 'session',
        recorded_at: new Date('2025-01-01T10:00:00Z'),
        source: 'oura',
      })

      expect(db.insertActivity).toHaveBeenCalledWith(user, {
        activity_type: 'meditation',
        data: {
          heartRate: data[0].heartRate,
          hrv: data[0].hrv,
          mood: 'good',
          motion: data[0].motion,
          sessionType: 'meditation',
        },
        end_time: new Date('2025-01-01T10:30:00Z'),
        source: 'oura',
        start_time: new Date('2025-01-01T10:00:00Z'),
        title: 'meditation',
      })
    })

    test('extracts heart rate samples to time series', async () => {
      const data = [
        {
          endTime: new Date('2025-01-01T10:00:15Z'),
          heartRate: { interval: 5, items: [60, 62, 58] },
          hrv: undefined,
          id: 'sess-hr',
          mood: 'good',
          motion: undefined,
          startTime: new Date('2025-01-01T10:00:00Z'),
          type: 'meditation',
        },
      ]

      await processOuraData(user, 'sessions', data)

      expect(db.insertTimeSeries).toHaveBeenCalledWith(user, [
        { metric: 'heart_rate', source: 'oura', time: new Date('2025-01-01T10:00:00Z'), value: 60 },
        { metric: 'heart_rate', source: 'oura', time: new Date('2025-01-01T10:00:05Z'), value: 62 },
        { metric: 'heart_rate', source: 'oura', time: new Date('2025-01-01T10:00:10Z'), value: 58 },
      ])
    })

    test('extracts HRV samples to time series', async () => {
      const data = [
        {
          endTime: new Date('2025-01-01T10:00:10Z'),
          heartRate: undefined,
          hrv: { interval: 5, items: [50, 55] },
          id: 'sess-hrv',
          mood: 'good',
          motion: undefined,
          startTime: new Date('2025-01-01T10:00:00Z'),
          type: 'meditation',
        },
      ]

      await processOuraData(user, 'sessions', data)

      expect(db.insertTimeSeries).toHaveBeenCalledWith(user, [
        { metric: 'hrv_rmssd', source: 'oura', time: new Date('2025-01-01T10:00:00Z'), value: 50 },
        { metric: 'hrv_rmssd', source: 'oura', time: new Date('2025-01-01T10:00:05Z'), value: 55 },
      ])
    })

    test('extracts both HR and HRV samples together', async () => {
      const data = [
        {
          endTime: new Date('2025-01-01T10:00:10Z'),
          heartRate: { interval: 5, items: [60, 62] },
          hrv: { interval: 5, items: [50, 55] },
          id: 'sess-both',
          mood: 'good',
          motion: undefined,
          startTime: new Date('2025-01-01T10:00:00Z'),
          type: 'meditation',
        },
      ]

      await processOuraData(user, 'sessions', data)

      expect(db.insertTimeSeries).toHaveBeenCalledWith(user, [
        { metric: 'heart_rate', source: 'oura', time: new Date('2025-01-01T10:00:00Z'), value: 60 },
        { metric: 'heart_rate', source: 'oura', time: new Date('2025-01-01T10:00:05Z'), value: 62 },
        { metric: 'hrv_rmssd', source: 'oura', time: new Date('2025-01-01T10:00:00Z'), value: 50 },
        { metric: 'hrv_rmssd', source: 'oura', time: new Date('2025-01-01T10:00:05Z'), value: 55 },
      ])
    })

    test('skips null values in HR and HRV samples', async () => {
      const data = [
        {
          endTime: new Date('2025-01-01T10:00:15Z'),
          heartRate: { interval: 5, items: [60, null, 58] },
          hrv: { interval: 5, items: [null, 55, null] },
          id: 'sess-nulls',
          mood: 'good',
          motion: undefined,
          startTime: new Date('2025-01-01T10:00:00Z'),
          type: 'meditation',
        },
      ]

      await processOuraData(user, 'sessions', data)

      expect(db.insertTimeSeries).toHaveBeenCalledWith(user, [
        { metric: 'heart_rate', source: 'oura', time: new Date('2025-01-01T10:00:00Z'), value: 60 },
        { metric: 'heart_rate', source: 'oura', time: new Date('2025-01-01T10:00:10Z'), value: 58 },
        { metric: 'hrv_rmssd', source: 'oura', time: new Date('2025-01-01T10:00:05Z'), value: 55 },
      ])
    })

    test('does not call insertTimeSeries when no HR/HRV data', async () => {
      const data = [
        {
          endTime: new Date('2025-01-01T10:30:00Z'),
          heartRate: undefined,
          hrv: undefined,
          id: 'sess-no-data',
          mood: 'good',
          motion: undefined,
          startTime: new Date('2025-01-01T10:00:00Z'),
          type: 'meditation',
        },
      ]

      await processOuraData(user, 'sessions', data)

      expect(db.insertTimeSeries).not.toHaveBeenCalled()
    })
  })

  describe('sleep', () => {
    const makeSleepRecord = (overrides: Record<string, unknown> = {}) => ({
      average_heart_rate: 55,
      average_hrv: 45,
      bedtime_end: '2025-01-16T07:00:00Z',
      bedtime_start: '2025-01-15T23:00:00Z',
      day: '2025-01-15',
      heart_rate: null,
      heart_rate_variability: null,
      id: 'sleep-1',
      lowest_heart_rate: 48,
      readiness_score_delta: null,
      sleep_phase_5_min: '1122334',
      type: 'long_sleep',
      ...overrides,
    })

    test('processes long_sleep as sleep activity', async () => {
      await processOuraData(user, 'sleep', [makeSleepRecord()])

      expect(db.insertRawRecord).toHaveBeenCalledWith(user, {
        data: expect.objectContaining({ id: 'sleep-1', type: 'long_sleep' }),
        external_id: 'sleep-1',
        record_type: 'sleep',
        recorded_at: new Date('2025-01-15T23:00:00Z'),
        source: 'oura',
      })

      expect(db.insertActivity).toHaveBeenCalledWith(user, {
        activity_type: 'sleep',
        data: expect.objectContaining({
          averageHeartRate: 55,
          averageHrv: 45,
          lowestHeartRate: 48,
          ouraType: 'long_sleep',
          stages: expect.arrayContaining([
            expect.objectContaining({ stage: 5 }), // deep
          ]),
        }),
        end_time: new Date('2025-01-16T07:00:00Z'),
        source: 'oura',
        start_time: new Date('2025-01-15T23:00:00Z'),
        title: 'Sleep',
      })
    })

    test('processes short sleep with >= 15 min of sleep stages as nap', async () => {
      // Oura phases: '4422244' → awake, awake, light, light, light, awake, awake
      // = 3 light epochs × 5 min = 15 min of actual sleep → qualifies as nap
      await processOuraData(user, 'sleep', [
        makeSleepRecord({ id: 'nap-1', sleep_phase_5_min: '4422244', type: 'sleep' }),
      ])

      expect(db.insertActivity).toHaveBeenCalledWith(
        user,
        expect.objectContaining({
          activity_type: 'nap',
          title: 'Nap',
        }),
      )
    })

    test('processes short sleep with < 15 min of sleep stages as rest', async () => {
      // Oura phases: '44124' → awake, awake, deep, light, awake
      // = 2 sleep epochs × 5 min = 10 min of actual sleep → classified as rest
      await processOuraData(user, 'sleep', [
        makeSleepRecord({ id: 'rest-short-1', sleep_phase_5_min: '44124', type: 'sleep' }),
      ])

      expect(db.insertActivity).toHaveBeenCalledWith(
        user,
        expect.objectContaining({
          activity_type: 'rest',
          title: 'Rest',
        }),
      )
    })

    test('processes rest as meditation activity', async () => {
      await processOuraData(user, 'sleep', [makeSleepRecord({ id: 'rest-1', type: 'rest' })])

      expect(db.insertActivity).toHaveBeenCalledWith(
        user,
        expect.objectContaining({
          activity_type: 'meditation',
          title: 'Rest',
        }),
      )
    })

    test('converts sleep phases to HC stage format', async () => {
      // '12' → deep(5) then light(4), each 5 min
      await processOuraData(user, 'sleep', [makeSleepRecord({ sleep_phase_5_min: '12' })])

      const activityCall = vi.mocked(db.insertActivity).mock.calls[0]!
      const data = activityCall[1].data as { stages: Array<{ stage: number }> }
      expect(data.stages).toEqual([
        {
          endTime: '2025-01-15T23:05:00.000Z',
          stage: 5,
          startTime: '2025-01-15T23:00:00.000Z',
        },
        {
          endTime: '2025-01-15T23:10:00.000Z',
          stage: 4,
          startTime: '2025-01-15T23:05:00.000Z',
        },
      ])
    })

    test('handles null sleep phases gracefully', async () => {
      await processOuraData(user, 'sleep', [makeSleepRecord({ sleep_phase_5_min: null })])

      const activityCall = vi.mocked(db.insertActivity).mock.calls[0]!
      const data = activityCall[1].data as { stages: unknown[] }
      expect(data.stages).toEqual([])
    })

    test('extracts HR interval data to time series', async () => {
      await processOuraData(user, 'sleep', [
        makeSleepRecord({
          heart_rate: { interval: 300, items: [55, 52, null, 50] },
        }),
      ])

      expect(db.insertTimeSeries).toHaveBeenCalledWith(
        user,
        expect.arrayContaining([
          { metric: 'heart_rate', source: 'oura', time: new Date('2025-01-15T23:00:00Z'), value: 55 },
          { metric: 'heart_rate', source: 'oura', time: new Date('2025-01-15T23:05:00Z'), value: 52 },
          { metric: 'heart_rate', source: 'oura', time: new Date('2025-01-15T23:15:00Z'), value: 50 },
        ]),
      )
    })

    test('extracts HRV interval data to time series', async () => {
      await processOuraData(user, 'sleep', [
        makeSleepRecord({
          heart_rate_variability: { interval: 300, items: [45, 50] },
        }),
      ])

      expect(db.insertTimeSeries).toHaveBeenCalledWith(
        user,
        expect.arrayContaining([
          { metric: 'hrv_rmssd', source: 'oura', time: new Date('2025-01-15T23:00:00Z'), value: 45 },
          { metric: 'hrv_rmssd', source: 'oura', time: new Date('2025-01-15T23:05:00Z'), value: 50 },
        ]),
      )
    })

    test('does not call insertTimeSeries when no HR/HRV data', async () => {
      await processOuraData(user, 'sleep', [makeSleepRecord()])

      expect(db.insertTimeSeries).not.toHaveBeenCalled()
    })
  })

  describe('tags', () => {
    test('processes tag data with custom name', async () => {
      // Data is pre-transformed by oura.ts getTags() which returns DB Tag type (snake_case)
      const data = [
        {
          end_time: new Date('2025-01-01T08:05:00Z'),
          external_id: 'tag-1',
          source: 'oura' as const,
          start_time: new Date('2025-01-01T08:00:00Z'),
          tag: 'Morning Coffee',
        },
      ]

      await processOuraData(user, 'tags', data)

      expect(db.insertRawRecord).toHaveBeenCalledWith(user, {
        data: data[0],
        external_id: 'tag-1',
        record_type: 'enhanced_tag',
        recorded_at: new Date('2025-01-01T08:00:00Z'),
        source: 'oura',
      })

      expect(db.insertTag).toHaveBeenCalledWith(user, data[0])
    })

    test('processes tag data without end_time', async () => {
      // Data is pre-transformed by oura.ts getTags() which returns DB Tag type (snake_case)
      const data = [
        {
          end_time: undefined,
          external_id: 'tag-2',
          source: 'oura' as const,
          start_time: new Date('2025-01-01T14:00:00Z'),
          tag: 'stress_high',
        },
      ]

      await processOuraData(user, 'tags', data)

      expect(db.insertTag).toHaveBeenCalledWith(user, data[0])
    })

    test('handles tag with unknown type', async () => {
      // Data is pre-transformed by oura.ts getTags() - 'unknown' is set by oura.ts when tag_type_code is null
      const data = [
        {
          end_time: undefined,
          external_id: 'tag-3',
          source: 'oura' as const,
          start_time: new Date('2025-01-01T14:00:00Z'),
          tag: 'unknown',
        },
      ]

      await processOuraData(user, 'tags', data)

      expect(db.insertTag).toHaveBeenCalledWith(user, data[0])
    })

    test('upserts synced note when tag has a comment', async () => {
      const data = [
        {
          comment: 'Felt great after this',
          end_time: new Date('2025-01-01T08:05:00Z'),
          external_id: 'tag-4',
          source: 'oura' as const,
          start_time: new Date('2025-01-01T08:00:00Z'),
          tag: 'Morning Coffee',
        },
      ]

      await processOuraData(user, 'tags', data)

      expect(db.upsertSyncedNote).toHaveBeenCalledWith(
        user,
        'tag',
        'tag-uuid-123',
        'oura',
        'Felt great after this',
        new Date('2025-01-01T08:00:00Z'),
        new Date('2025-01-01T08:05:00Z'),
      )
    })

    test('calls upsertSyncedNote with undefined when tag has no comment', async () => {
      const data = [
        {
          end_time: new Date('2025-01-01T08:05:00Z'),
          external_id: 'tag-5',
          source: 'oura' as const,
          start_time: new Date('2025-01-01T08:00:00Z'),
          tag: 'Morning Coffee',
        },
      ]

      await processOuraData(user, 'tags', data)

      expect(db.upsertSyncedNote).toHaveBeenCalledWith(
        user,
        'tag',
        'tag-uuid-123',
        'oura',
        undefined,
        new Date('2025-01-01T08:00:00Z'),
        new Date('2025-01-01T08:05:00Z'),
      )
    })
  })
})

describe('syncOuraDataType', () => {
  const user = 'testuser'
  const accessToken = 'test-token'

  const createMockOura = () => ({
    authCb: vi.fn(),
    getAccessToken: vi.fn(),
    getDailyCardiovascularAge: vi.fn().mockResolvedValue([]),
    getDailyReadiness: vi.fn().mockResolvedValue([]),
    getDailyResilience: vi.fn().mockResolvedValue([]),
    getDailySleep: vi.fn().mockResolvedValue([]),
    getPersonalInfo: vi.fn(),
    getSessions: vi.fn().mockResolvedValue([]),
    getSleep: vi.fn().mockResolvedValue([]),
    getTags: vi.fn().mockResolvedValue([]),
    getUserId: vi.fn(),
    storeAccessToken: vi.fn(),
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'))
  })

  test('incremental sync uses 2-day overlap from last_sync_time', async () => {
    const lastSyncTime = new Date('2025-01-14T10:00:00Z')
    vi.mocked(db.getSyncState).mockResolvedValue({
      data_type: 'dailyReadiness',
      last_sync_time: lastSyncTime,
      provider: 'oura',
      status: 'idle',
    })

    const mockOura = createMockOura()
    await syncOuraDataType(user, mockOura as never, 'dailyReadiness', accessToken)

    // Should have been called with start = lastSyncTime - 2 days
    const expectedStart = new Date('2025-01-12T10:00:00Z')
    expect(mockOura.getDailyReadiness).toHaveBeenCalledWith(expectedStart, expect.any(Date), accessToken)
  })

  test('full resync uses 90-day history', async () => {
    vi.mocked(db.getSyncState).mockResolvedValue({
      data_type: 'dailyReadiness',
      last_sync_time: new Date('2025-01-14T10:00:00Z'),
      provider: 'oura',
      status: 'idle',
    })

    const mockOura = createMockOura()
    await syncOuraDataType(user, mockOura as never, 'dailyReadiness', accessToken, {
      fullResync: true,
    })

    // Should have been called with start ~90 days back from now
    const [start] = mockOura.getDailyReadiness.mock.calls[0]! as [Date]
    const daysDiff = (new Date('2025-01-15T12:00:00Z').getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
    expect(daysDiff).toBeCloseTo(90, 0)
  })

  test('first sync (no sync state) uses 90-day history', async () => {
    vi.mocked(db.getSyncState).mockResolvedValue(null)

    const mockOura = createMockOura()
    await syncOuraDataType(user, mockOura as never, 'dailyReadiness', accessToken)

    // Should have been called with start ~90 days back from now
    const [start] = mockOura.getDailyReadiness.mock.calls[0]! as [Date]
    const daysDiff = (new Date('2025-01-15T12:00:00Z').getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
    expect(daysDiff).toBeCloseTo(90, 0)
  })

  test('first sync (no sync state) uses 90-day history', async () => {
    vi.mocked(db.getSyncState).mockResolvedValue(null)

    const mockOura = createMockOura()
    await syncOuraDataType(user, mockOura as never, 'dailyReadiness', accessToken)

    // Should have been called with start ~90 days back from now
    const [start] = mockOura.getDailyReadiness.mock.calls[0]! as [Date]
    const daysDiff = (new Date('2025-01-15T12:00:00Z').getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
    expect(daysDiff).toBeCloseTo(90, 0)
  })

  test('skips sync when rate limited', async () => {
    vi.mocked(db.getSyncState).mockResolvedValue({
      data_type: 'dailyReadiness',
      provider: 'oura',
      retry_after: new Date('2025-01-15T13:00:00Z'),
      status: 'rate_limited',
    })

    const mockOura = createMockOura()
    const result = await syncOuraDataType(user, mockOura as never, 'dailyReadiness', accessToken)

    expect(result.status).toBe('skipped')
    expect(mockOura.getDailyReadiness).not.toHaveBeenCalled()
  })

  test('updates sync state on success', async () => {
    vi.mocked(db.getSyncState).mockResolvedValue({
      data_type: 'dailySleep',
      last_sync_time: new Date('2025-01-14T10:00:00Z'),
      provider: 'oura',
      status: 'idle',
    })

    const mockOura = createMockOura()
    mockOura.getDailySleep.mockResolvedValue([{ id: 'sl-1', score: 85, timestamp: '2025-01-15T07:00:00Z' }])

    const result = await syncOuraDataType(user, mockOura as never, 'dailySleep', accessToken)

    expect(result.status).toBe('success')
    expect(result.records_processed).toBe(1)

    // Should mark as syncing, then idle
    expect(db.upsertSyncState).toHaveBeenCalledTimes(2)
    expect(db.upsertSyncState).toHaveBeenCalledWith(user, expect.objectContaining({ status: 'syncing' }))
    expect(db.upsertSyncState).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ last_sync_time: expect.any(Date), status: 'idle' }),
    )
  })
})
