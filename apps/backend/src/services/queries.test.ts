import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as db from '../db'
import { MetricType } from '../schema'
import * as locationsService from './locations'
import {
  getDailySummary,
  getPeriodSummary,
  mergeProductivitySpans,
  queryActivities,
  queryMetrics,
  queryMetricsBucketed,
  queryProductivity,
  queryTags,
} from './queries'

// Mock the db module
vi.mock('../db', () => ({
  getActivities: vi.fn(),
  getDailyAggregateValue: vi.fn(),
  getDailyAggregates: vi.fn(),
  getLocations: vi.fn(),
  getNotesByEntityIds: vi.fn(),
  getProductivity: vi.fn(),
  getSleepSessions: vi.fn(),
  getTags: vi.fn(),
  getTimeSeries: vi.fn(),
  getTimeSeriesBucketed: vi.fn(),
  getTimeSeriesMultiMetric: vi.fn(),
  getTimeSeriesStats: vi.fn(),
  getTimeSeriesWithSource: vi.fn(),
  getUserSettings: vi.fn(),
}))

// Mock the locations service
vi.mock('./locations', () => ({
  getPlaceVisits: vi.fn(),
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

describe('getDailySummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default mock for getUserSettings - returns null so default HR zones are used
    vi.mocked(db.getUserSettings).mockResolvedValue(null)
  })

  test('aggregates all data sources for a day', async () => {
    vi.mocked(db.getTimeSeries)
      .mockResolvedValueOnce([
        [new Date('2024-01-15T10:00:00Z'), 72],
        [new Date('2024-01-15T11:00:00Z'), 80],
        [new Date('2024-01-15T12:00:00Z'), 65],
      ])
      .mockResolvedValueOnce([
        [new Date('2024-01-15T08:00:00Z'), 5000],
        [new Date('2024-01-15T12:00:00Z'), 3000],
      ])

    // Sleep sessions now use getSleepSessions with date overlap logic
    vi.mocked(db.getSleepSessions).mockResolvedValue([
      {
        activity_type: 'sleep',
        end_time: new Date('2024-01-15T07:00:00Z'),
        source: 'oura',
        start_time: new Date('2024-01-14T23:00:00Z'),
      },
    ])

    // Exercise sessions still use getActivities
    vi.mocked(db.getActivities).mockResolvedValue([
      {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T10:30:00Z'),
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Running',
      },
    ])

    vi.mocked(db.getTags).mockResolvedValue([
      { source: 'manual', start_time: new Date('2024-01-15T08:00:00Z'), tag: 'coffee' },
    ])

    vi.mocked(db.getProductivity).mockResolvedValue([
      {
        activity: 'VS Code',
        duration_sec: 3600,
        end_time: new Date('2024-01-15T11:00:00Z'),
        productivity: 2,
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity: 'Twitter',
        duration_sec: 600,
        end_time: new Date('2024-01-15T11:20:00Z'),
        productivity: -2,
        start_time: new Date('2024-01-15T11:10:00Z'),
      },
    ])

    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([
      {
        duration_minutes: 1080,
        end_time: new Date('2024-01-15T18:00:00Z'),
        lat: 59.33,
        lon: 18.07,
        name: 'Home',
        source: 'named',
        start_time: new Date('2024-01-15T00:00:00Z'),
      },
    ])

    // No aggregate available, should fall back to summing raw records
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    expect(result.date).toBe('2024-01-15')

    // Heart rate stats
    expect(result.heart_rate).toEqual({
      avg: 72,
      count: 3,
      max: 80,
      min: 65,
    })

    // Steps
    expect(result.steps.total).toBe(8000)

    // Sleep sessions
    expect(result.sleep_sessions).toHaveLength(1)
    expect(result.sleep_sessions[0].duration).toBe(480) // 8 hours in minutes

    // Exercise sessions
    expect(result.exercise_sessions).toHaveLength(1)
    expect(result.exercise_sessions[0].title).toBe('Running')
    expect(result.exercise_sessions[0].duration).toBe(30)

    // Tags
    expect(result.tags).toHaveLength(1)
    expect(result.tags[0].tag).toBe('coffee')

    // Productivity
    expect(result.productivity).toEqual({
      distracting_sec: 600,
      productive_sec: 3600,
      total_duration_sec: 4200,
      very_productive_sec: 3600,
    })

    // Places
    expect(result.places).toHaveLength(1)
    expect(result.places[0].name).toBe('Home')
    expect(result.places[0].source).toBe('named')
  })

  test('returns null for heartRate when no data', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getActivities).mockResolvedValue([])
    vi.mocked(db.getTags).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    expect(result.heart_rate).toBeNull()
    expect(result.productivity).toBeNull()
  })

  test('prefers aggregate steps over summing raw records', async () => {
    // Raw records sum to 8000, but aggregate says 5000 (deduplicated)
    vi.mocked(db.getTimeSeries)
      .mockResolvedValueOnce([]) // heart_rate
      .mockResolvedValueOnce([
        [new Date('2024-01-15T08:00:00Z'), 5000],
        [new Date('2024-01-15T12:00:00Z'), 3000], // Total raw: 8000
      ])

    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getActivities).mockResolvedValue([])
    vi.mocked(db.getTags).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    // Aggregate returns 5000 (deduplicated value)
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(5000)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    // Should use aggregate value, not sum of raw records
    expect(result.steps.total).toBe(5000)
  })

  test('falls back to summing raw steps when no aggregate exists', async () => {
    vi.mocked(db.getTimeSeries)
      .mockResolvedValueOnce([]) // heart_rate
      .mockResolvedValueOnce([
        [new Date('2024-01-15T08:00:00Z'), 5000],
        [new Date('2024-01-15T12:00:00Z'), 3000],
      ])

    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getActivities).mockResolvedValue([])
    vi.mocked(db.getTags).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    // No aggregate available
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    // Should fall back to summing raw records
    expect(result.steps.total).toBe(8000)
  })

  test('includes Oura scores when data is present', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getActivities).mockResolvedValue([])
    vi.mocked(db.getTags).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)

    // Mock Oura scores data
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({
      cardiovascular_age: [[new Date('2024-01-15T00:00:00Z'), 35]],
      readiness_score: [[new Date('2024-01-15T00:00:00Z'), 85]],
      resilience_score: [[new Date('2024-01-15T00:00:00Z'), 75]],
      sleep_score: [[new Date('2024-01-15T00:00:00Z'), 92]],
    } as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    expect(result.oura_scores).toEqual({
      cardiovascular_age: 35,
      readiness_score: 85,
      resilience_score: 75,
      sleep_score: 92,
    })
  })

  test('returns null ouraScores when no Oura data', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getActivities).mockResolvedValue([])
    vi.mocked(db.getTags).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    expect(result.oura_scores).toBeNull()
  })

  test('returns partial ouraScores when some metrics are missing', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getActivities).mockResolvedValue([])
    vi.mocked(db.getTags).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)

    // Only some Oura metrics available
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({
      readiness_score: [[new Date('2024-01-15T00:00:00Z'), 85]],
      sleep_score: [[new Date('2024-01-15T00:00:00Z'), 92]],
    } as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    expect(result.oura_scores).toEqual({
      cardiovascular_age: null,
      readiness_score: 85,
      resilience_score: null,
      sleep_score: 92,
    })
  })

  test('computes hr_zone_secs for exercise sessions with HR data', async () => {
    // First call: daily heart rate, second call: daily steps, third call: exercise session HR
    vi.mocked(db.getTimeSeries)
      .mockResolvedValueOnce([]) // daily heart_rate
      .mockResolvedValueOnce([]) // daily steps
      .mockResolvedValueOnce([
        // exercise session HR data - in zone 1 (90-107 with default zones)
        [new Date('2024-01-15T10:00:00Z'), 95],
        [new Date('2024-01-15T10:00:02Z'), 100],
        [new Date('2024-01-15T10:00:04Z'), 98],
      ])

    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getActivities).mockResolvedValue([
      {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T10:30:00Z'),
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Running',
      },
    ])
    vi.mocked(db.getTags).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    expect(result.exercise_sessions).toHaveLength(1)
    expect(result.exercise_sessions[0].hr_zone_secs).toBeDefined()
    // All HR values (95, 100, 98) are in zone 1 (90-107 with default zones)
    expect(result.exercise_sessions[0].hr_zone_secs![1]).toBeGreaterThan(0)
  })

  test('does not include hr_zone_secs when exercise has no HR data', async () => {
    vi.mocked(db.getTimeSeries)
      .mockResolvedValueOnce([]) // daily heart_rate
      .mockResolvedValueOnce([]) // daily steps
      .mockResolvedValueOnce([]) // exercise session HR data - empty

    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getActivities).mockResolvedValue([
      {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T10:30:00Z'),
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Running',
      },
    ])
    vi.mocked(db.getTags).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    expect(result.exercise_sessions).toHaveLength(1)
    expect(result.exercise_sessions[0].hr_zone_secs).toBeUndefined()
  })

  test('uses custom HR zones from user settings', async () => {
    // Custom zones: zone 1 starts at 80 (lower than default 90)
    vi.mocked(db.getUserSettings).mockResolvedValue({
      hr_zone_start: { 1: 80, 2: 100, 3: 120, 4: 140, 5: 160 },
    })

    vi.mocked(db.getTimeSeries)
      .mockResolvedValueOnce([]) // daily heart_rate
      .mockResolvedValueOnce([]) // daily steps
      .mockResolvedValueOnce([
        // HR at 85 - would be zone 0 with defaults (90), but zone 1 with custom (80)
        [new Date('2024-01-15T10:00:00Z'), 85],
        [new Date('2024-01-15T10:00:02Z'), 85],
      ])

    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getActivities).mockResolvedValue([
      {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T10:30:00Z'),
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Walking',
      },
    ])
    vi.mocked(db.getTags).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    expect(result.exercise_sessions[0].hr_zone_secs).toBeDefined()
    // With custom zones (zone 1 starts at 80), HR of 85 is in zone 1
    expect(result.exercise_sessions[0].hr_zone_secs![1]).toBeGreaterThan(0)
    expect(result.exercise_sessions[0].hr_zone_secs![0]).toBe(0)
  })

  test('does not compute hr_zone_secs for exercise without endTime', async () => {
    vi.mocked(db.getTimeSeries)
      .mockResolvedValueOnce([]) // daily heart_rate
      .mockResolvedValueOnce([]) // daily steps

    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getActivities).mockResolvedValue([
      {
        activity_type: 'exercise',
        // No end_time - ongoing session
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Running',
      },
    ])
    vi.mocked(db.getTags).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    expect(result.exercise_sessions).toHaveLength(1)
    expect(result.exercise_sessions[0].hr_zone_secs).toBeUndefined()
    // Should not have called getTimeSeries for the exercise session
    expect(db.getTimeSeries).toHaveBeenCalledTimes(2) // Only daily HR and steps
  })
})

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
})

describe('queryMetricsBucketed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns bucketed data for a single metric', async () => {
    const mockBuckets: db.BucketedMetricData[] = [
      {
        avg: 72,
        bucket_start: new Date('2024-01-15T06:00:00Z'),
        count: 300,
        max: 80,
        metric: 'heart_rate',
        min: 65,
      },
      {
        avg: 78,
        bucket_start: new Date('2024-01-15T06:15:00Z'),
        count: 280,
        max: 85,
        metric: 'heart_rate',
        min: 70,
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
    const mockBuckets: db.BucketedMetricData[] = [
      {
        avg: 72,
        bucket_start: new Date('2024-01-15T06:00:00Z'),
        count: 300,
        max: 80,
        metric: 'heart_rate',
        min: 65,
      },
      {
        avg: 45,
        bucket_start: new Date('2024-01-15T06:00:00Z'),
        count: 100,
        max: 60,
        metric: 'hrv_rmssd',
        min: 30,
      },
      {
        avg: 78,
        bucket_start: new Date('2024-01-15T06:15:00Z'),
        count: 280,
        max: 85,
        metric: 'heart_rate',
        min: 70,
      },
      {
        avg: 42,
        bucket_start: new Date('2024-01-15T06:15:00Z'),
        count: 90,
        max: 55,
        metric: 'hrv_rmssd',
        min: 28,
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
    const mockBuckets: db.BucketedMetricData[] = [
      {
        avg: 72,
        bucket_start: new Date('2024-01-15T06:00:00Z'),
        count: 100,
        max: 80,
        metric: 'heart_rate',
        min: 65,
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
      5,
    )
  })

  test('handles 1h bucket interval', async () => {
    const mockBuckets: db.BucketedMetricData[] = [
      {
        avg: 72,
        bucket_start: new Date('2024-01-15T06:00:00Z'),
        count: 1200,
        max: 80,
        metric: 'heart_rate',
        min: 65,
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
      60,
    )
  })

  test('handles 1d bucket interval', async () => {
    const mockBuckets: db.BucketedMetricData[] = [
      {
        avg: 72,
        bucket_start: new Date('2024-01-15T00:00:00Z'),
        count: 28800,
        max: 120,
        metric: 'heart_rate',
        min: 55,
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
      1440,
    )
  })

  test('handles buckets with partial metric coverage', async () => {
    // Only heart_rate has data in second bucket, not hrv_rmssd
    const mockBuckets: db.BucketedMetricData[] = [
      {
        avg: 72,
        bucket_start: new Date('2024-01-15T06:00:00Z'),
        count: 300,
        max: 80,
        metric: 'heart_rate',
        min: 65,
      },
      {
        avg: 45,
        bucket_start: new Date('2024-01-15T06:00:00Z'),
        count: 100,
        max: 60,
        metric: 'hrv_rmssd',
        min: 30,
      },
      {
        avg: 78,
        bucket_start: new Date('2024-01-15T06:15:00Z'),
        count: 280,
        max: 85,
        metric: 'heart_rate',
        min: 70,
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
})

describe('mergeProductivitySpans', () => {
  test('merges consecutive spans for the same activity', () => {
    const result = mergeProductivitySpans([
      {
        activity: 'emacs',
        category: 'Software Development',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:05:00Z'),
        productivity: 2,
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity: 'emacs',
        category: 'Software Development',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:10:00Z'),
        productivity: 2,
        start_time: new Date('2024-01-15T10:05:00Z'),
      },
      {
        activity: 'emacs',
        category: 'Software Development',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:15:00Z'),
        productivity: 2,
        start_time: new Date('2024-01-15T10:10:00Z'),
      },
    ])

    expect(result).toHaveLength(1)
    expect(result[0].activity).toBe('emacs')
    expect(result[0].start_time).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(result[0].end_time).toEqual(new Date('2024-01-15T10:15:00Z'))
    expect(result[0].duration_sec).toBe(900)
  })

  test('does not merge spans for different activities', () => {
    const result = mergeProductivitySpans([
      {
        activity: 'emacs',
        category: 'Software Development',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:05:00Z'),
        productivity: 2,
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity: 'firefox',
        category: 'Browsers',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:10:00Z'),
        productivity: 0,
        start_time: new Date('2024-01-15T10:05:00Z'),
      },
    ])

    expect(result).toHaveLength(2)
  })

  test('merges spans with a small gap (within 2 min leeway)', () => {
    const result = mergeProductivitySpans([
      {
        activity: 'emacs',
        duration_sec: 299,
        end_time: new Date('2024-01-15T10:04:59Z'),
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity: 'emacs',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:10:00Z'),
        start_time: new Date('2024-01-15T10:05:00Z'),
      },
    ])

    expect(result).toHaveLength(1)
    expect(result[0].start_time).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(result[0].end_time).toEqual(new Date('2024-01-15T10:10:00Z'))
    expect(result[0].duration_sec).toBe(599)
  })

  test('does not merge spans with a large gap between them', () => {
    const result = mergeProductivitySpans([
      {
        activity: 'emacs',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:05:00Z'),
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity: 'emacs',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:15:00Z'),
        start_time: new Date('2024-01-15T10:10:00Z'),
      },
    ])

    expect(result).toHaveLength(2)
  })

  test('merges interleaved activities separately', () => {
    const result = mergeProductivitySpans([
      {
        activity: 'emacs',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:05:00Z'),
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity: 'firefox',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:10:00Z'),
        start_time: new Date('2024-01-15T10:05:00Z'),
      },
      {
        activity: 'emacs',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:15:00Z'),
        start_time: new Date('2024-01-15T10:10:00Z'),
      },
    ])

    // emacs-firefox-emacs should remain 3 separate spans since emacs is not consecutive
    expect(result).toHaveLength(3)
  })

  test('handles empty input', () => {
    expect(mergeProductivitySpans([])).toEqual([])
  })

  test('handles single record', () => {
    const record = {
      activity: 'emacs',
      duration_sec: 300,
      end_time: new Date('2024-01-15T10:05:00Z'),
      start_time: new Date('2024-01-15T10:00:00Z'),
    }
    const result = mergeProductivitySpans([record])
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(record)
  })

  test('does not merge desktop and mobile spans for same activity', () => {
    const result = mergeProductivitySpans([
      {
        activity: 'slack',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:05:00Z'),
        is_mobile: false,
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity: 'slack',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:10:00Z'),
        is_mobile: true,
        start_time: new Date('2024-01-15T10:05:00Z'),
      },
    ])

    expect(result).toHaveLength(2)
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

describe('queryTags with comments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('attaches comments when notes exist', async () => {
    const tagId = 'tag-id-1'
    vi.mocked(db.getTags).mockResolvedValue([
      { id: tagId, source: 'manual', start_time: new Date('2024-01-15T08:00:00Z'), tag: 'coffee' },
    ])

    const notesMap = new Map([
      [
        tagId,
        [
          {
            content: 'Morning coffee',
            created_at: new Date('2024-01-15T08:01:00Z'),
            entity_id: tagId,
            entity_type: 'tag' as const,
            id: 'note-1',
            updated_at: new Date('2024-01-15T08:01:00Z'),
          },
        ],
      ],
    ])
    vi.mocked(db.getNotesByEntityIds).mockResolvedValue(notesMap)

    const result = await queryTags('testuser', new Date('2024-01-15'), new Date('2024-01-16'))

    expect(result).toHaveLength(1)
    expect(result[0].comments).toHaveLength(1)
    expect(result[0].comments[0].content).toBe('Morning coffee')
    expect(result[0].comments[0].id).toBe('note-1')
  })

  test('returns empty comments array when no notes exist', async () => {
    vi.mocked(db.getTags).mockResolvedValue([
      { id: 'tag-1', source: 'manual', start_time: new Date('2024-01-15T08:00:00Z'), tag: 'coffee' },
    ])
    vi.mocked(db.getNotesByEntityIds).mockResolvedValue(new Map())

    const result = await queryTags('testuser', new Date('2024-01-15'), new Date('2024-01-16'))

    expect(result[0].comments).toEqual([])
  })
})

describe('queryActivities with comments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getUserSettings).mockResolvedValue(null)
  })

  test('attaches comments to activities', async () => {
    const activityId = 'activity-id-1'
    vi.mocked(db.getActivities).mockResolvedValue([
      {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T10:30:00Z'),
        id: activityId,
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Running',
      },
    ])

    const notesMap = new Map([
      [
        activityId,
        [
          {
            content: 'Felt great!',
            created_at: new Date('2024-01-15T11:00:00Z'),
            entity_id: activityId,
            entity_type: 'activity' as const,
            id: 'note-1',
            updated_at: new Date('2024-01-15T11:00:00Z'),
          },
        ],
      ],
    ])
    vi.mocked(db.getNotesByEntityIds).mockResolvedValue(notesMap)
    vi.mocked(db.getTimeSeries).mockResolvedValue([])

    const result = await queryActivities(
      'testuser',
      ['exercise'],
      new Date('2024-01-15'),
      new Date('2024-01-16'),
    )

    expect(result).toHaveLength(1)
    expect(result[0].comments).toHaveLength(1)
    expect(result[0].comments[0].content).toBe('Felt great!')
  })

  test('returns empty comments array when no notes exist', async () => {
    vi.mocked(db.getActivities).mockResolvedValue([
      {
        activity_type: 'exercise',
        id: 'activity-1',
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
    ])
    vi.mocked(db.getNotesByEntityIds).mockResolvedValue(new Map())

    const result = await queryActivities(
      'testuser',
      ['exercise'],
      new Date('2024-01-15'),
      new Date('2024-01-16'),
    )

    expect(result[0].comments).toEqual([])
  })
})

describe('queryProductivity with comments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('attaches comments to productivity records', async () => {
    const prodId = 'prod-id-1'
    vi.mocked(db.getProductivity).mockResolvedValue([
      {
        activity: 'VS Code',
        duration_sec: 3600,
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: prodId,
        productivity: 2,
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
    ])

    const notesMap = new Map([
      [
        prodId,
        [
          {
            content: 'Deep focus session',
            created_at: new Date('2024-01-15T11:01:00Z'),
            entity_id: prodId,
            entity_type: 'productivity' as const,
            id: 'note-1',
            updated_at: new Date('2024-01-15T11:01:00Z'),
          },
        ],
      ],
    ])
    vi.mocked(db.getNotesByEntityIds).mockResolvedValue(notesMap)

    const result = await queryProductivity('testuser', new Date('2024-01-15'), new Date('2024-01-16'))

    expect(result).toHaveLength(1)
    expect(result[0].comments).toHaveLength(1)
    expect(result[0].comments[0].content).toBe('Deep focus session')
  })

  test('returns empty comments array when no notes exist', async () => {
    vi.mocked(db.getProductivity).mockResolvedValue([
      {
        activity: 'VS Code',
        duration_sec: 3600,
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: 'prod-1',
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
    ])
    vi.mocked(db.getNotesByEntityIds).mockResolvedValue(new Map())

    const result = await queryProductivity('testuser', new Date('2024-01-15'), new Date('2024-01-16'))

    expect(result[0].comments).toEqual([])
  })
})
