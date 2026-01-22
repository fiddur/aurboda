import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as db from './db'
import { calculateRetryAfter, isRateLimited, processOuraData } from './oura-sync'

// Mock the db module
vi.mock('./db', () => ({
  getSyncState: vi.fn(),
  insertActivity: vi.fn(),
  insertRawRecord: vi.fn(),
  insertTag: vi.fn(),
  insertTimeSeries: vi.fn(),
  upsertSyncState: vi.fn(),
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
        dataType: 'dailyReadiness',
        provider: 'oura',
        retryAfter: new Date('2025-01-01T13:00:00Z'),
        status: 'idle',
      }),
    ).toBe(false)
  })

  test('returns false when retryAfter is in the past', () => {
    expect(
      isRateLimited({
        dataType: 'dailyReadiness',
        provider: 'oura',
        retryAfter: new Date('2025-01-01T11:00:00Z'),
        status: 'rate_limited',
      }),
    ).toBe(false)
  })

  test('returns true when rate_limited and retryAfter is in the future', () => {
    expect(
      isRateLimited({
        dataType: 'dailyReadiness',
        provider: 'oura',
        retryAfter: new Date('2025-01-01T13:00:00Z'),
        status: 'rate_limited',
      }),
    ).toBe(true)
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
        externalId: 'cv-1',
        recordType: 'daily_cardiovascular_age',
        recordedAt: new Date('2025-01-01T00:00:00Z'),
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
        externalId: 'rd-1',
        recordType: 'daily_readiness',
        recordedAt: new Date('2025-01-01T06:00:00Z'),
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
        externalId: 'sl-1',
        recordType: 'daily_sleep',
        recordedAt: new Date('2025-01-01T07:00:00Z'),
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
          heartRate: { items: [60, 62, 58] },
          hrv: { items: [50, 55] },
          id: 'sess-1',
          mood: 'good',
          motion: { items: [1, 0, 2] },
          startTime: new Date('2025-01-01T10:00:00Z'),
          type: 'meditation',
        },
      ]

      await processOuraData(user, 'sessions', data)

      expect(db.insertRawRecord).toHaveBeenCalledWith(user, {
        data: data[0],
        externalId: 'sess-1',
        recordType: 'session',
        recordedAt: new Date('2025-01-01T10:00:00Z'),
        source: 'oura',
      })

      expect(db.insertActivity).toHaveBeenCalledWith(user, {
        activityType: 'meditation',
        data: {
          heartRate: data[0].heartRate,
          hrv: data[0].hrv,
          mood: 'good',
          motion: data[0].motion,
          sessionType: 'meditation',
        },
        endTime: new Date('2025-01-01T10:30:00Z'),
        source: 'oura',
        startTime: new Date('2025-01-01T10:00:00Z'),
        title: 'meditation',
      })
    })
  })

  describe('tags', () => {
    test('processes tag data with custom name', async () => {
      // Data is pre-transformed by oura.ts getTags()
      const data = [
        {
          endTime: new Date('2025-01-01T08:05:00Z'),
          externalId: 'tag-1',
          source: 'oura',
          startTime: new Date('2025-01-01T08:00:00Z'),
          tag: 'Morning Coffee',
        },
      ]

      await processOuraData(user, 'tags', data)

      expect(db.insertRawRecord).toHaveBeenCalledWith(user, {
        data: data[0],
        externalId: 'tag-1',
        recordType: 'enhanced_tag',
        recordedAt: new Date('2025-01-01T08:00:00Z'),
        source: 'oura',
      })

      expect(db.insertTag).toHaveBeenCalledWith(user, {
        endTime: new Date('2025-01-01T08:05:00Z'),
        externalId: 'tag-1',
        source: 'oura',
        startTime: new Date('2025-01-01T08:00:00Z'),
        tag: 'Morning Coffee',
      })
    })

    test('processes tag data without endTime', async () => {
      // Data is pre-transformed by oura.ts getTags()
      const data = [
        {
          endTime: undefined,
          externalId: 'tag-2',
          source: 'oura',
          startTime: new Date('2025-01-01T14:00:00Z'),
          tag: 'stress_high',
        },
      ]

      await processOuraData(user, 'tags', data)

      expect(db.insertTag).toHaveBeenCalledWith(user, {
        endTime: undefined,
        externalId: 'tag-2',
        source: 'oura',
        startTime: new Date('2025-01-01T14:00:00Z'),
        tag: 'stress_high',
      })
    })

    test('handles tag with unknown type', async () => {
      // Data is pre-transformed by oura.ts getTags() - 'unknown' is set by oura.ts when tag_type_code is null
      const data = [
        {
          endTime: undefined,
          externalId: 'tag-3',
          source: 'oura',
          startTime: new Date('2025-01-01T14:00:00Z'),
          tag: 'unknown',
        },
      ]

      await processOuraData(user, 'tags', data)

      expect(db.insertTag).toHaveBeenCalledWith(user, {
        endTime: undefined,
        externalId: 'tag-3',
        source: 'oura',
        startTime: new Date('2025-01-01T14:00:00Z'),
        tag: 'unknown',
      })
    })
  })
})
