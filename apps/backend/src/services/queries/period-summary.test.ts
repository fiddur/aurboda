import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../../db/index.ts'
import { getPeriodSummary } from './period-summary.ts'

// Mock the db module
vi.mock('../../db', () => ({
  getActivities: vi.fn(),
  getDailyAggregates: vi.fn(),
  getSleepSessions: vi.fn(),
  getTimeSeries: vi.fn(),
  getTimeSeriesStats: vi.fn(),
  getUserSettings: vi.fn(),
}))

describe('getPeriodSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('calculates stats for requested metrics', async () => {
    vi.mocked(db.getTimeSeriesStats)
      .mockResolvedValueOnce([
        { avg: 45, count: 30, max: 65, metric: 'hrv_rmssd', min: 25, stddev: 10, unit: 'ms' },
      ])
      .mockResolvedValueOnce([
        { avg: 40, count: 30, max: 55, metric: 'hrv_rmssd', min: 20, stddev: 8, unit: 'ms' },
      ])

    vi.mocked(db.getDailyAggregates).mockResolvedValue([
      { avg: 40, date: '2024-01-01', metric: 'hrv_rmssd', sum: 40 },
      { avg: 45, date: '2024-01-02', metric: 'hrv_rmssd', sum: 45 },
      { avg: 50, date: '2024-01-03', metric: 'hrv_rmssd', sum: 50 },
    ])

    const result = await getPeriodSummary(
      'testuser',
      ['hrv_rmssd'],
      new Date('2024-01-01'),
      new Date('2024-01-31'),
    )

    expect(result.metrics).toHaveLength(1)
    expect(result.metrics[0].metric).toBe('hrv_rmssd')
    expect(result.metrics[0].avg).toBe(45)
    expect(result.metrics[0].min).toBe(25)
    expect(result.metrics[0].max).toBe(65)
    expect(result.metrics[0].stddev).toBe(10)
    expect(result.metrics[0].unit).toBe('ms')
  })

  test('calculates trend from daily aggregates', async () => {
    vi.mocked(db.getTimeSeriesStats).mockResolvedValue([
      { avg: 45, count: 30, max: 65, metric: 'hrv_rmssd', min: 25, stddev: 10, unit: 'ms' },
    ])

    // Linear increase: 40, 45, 50 -> slope = 5
    vi.mocked(db.getDailyAggregates).mockResolvedValue([
      { avg: 40, date: '2024-01-01', metric: 'hrv_rmssd', sum: 40 },
      { avg: 45, date: '2024-01-02', metric: 'hrv_rmssd', sum: 45 },
      { avg: 50, date: '2024-01-03', metric: 'hrv_rmssd', sum: 50 },
    ])

    const result = await getPeriodSummary(
      'testuser',
      ['hrv_rmssd'],
      new Date('2024-01-01'),
      new Date('2024-01-03'),
    )

    expect(result.metrics[0].trend_per_day).toBe(5)
  })

  test('calculates change from previous period', async () => {
    // Current period: avg 50, previous period: avg 40 -> +25% change
    vi.mocked(db.getTimeSeriesStats)
      .mockResolvedValueOnce([
        { avg: 50, count: 30, max: 60, metric: 'hrv_rmssd', min: 40, stddev: 5, unit: 'ms' },
      ])
      .mockResolvedValueOnce([
        { avg: 40, count: 30, max: 50, metric: 'hrv_rmssd', min: 30, stddev: 5, unit: 'ms' },
      ])

    vi.mocked(db.getDailyAggregates).mockResolvedValue([])

    const result = await getPeriodSummary(
      'testuser',
      ['hrv_rmssd'],
      new Date('2024-01-01'),
      new Date('2024-01-31'),
    )

    expect(result.metrics[0].change_from_previous_period_percent).toBe(25)
  })

  test('identifies outliers beyond 2 stddev', async () => {
    // avg=50, stddev=10 -> outlier threshold is 20
    // max=85 is beyond avg+2*stddev (70) -> outlier
    vi.mocked(db.getTimeSeriesStats).mockResolvedValue([
      { avg: 50, count: 30, max: 85, metric: 'hrv_rmssd', min: 20, stddev: 10, unit: 'ms' },
    ])
    vi.mocked(db.getDailyAggregates).mockResolvedValue([])

    const result = await getPeriodSummary(
      'testuser',
      ['hrv_rmssd'],
      new Date('2024-01-01'),
      new Date('2024-01-31'),
    )

    expect(result.metrics[0].outliers).toBeDefined()
    expect(result.metrics[0].outliers).toContainEqual({ type: 'high', value: 85 })
  })

  test('adds missing metrics with zero values', async () => {
    vi.mocked(db.getTimeSeriesStats).mockResolvedValue([])
    vi.mocked(db.getDailyAggregates).mockResolvedValue([])

    const result = await getPeriodSummary(
      'testuser',
      ['hrv_rmssd', 'heart_rate'],
      new Date('2024-01-01'),
      new Date('2024-01-31'),
    )

    expect(result.metrics).toHaveLength(2)
    expect(result.metrics[0].count).toBe(0)
    expect(result.metrics[0].completeness_percent).toBe(0)
    expect(result.metrics[1].count).toBe(0)
  })

  test('calculates completeness percentage', async () => {
    vi.mocked(db.getTimeSeriesStats).mockResolvedValue([
      { avg: 50, count: 15, max: 60, metric: 'hrv_rmssd', min: 40, stddev: 5, unit: 'ms' },
    ])

    // 15 days of data out of 31 days
    vi.mocked(db.getDailyAggregates).mockResolvedValue(
      Array.from({ length: 15 }, (_, i) => ({
        avg: 50,
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        metric: 'hrv_rmssd' as const,
        sum: 50,
      })),
    )

    const result = await getPeriodSummary(
      'testuser',
      ['hrv_rmssd'],
      new Date('2024-01-01'),
      new Date('2024-01-31'),
    )

    expect(result.metrics[0].completeness_percent).toBe(50) // 15/30 = 50%
  })

  test('computes HR zone metrics from heart_rate data', async () => {
    // HR zone metrics should be computed from heart_rate data, not stored directly
    vi.mocked(db.getTimeSeriesStats).mockResolvedValue([])
    vi.mocked(db.getDailyAggregates).mockResolvedValue([])
    vi.mocked(db.getUserSettings).mockResolvedValue(null) // Use default HR zones

    // Mock heart rate data with samples in different zones
    // Default zones with age ~40 (max HR 180): 1=90, 2=108, 3=126, 4=144, 5=162
    vi.mocked(db.getTimeSeries).mockResolvedValue([
      [new Date('2024-01-15T10:00:00Z'), 70], // Zone 0 (below 90)
      [new Date('2024-01-15T10:00:02Z'), 70], // Zone 0
      [new Date('2024-01-15T10:00:04Z'), 95], // Zone 1 (90-107)
      [new Date('2024-01-15T10:00:06Z'), 115], // Zone 2 (108-125)
      [new Date('2024-01-15T10:00:08Z'), 130], // Zone 3 (126-143)
      [new Date('2024-01-15T10:00:10Z'), 150], // Zone 4 (144-161)
      [new Date('2024-01-15T10:00:12Z'), 170], // Zone 5 (>=162)
    ])

    const result = await getPeriodSummary(
      'testuser',
      ['hr_zone_1_sec', 'hr_zone_2_sec', 'hr_zone_5_sec'],
      new Date('2024-01-15'),
      new Date('2024-01-15T23:59:59Z'),
    )

    expect(result.metrics).toHaveLength(3)

    const zone1 = result.metrics.find((m) => m.metric === 'hr_zone_1_sec')
    const zone2 = result.metrics.find((m) => m.metric === 'hr_zone_2_sec')
    const zone5 = result.metrics.find((m) => m.metric === 'hr_zone_5_sec')

    expect(zone1).toBeDefined()
    expect(zone2).toBeDefined()
    expect(zone5).toBeDefined()

    // Each zone should have sum as avg (total seconds) and count of 1
    expect(zone1!.count).toBe(1)
    expect(zone1!.unit).toBe('sec')
    expect(zone1!.avg).toBeGreaterThan(0) // Should have some time in zone 1
    expect(zone5!.avg).toBeGreaterThan(0) // Should have some time in zone 5
  })

  test('computes HR zone metrics using custom user HR zones', async () => {
    vi.mocked(db.getTimeSeriesStats).mockResolvedValue([])
    vi.mocked(db.getDailyAggregates).mockResolvedValue([])

    // Custom zones: zone 1 starts at 70 (lower than default 90)
    vi.mocked(db.getUserSettings).mockResolvedValue({
      hr_zone_start: { 1: 70, 2: 100, 3: 130, 4: 150, 5: 170 },
    })

    // HR at 75 - would be zone 0 with defaults (90), but zone 1 with custom (70)
    vi.mocked(db.getTimeSeries).mockResolvedValue([
      [new Date('2024-01-15T10:00:00Z'), 75],
      [new Date('2024-01-15T10:00:02Z'), 75],
    ])

    const result = await getPeriodSummary(
      'testuser',
      ['hr_zone_0_sec', 'hr_zone_1_sec'],
      new Date('2024-01-15'),
      new Date('2024-01-15T23:59:59Z'),
    )

    const zone0 = result.metrics.find((m) => m.metric === 'hr_zone_0_sec')
    const zone1 = result.metrics.find((m) => m.metric === 'hr_zone_1_sec')

    // With custom zones, HR of 75 is in zone 1, not zone 0
    expect(zone0!.avg).toBe(0)
    expect(zone1!.avg).toBeGreaterThan(0)
  })

  test('returns zero for HR zone metrics when no heart_rate data', async () => {
    vi.mocked(db.getTimeSeriesStats).mockResolvedValue([])
    vi.mocked(db.getDailyAggregates).mockResolvedValue([])
    vi.mocked(db.getUserSettings).mockResolvedValue(null)
    vi.mocked(db.getTimeSeries).mockResolvedValue([])

    const result = await getPeriodSummary(
      'testuser',
      ['hr_zone_1_sec'],
      new Date('2024-01-15'),
      new Date('2024-01-15T23:59:59Z'),
    )

    const zone1 = result.metrics.find((m) => m.metric === 'hr_zone_1_sec')
    expect(zone1!.avg).toBe(0)
    expect(zone1!.count).toBe(0)
  })

  test('mixes regular metrics with HR zone metrics', async () => {
    // Regular metric stats
    vi.mocked(db.getTimeSeriesStats).mockResolvedValue([
      { avg: 72, count: 100, max: 150, metric: 'heart_rate', min: 55, stddev: 15, unit: 'bpm' },
    ])
    vi.mocked(db.getDailyAggregates).mockResolvedValue([])
    vi.mocked(db.getUserSettings).mockResolvedValue(null)

    // HR data for zone calculation
    vi.mocked(db.getTimeSeries).mockResolvedValue([
      [new Date('2024-01-15T10:00:00Z'), 95],
      [new Date('2024-01-15T10:00:02Z'), 95],
    ])

    const result = await getPeriodSummary(
      'testuser',
      ['heart_rate', 'hr_zone_1_sec'],
      new Date('2024-01-15'),
      new Date('2024-01-15T23:59:59Z'),
    )

    expect(result.metrics).toHaveLength(2)

    const heartRate = result.metrics.find((m) => m.metric === 'heart_rate')
    const zone1 = result.metrics.find((m) => m.metric === 'hr_zone_1_sec')

    expect(heartRate).toBeDefined()
    expect(heartRate!.avg).toBe(72)
    expect(zone1).toBeDefined()
    expect(zone1!.avg).toBeGreaterThan(0)
  })

  test('computes contextual HRV stats from classified HRV data', async () => {
    // No regular metrics
    vi.mocked(db.getTimeSeriesStats).mockResolvedValue([])
    vi.mocked(db.getDailyAggregates).mockResolvedValue([])

    // HRV data during sleep hours
    vi.mocked(db.getTimeSeries).mockResolvedValue([
      [new Date('2024-01-15T01:00:00Z'), 40],
      [new Date('2024-01-15T02:00:00Z'), 45],
      [new Date('2024-01-15T03:00:00Z'), 50],
      [new Date('2024-01-15T04:00:00Z'), 55],
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

    const result = await getPeriodSummary(
      'testuser',
      ['hrv_sleep'],
      new Date('2024-01-15'),
      new Date('2024-01-15T23:59:59Z'),
    )

    expect(result.metrics).toHaveLength(1)
    const hrvSleep = result.metrics[0]
    expect(hrvSleep.metric).toBe('hrv_sleep')
    expect(hrvSleep.avg).toBe(47.5)
    expect(hrvSleep.min).toBe(40)
    expect(hrvSleep.max).toBe(55)
    expect(hrvSleep.count).toBe(4)
    expect(hrvSleep.unit).toBe('ms')
  })

  test('computes contextual HRV with previous period comparison', async () => {
    vi.mocked(db.getTimeSeriesStats).mockResolvedValue([])
    vi.mocked(db.getDailyAggregates).mockResolvedValue([])

    // Current period: HRV during sleep = avg 50
    // Previous period: HRV during sleep = avg 40
    // -> +25% change
    vi.mocked(db.getTimeSeries)
      .mockResolvedValueOnce([
        // Current period hrv_rmssd
        [new Date('2024-01-15T02:00:00Z'), 45],
        [new Date('2024-01-15T03:00:00Z'), 55],
      ])
      .mockResolvedValueOnce([
        // Previous period hrv_rmssd
        [new Date('2024-01-14T02:00:00Z'), 35],
        [new Date('2024-01-14T03:00:00Z'), 45],
      ])

    // Sleep sessions for both periods
    vi.mocked(db.getSleepSessions)
      .mockResolvedValueOnce([
        {
          activity_type: 'sleep',
          end_time: new Date('2024-01-15T07:00:00Z'),
          source: 'oura',
          start_time: new Date('2024-01-15T00:00:00Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          activity_type: 'sleep',
          end_time: new Date('2024-01-14T07:00:00Z'),
          source: 'oura',
          start_time: new Date('2024-01-14T00:00:00Z'),
        },
      ])

    vi.mocked(db.getActivities).mockResolvedValue([])

    const result = await getPeriodSummary(
      'testuser',
      ['hrv_sleep'],
      new Date('2024-01-15'),
      new Date('2024-01-15T23:59:59Z'),
    )

    expect(result.metrics).toHaveLength(1)
    expect(result.metrics[0].change_from_previous_period_percent).toBe(25)
  })

  test('returns zero stats for contextual HRV with no matching data', async () => {
    vi.mocked(db.getTimeSeriesStats).mockResolvedValue([])
    vi.mocked(db.getDailyAggregates).mockResolvedValue([])
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getActivities).mockResolvedValue([])

    const result = await getPeriodSummary(
      'testuser',
      ['hrv_sleep'],
      new Date('2024-01-15'),
      new Date('2024-01-15T23:59:59Z'),
    )

    expect(result.metrics).toHaveLength(1)
    expect(result.metrics[0].metric).toBe('hrv_sleep')
    expect(result.metrics[0].count).toBe(0)
    expect(result.metrics[0].avg).toBe(0)
  })

  test('mixes regular metrics with contextual HRV metrics', async () => {
    // Regular metric stats for heart_rate
    vi.mocked(db.getTimeSeriesStats).mockResolvedValue([
      { avg: 72, count: 100, max: 150, metric: 'heart_rate', min: 55, stddev: 15, unit: 'bpm' },
    ])
    vi.mocked(db.getDailyAggregates).mockResolvedValue([])

    // HRV data during sleep
    vi.mocked(db.getTimeSeries).mockResolvedValue([
      [new Date('2024-01-15T02:00:00Z'), 42],
      [new Date('2024-01-15T03:00:00Z'), 48],
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

    const result = await getPeriodSummary(
      'testuser',
      ['heart_rate', 'hrv_sleep'],
      new Date('2024-01-15'),
      new Date('2024-01-15T23:59:59Z'),
    )

    expect(result.metrics).toHaveLength(2)

    const heartRate = result.metrics.find((m) => m.metric === 'heart_rate')
    const hrvSleep = result.metrics.find((m) => m.metric === 'hrv_sleep')

    expect(heartRate).toBeDefined()
    expect(heartRate!.avg).toBe(72)
    expect(hrvSleep).toBeDefined()
    expect(hrvSleep!.avg).toBe(45)
    expect(hrvSleep!.count).toBe(2)
  })
})
