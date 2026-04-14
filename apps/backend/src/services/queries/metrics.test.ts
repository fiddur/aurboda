import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { BucketedMetricData } from '../../db/types.ts'
import type { MetricType } from '../../schema.ts'

import * as db from '../../db/index.ts'
import { parseBucketSize, queryMetrics, queryMetricsBucketed } from './metrics.ts'

// Mock the db module
vi.mock('../../db', () => ({
  getActivities: vi.fn(),
  getDistinctMetrics: vi.fn(),
  getSleepSessions: vi.fn(),
  getTimeSeries: vi.fn(),
  getTimeSeriesBucketed: vi.fn(),
  getTimeSeriesWithSource: vi.fn(),
  getUserSettings: vi.fn(),
}))

describe('queryMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns formatted time series data with source', async () => {
    const mockData = [
      { source: 'oura', time: new Date('2024-01-01T10:00:00Z'), value: 72 },
      { source: 'oura', time: new Date('2024-01-01T11:00:00Z'), value: 75 },
      { source: 'manual', time: new Date('2024-01-01T12:00:00Z'), value: 68 },
    ]
    vi.mocked(db.getTimeSeriesWithSource).mockResolvedValue(mockData)

    const result = await queryMetrics(
      'testuser',
      'heart_rate',
      new Date('2024-01-01'),
      new Date('2024-01-02'),
    )

    expect(result.metric).toBe('heart_rate')
    expect(result.unit).toBe('bpm')
    expect(result.count).toBe(3)
    expect(result.data).toHaveLength(3)
    expect(result.data[0]).toEqual({ source: 'oura', time: '2024-01-01T10:00:00.000Z', value: 72 })
    expect(result.data[2]).toEqual({ source: 'manual', time: '2024-01-01T12:00:00.000Z', value: 68 })
  })

  test('returns empty data when no records', async () => {
    vi.mocked(db.getTimeSeriesWithSource).mockResolvedValue([])

    const result = await queryMetrics(
      'testuser',
      'heart_rate',
      new Date('2024-01-01'),
      new Date('2024-01-02'),
    )

    expect(result.count).toBe(0)
    expect(result.data).toHaveLength(0)
  })
})

describe('queryMetricsBucketed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns bucketed data for a single metric', async () => {
    const mockBuckets: BucketedMetricData[] = [
      {
        avg: 72,
        bucket_start: new Date('2024-01-15T06:00:00Z'),
        count: 300,
        max: 80,
        metric: 'heart_rate',
        min: 65,
        sum: 0,
      },
      {
        avg: 78,
        bucket_start: new Date('2024-01-15T06:15:00Z'),
        count: 280,
        max: 85,
        metric: 'heart_rate',
        min: 70,
        sum: 0,
      },
    ]
    vi.mocked(db.getTimeSeriesBucketed).mockResolvedValue(mockBuckets)

    const result = await queryMetricsBucketed(
      'testuser',
      ['heart_rate'],
      new Date('2024-01-15T06:00:00Z'),
      new Date('2024-01-15T06:30:00Z'),
      '15m',
    )

    expect(result.buckets).toHaveLength(2)
    expect(result.bucket).toBe('15m')
    expect(result.buckets[0]).toEqual({
      end: '2024-01-15T06:15:00.000Z',
      metrics: {
        heart_rate: { avg: 72, count: 300, max: 80, min: 65 },
      },
      start: '2024-01-15T06:00:00.000Z',
    })
    expect(result.buckets[1]).toEqual({
      end: '2024-01-15T06:30:00.000Z',
      metrics: {
        heart_rate: { avg: 78, count: 280, max: 85, min: 70 },
      },
      start: '2024-01-15T06:15:00.000Z',
    })
  })

  test('returns bucketed data for multiple metrics', async () => {
    const mockBuckets: BucketedMetricData[] = [
      {
        avg: 72,
        bucket_start: new Date('2024-01-15T06:00:00Z'),
        count: 300,
        max: 80,
        metric: 'heart_rate',
        min: 65,
        sum: 0,
      },
      {
        avg: 45,
        bucket_start: new Date('2024-01-15T06:00:00Z'),
        count: 100,
        max: 60,
        metric: 'hrv_rmssd',
        min: 30,
        sum: 0,
      },
      {
        avg: 78,
        bucket_start: new Date('2024-01-15T06:15:00Z'),
        count: 280,
        max: 85,
        metric: 'heart_rate',
        min: 70,
        sum: 0,
      },
      {
        avg: 42,
        bucket_start: new Date('2024-01-15T06:15:00Z'),
        count: 90,
        max: 55,
        metric: 'hrv_rmssd',
        min: 28,
        sum: 0,
      },
    ]
    vi.mocked(db.getTimeSeriesBucketed).mockResolvedValue(mockBuckets)

    const result = await queryMetricsBucketed(
      'testuser',
      ['heart_rate', 'hrv_rmssd'],
      new Date('2024-01-15T06:00:00Z'),
      new Date('2024-01-15T06:30:00Z'),
      '15m',
    )

    expect(result.buckets).toHaveLength(2)
    expect(result.buckets[0].metrics).toEqual({
      heart_rate: { avg: 72, count: 300, max: 80, min: 65 },
      hrv_rmssd: { avg: 45, count: 100, max: 60, min: 30 },
    })
    expect(result.buckets[1].metrics).toEqual({
      heart_rate: { avg: 78, count: 280, max: 85, min: 70 },
      hrv_rmssd: { avg: 42, count: 90, max: 55, min: 28 },
    })
  })

  test('returns empty buckets array when no data', async () => {
    vi.mocked(db.getTimeSeriesBucketed).mockResolvedValue([])

    const result = await queryMetricsBucketed(
      'testuser',
      ['heart_rate'],
      new Date('2024-01-15T06:00:00Z'),
      new Date('2024-01-15T06:30:00Z'),
      '15m',
    )

    expect(result.buckets).toHaveLength(0)
  })

  test('handles 5m bucket interval', async () => {
    const mockBuckets: BucketedMetricData[] = [
      {
        avg: 72,
        bucket_start: new Date('2024-01-15T06:00:00Z'),
        count: 100,
        max: 80,
        metric: 'heart_rate',
        min: 65,
        sum: 0,
      },
    ]
    vi.mocked(db.getTimeSeriesBucketed).mockResolvedValue(mockBuckets)

    const result = await queryMetricsBucketed(
      'testuser',
      ['heart_rate'],
      new Date('2024-01-15T06:00:00Z'),
      new Date('2024-01-15T06:05:00Z'),
      '5m',
    )

    expect(result.bucket).toBe('5m')
    expect(result.buckets[0].end).toBe('2024-01-15T06:05:00.000Z')
    expect(db.getTimeSeriesBucketed).toHaveBeenCalledWith(
      'testuser',
      ['heart_rate'],
      expect.any(Date),
      expect.any(Date),
      '5 minutes',
      'UTC',
    )
  })

  test('handles 1h bucket interval', async () => {
    const mockBuckets: BucketedMetricData[] = [
      {
        avg: 72,
        bucket_start: new Date('2024-01-15T06:00:00Z'),
        count: 1200,
        max: 80,
        metric: 'heart_rate',
        min: 65,
        sum: 0,
      },
    ]
    vi.mocked(db.getTimeSeriesBucketed).mockResolvedValue(mockBuckets)

    const result = await queryMetricsBucketed(
      'testuser',
      ['heart_rate'],
      new Date('2024-01-15T06:00:00Z'),
      new Date('2024-01-15T07:00:00Z'),
      '1h',
    )

    expect(result.bucket).toBe('1h')
    expect(result.buckets[0].end).toBe('2024-01-15T07:00:00.000Z')
    expect(db.getTimeSeriesBucketed).toHaveBeenCalledWith(
      'testuser',
      ['heart_rate'],
      expect.any(Date),
      expect.any(Date),
      '1 hours',
      'UTC',
    )
  })

  test('handles 1d bucket interval', async () => {
    const mockBuckets: BucketedMetricData[] = [
      {
        avg: 72,
        bucket_start: new Date('2024-01-15T00:00:00Z'),
        count: 28800,
        max: 120,
        metric: 'heart_rate',
        min: 55,
        sum: 0,
      },
    ]
    vi.mocked(db.getTimeSeriesBucketed).mockResolvedValue(mockBuckets)

    const result = await queryMetricsBucketed(
      'testuser',
      ['heart_rate'],
      new Date('2024-01-15T00:00:00Z'),
      new Date('2024-01-16T00:00:00Z'),
      '1d',
    )

    expect(result.bucket).toBe('1d')
    expect(result.buckets[0].end).toBe('2024-01-16T00:00:00.000Z')
    expect(db.getTimeSeriesBucketed).toHaveBeenCalledWith(
      'testuser',
      ['heart_rate'],
      expect.any(Date),
      expect.any(Date),
      '1 days',
      'UTC',
    )
  })

  test('handles buckets with partial metric coverage', async () => {
    // Only heart_rate has data in second bucket, not hrv_rmssd
    const mockBuckets: BucketedMetricData[] = [
      {
        avg: 72,
        bucket_start: new Date('2024-01-15T06:00:00Z'),
        count: 300,
        max: 80,
        metric: 'heart_rate',
        min: 65,
        sum: 0,
      },
      {
        avg: 45,
        bucket_start: new Date('2024-01-15T06:00:00Z'),
        count: 100,
        max: 60,
        metric: 'hrv_rmssd',
        min: 30,
        sum: 0,
      },
      {
        avg: 78,
        bucket_start: new Date('2024-01-15T06:15:00Z'),
        count: 280,
        max: 85,
        metric: 'heart_rate',
        min: 70,
        sum: 0,
      },
      // No hrv_rmssd data for 06:15 bucket
    ]
    vi.mocked(db.getTimeSeriesBucketed).mockResolvedValue(mockBuckets)

    const result = await queryMetricsBucketed(
      'testuser',
      ['heart_rate', 'hrv_rmssd'],
      new Date('2024-01-15T06:00:00Z'),
      new Date('2024-01-15T06:30:00Z'),
      '15m',
    )

    expect(result.buckets).toHaveLength(2)
    // First bucket has both metrics
    expect(result.buckets[0].metrics.heart_rate).toBeDefined()
    expect(result.buckets[0].metrics.hrv_rmssd).toBeDefined()
    // Second bucket only has heart_rate
    expect(result.buckets[1].metrics.heart_rate).toBeDefined()
    expect(result.buckets[1].metrics.hrv_rmssd).toBeUndefined()
  })

  test('returns bucketed data for contextual HRV metric (hrv_sleep)', async () => {
    // Raw HRV data during sleep
    vi.mocked(db.getTimeSeries).mockResolvedValue([
      [new Date('2024-01-15T02:00:00Z'), 45],
      [new Date('2024-01-15T03:00:00Z'), 48],
      [new Date('2024-01-15T04:00:00Z'), 50],
    ])

    // Sleep session covering the HRV data
    vi.mocked(db.getSleepSessions).mockResolvedValue([
      {
        activity_type: 'sleep',
        end_time: new Date('2024-01-15T07:00:00Z'),
        source: 'oura',
        start_time: new Date('2024-01-15T00:00:00Z'),
      },
    ])

    // No exercise
    vi.mocked(db.getActivities).mockResolvedValue([])

    const result = await queryMetricsBucketed(
      'testuser',
      ['hrv_sleep'],
      new Date('2024-01-15T00:00:00Z'),
      new Date('2024-01-15T08:00:00Z'),
      '1h',
    )

    // Should have buckets for the hours with HRV data during sleep
    expect(result.buckets.length).toBeGreaterThan(0)

    // All returned data should be hrv_sleep
    for (const bucket of result.buckets) {
      if (bucket.metrics.hrv_sleep) {
        expect(bucket.metrics.hrv_sleep.avg).toBeGreaterThan(0)
        expect(bucket.metrics.hrv_sleep.count).toBeGreaterThan(0)
      }
    }
  })

  test('returns bucketed data for mixed regular and contextual HRV metrics', async () => {
    // Mock regular bucketed data for heart_rate
    vi.mocked(db.getTimeSeriesBucketed).mockResolvedValue([
      {
        avg: 72,
        bucket_start: new Date('2024-01-15T02:00:00Z'),
        count: 100,
        max: 80,
        metric: 'heart_rate' as MetricType,
        min: 65,
        sum: 0,
      },
    ])

    // Raw HRV data for contextual processing
    vi.mocked(db.getTimeSeries).mockResolvedValue([[new Date('2024-01-15T02:30:00Z'), 45]])

    // Sleep session
    vi.mocked(db.getSleepSessions).mockResolvedValue([
      {
        activity_type: 'sleep',
        end_time: new Date('2024-01-15T07:00:00Z'),
        source: 'oura',
        start_time: new Date('2024-01-15T00:00:00Z'),
      },
    ])

    // No exercise
    vi.mocked(db.getActivities).mockResolvedValue([])

    const result = await queryMetricsBucketed(
      'testuser',
      ['heart_rate', 'hrv_sleep'],
      new Date('2024-01-15T00:00:00Z'),
      new Date('2024-01-15T08:00:00Z'),
      '1h',
    )

    // Should have bucket with heart_rate from regular query
    const bucketWithHr = result.buckets.find((b) => b.metrics.heart_rate)
    expect(bucketWithHr).toBeDefined()
    expect(bucketWithHr!.metrics.heart_rate?.avg).toBe(72)

    // Should have bucket with hrv_sleep from contextual query
    const bucketWithHrvSleep = result.buckets.find((b) => b.metrics.hrv_sleep)
    expect(bucketWithHrvSleep).toBeDefined()
  })

  test('returns empty contextual HRV when no HRV data during context', async () => {
    // HRV data only during awake hours
    vi.mocked(db.getTimeSeries).mockResolvedValue([
      [new Date('2024-01-15T12:00:00Z'), 30],
      [new Date('2024-01-15T14:00:00Z'), 28],
    ])

    // Sleep session doesn't overlap with HRV data
    vi.mocked(db.getSleepSessions).mockResolvedValue([
      {
        activity_type: 'sleep',
        end_time: new Date('2024-01-15T07:00:00Z'),
        source: 'oura',
        start_time: new Date('2024-01-15T00:00:00Z'),
      },
    ])

    // No exercise
    vi.mocked(db.getActivities).mockResolvedValue([])

    const result = await queryMetricsBucketed(
      'testuser',
      ['hrv_sleep'],
      new Date('2024-01-15T00:00:00Z'),
      new Date('2024-01-15T23:59:59Z'),
      '1h',
    )

    // Should have no hrv_sleep buckets since HRV data is during awake hours
    const hrvSleepBuckets = result.buckets.filter((b) => b.metrics.hrv_sleep)
    expect(hrvSleepBuckets).toHaveLength(0)
  })

  test('discovers all metrics when metrics param is omitted', async () => {
    vi.mocked(db.getDistinctMetrics).mockResolvedValue(['heart_rate', 'steps'])
    vi.mocked(db.getTimeSeriesBucketed).mockResolvedValue([
      {
        avg: 72,
        bucket_start: new Date('2024-01-15T06:00:00Z'),
        count: 60,
        max: 80,
        metric: 'heart_rate',
        min: 65,
        sum: 0,
      },
      {
        avg: 100,
        bucket_start: new Date('2024-01-15T06:00:00Z'),
        count: 12,
        max: 200,
        metric: 'steps',
        min: 0,
        sum: 1200,
      },
    ])

    const result = await queryMetricsBucketed(
      'testuser',
      undefined,
      new Date('2024-01-15T06:00:00Z'),
      new Date('2024-01-15T06:05:00Z'),
      '5m',
    )

    expect(db.getDistinctMetrics).toHaveBeenCalledWith('testuser', expect.any(Date), expect.any(Date))
    expect(result.buckets).toHaveLength(1)
    expect(result.buckets[0].metrics.heart_rate).toBeDefined()
    expect(result.buckets[0].metrics.steps).toBeDefined()
  })

  test('applies exclude filter to discovered metrics', async () => {
    vi.mocked(db.getDistinctMetrics).mockResolvedValue(['heart_rate', 'steps', 'training_impulse'])
    vi.mocked(db.getTimeSeriesBucketed).mockResolvedValue([
      {
        avg: 72,
        bucket_start: new Date('2024-01-15T06:00:00Z'),
        count: 60,
        max: 80,
        metric: 'heart_rate',
        min: 65,
        sum: 0,
      },
    ])

    const result = await queryMetricsBucketed(
      'testuser',
      undefined,
      new Date('2024-01-15T06:00:00Z'),
      new Date('2024-01-15T06:05:00Z'),
      '5m',
      { exclude: ['training_impulse', 'steps'] },
    )

    // Only heart_rate should be queried (steps and training_impulse excluded)
    expect(db.getTimeSeriesBucketed).toHaveBeenCalledWith(
      'testuser',
      ['heart_rate'],
      expect.any(Date),
      expect.any(Date),
      '5 minutes',
      'UTC',
    )
    expect(result.buckets).toHaveLength(1)
    expect(result.buckets[0].metrics.heart_rate).toBeDefined()
    expect(result.buckets[0].metrics.training_impulse).toBeUndefined()
  })

  test('includes sum for cumulative metrics', async () => {
    vi.mocked(db.getTimeSeriesBucketed).mockResolvedValue([
      {
        avg: 100,
        bucket_start: new Date('2024-01-15T06:00:00Z'),
        count: 12,
        max: 200,
        metric: 'steps',
        min: 0,
        sum: 1200,
      },
    ])

    const result = await queryMetricsBucketed(
      'testuser',
      ['steps'],
      new Date('2024-01-15T06:00:00Z'),
      new Date('2024-01-15T06:05:00Z'),
      '5m',
    )

    expect(result.buckets).toHaveLength(1)
    const steps = result.buckets[0]!.metrics.steps!
    expect(steps).toBeDefined()
    expect(steps.sum).toBe(1200)
    expect(steps.avg).toBe(100)
  })

  test('omits sum for non-cumulative metrics', async () => {
    vi.mocked(db.getTimeSeriesBucketed).mockResolvedValue([
      {
        avg: 72,
        bucket_start: new Date('2024-01-15T06:00:00Z'),
        count: 60,
        max: 80,
        metric: 'heart_rate',
        min: 65,
        sum: 4320,
      },
    ])

    const result = await queryMetricsBucketed(
      'testuser',
      ['heart_rate'],
      new Date('2024-01-15T06:00:00Z'),
      new Date('2024-01-15T06:05:00Z'),
      '5m',
    )

    expect(result.buckets).toHaveLength(1)
    const hr = result.buckets[0]!.metrics.heart_rate!
    expect(hr).toBeDefined()
    expect(hr.sum).toBeUndefined()
    expect(hr.avg).toBe(72)
  })

  test('returns empty buckets when no metrics discovered', async () => {
    vi.mocked(db.getDistinctMetrics).mockResolvedValue([])

    const result = await queryMetricsBucketed(
      'testuser',
      undefined,
      new Date('2024-01-15T06:00:00Z'),
      new Date('2024-01-15T06:05:00Z'),
      '5m',
    )

    expect(result.buckets).toHaveLength(0)
  })
})

describe('parseBucketSize', () => {
  test('parses seconds', () => {
    expect(parseBucketSize('30s')).toEqual({ interval: '30 seconds', ms: 30000 })
  })

  test('parses minutes', () => {
    expect(parseBucketSize('5m')).toEqual({ interval: '5 minutes', ms: 300000 })
  })

  test('parses hours', () => {
    expect(parseBucketSize('1h')).toEqual({ interval: '1 hours', ms: 3600000 })
  })

  test('parses days', () => {
    expect(parseBucketSize('1d')).toEqual({ interval: '1 days', ms: 86400000 })
  })

  test('parses months', () => {
    expect(parseBucketSize('1M')).toEqual({ interval: '1 months', ms: 30 * 86400000 })
  })

  test('throws on invalid format', () => {
    expect(() => parseBucketSize('abc')).toThrow('Invalid bucket size')
  })

  test('throws on empty string', () => {
    expect(() => parseBucketSize('')).toThrow('Invalid bucket size')
  })
})

describe('queryMetrics with contextual HRV', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns filtered HRV data for hrv_sleep', async () => {
    // Raw HRV data - some during sleep, some during awake
    vi.mocked(db.getTimeSeries).mockResolvedValue([
      [new Date('2024-01-15T02:00:00Z'), 45],
      [new Date('2024-01-15T03:00:00Z'), 48],
      [new Date('2024-01-15T12:00:00Z'), 30], // This is during awake
    ])

    vi.mocked(db.getSleepSessions).mockResolvedValue([
      {
        activity_type: 'sleep',
        end_time: new Date('2024-01-15T07:00:00Z'),
        source: 'oura',
        start_time: new Date('2024-01-15T00:00:00Z'),
      },
    ])

    vi.mocked(db.getActivities).mockResolvedValue([])

    const result = await queryMetrics(
      'testuser',
      'hrv_sleep',
      new Date('2024-01-15T00:00:00Z'),
      new Date('2024-01-15T23:59:59Z'),
    )

    expect(result.metric).toBe('hrv_sleep')
    expect(result.unit).toBe('ms')
    // Only samples during sleep should be included
    expect(result.count).toBe(2)
    expect(result.data.map((d) => d.value)).toEqual([45, 48])
  })

  test('returns filtered HRV data for hrv_awake', async () => {
    // Raw HRV data
    vi.mocked(db.getTimeSeries).mockResolvedValue([
      [new Date('2024-01-15T02:00:00Z'), 45], // During sleep
      [new Date('2024-01-15T12:00:00Z'), 30], // During awake
      [new Date('2024-01-15T14:00:00Z'), 28], // During awake
    ])

    vi.mocked(db.getSleepSessions).mockResolvedValue([
      {
        activity_type: 'sleep',
        end_time: new Date('2024-01-15T07:00:00Z'),
        source: 'oura',
        start_time: new Date('2024-01-15T00:00:00Z'),
      },
    ])

    vi.mocked(db.getActivities).mockResolvedValue([])

    const result = await queryMetrics(
      'testuser',
      'hrv_awake',
      new Date('2024-01-15T00:00:00Z'),
      new Date('2024-01-15T23:59:59Z'),
    )

    expect(result.metric).toBe('hrv_awake')
    // Only samples during awake (not sleep, not activity) should be included
    expect(result.count).toBe(2)
    expect(result.data.map((d) => d.value)).toEqual([30, 28])
  })

  test('returns filtered HRV data for hrv_activity', async () => {
    // Raw HRV data
    vi.mocked(db.getTimeSeries).mockResolvedValue([
      [new Date('2024-01-15T10:00:00Z'), 22], // During exercise
      [new Date('2024-01-15T10:30:00Z'), 18], // During exercise
      [new Date('2024-01-15T14:00:00Z'), 30], // After exercise (awake)
    ])

    vi.mocked(db.getSleepSessions).mockResolvedValue([])

    vi.mocked(db.getActivities).mockResolvedValue([
      {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T11:00:00Z'),
        source: 'health_connect',
        start_time: new Date('2024-01-15T09:30:00Z'),
        title: 'Morning Run',
      },
    ])

    const result = await queryMetrics(
      'testuser',
      'hrv_activity',
      new Date('2024-01-15T00:00:00Z'),
      new Date('2024-01-15T23:59:59Z'),
    )

    expect(result.metric).toBe('hrv_activity')
    // Only samples during exercise should be included
    expect(result.count).toBe(2)
    expect(result.data.map((d) => d.value)).toEqual([22, 18])
  })
})
