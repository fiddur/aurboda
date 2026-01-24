import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as db from '../db'
import { MetricType } from '../schema'
import * as locationsService from './locations'
import { getDailySummary, getPeriodSummary, queryMetrics } from './queries'

// Mock the db module
vi.mock('../db', () => ({
  getActivities: vi.fn(),
  getDailyAggregateValue: vi.fn(),
  getDailyAggregates: vi.fn(),
  getLocations: vi.fn(),
  getProductivity: vi.fn(),
  getSleepSessions: vi.fn(),
  getTags: vi.fn(),
  getTimeSeries: vi.fn(),
  getTimeSeriesMultiMetric: vi.fn(),
  getTimeSeriesStats: vi.fn(),
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

  test('returns formatted time series data', async () => {
    const mockData: [Date, number][] = [
      [new Date('2024-01-01T10:00:00Z'), 72],
      [new Date('2024-01-01T11:00:00Z'), 75],
      [new Date('2024-01-01T12:00:00Z'), 68],
    ]
    vi.mocked(db.getTimeSeries).mockResolvedValue(mockData)

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
    expect(result.data[0]).toEqual({ time: '2024-01-01T10:00:00.000Z', value: 72 })
  })

  test('returns empty data when no records', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])

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
        activityType: 'sleep',
        endTime: new Date('2024-01-15T07:00:00Z'),
        source: 'oura',
        startTime: new Date('2024-01-14T23:00:00Z'),
      },
    ])

    // Exercise sessions still use getActivities
    vi.mocked(db.getActivities).mockResolvedValue([
      {
        activityType: 'exercise',
        endTime: new Date('2024-01-15T10:30:00Z'),
        source: 'health_connect',
        startTime: new Date('2024-01-15T10:00:00Z'),
        title: 'Running',
      },
    ])

    vi.mocked(db.getTags).mockResolvedValue([
      { source: 'manual', startTime: new Date('2024-01-15T08:00:00Z'), tag: 'coffee' },
    ])

    vi.mocked(db.getProductivity).mockResolvedValue([
      {
        activity: 'VS Code',
        durationSec: 3600,
        endTime: new Date('2024-01-15T11:00:00Z'),
        productivity: 2,
        startTime: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity: 'Twitter',
        durationSec: 600,
        endTime: new Date('2024-01-15T11:20:00Z'),
        productivity: -2,
        startTime: new Date('2024-01-15T11:10:00Z'),
      },
    ])

    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([
      {
        durationMinutes: 1080,
        endTime: new Date('2024-01-15T18:00:00Z'),
        lat: 59.33,
        lon: 18.07,
        name: 'Home',
        source: 'named',
        startTime: new Date('2024-01-15T00:00:00Z'),
      },
    ])

    // No aggregate available, should fall back to summing raw records
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    expect(result.date).toBe('2024-01-15')

    // Heart rate stats
    expect(result.heartRate).toEqual({
      avg: 72,
      count: 3,
      max: 80,
      min: 65,
    })

    // Steps
    expect(result.steps.total).toBe(8000)

    // Sleep sessions
    expect(result.sleepSessions).toHaveLength(1)
    expect(result.sleepSessions[0].duration).toBe(480) // 8 hours in minutes

    // Exercise sessions
    expect(result.exerciseSessions).toHaveLength(1)
    expect(result.exerciseSessions[0].title).toBe('Running')
    expect(result.exerciseSessions[0].duration).toBe(30)

    // Tags
    expect(result.tags).toHaveLength(1)
    expect(result.tags[0].tag).toBe('coffee')

    // Productivity
    expect(result.productivity).toEqual({
      distractingSec: 600,
      productiveSec: 3600,
      totalDurationSec: 4200,
      veryProductiveSec: 3600,
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

    expect(result.heartRate).toBeNull()
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

    expect(result.ouraScores).toEqual({
      cardiovascularAge: 35,
      readinessScore: 85,
      resilienceScore: 75,
      sleepScore: 92,
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

    expect(result.ouraScores).toBeNull()
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

    expect(result.ouraScores).toEqual({
      cardiovascularAge: null,
      readinessScore: 85,
      resilienceScore: null,
      sleepScore: 92,
    })
  })

  test('computes hrZoneSecs for exercise sessions with HR data', async () => {
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
        activityType: 'exercise',
        endTime: new Date('2024-01-15T10:30:00Z'),
        source: 'health_connect',
        startTime: new Date('2024-01-15T10:00:00Z'),
        title: 'Running',
      },
    ])
    vi.mocked(db.getTags).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    expect(result.exerciseSessions).toHaveLength(1)
    expect(result.exerciseSessions[0].hrZoneSecs).toBeDefined()
    // All HR values (95, 100, 98) are in zone 1 (90-107 with default zones)
    expect(result.exerciseSessions[0].hrZoneSecs![1]).toBeGreaterThan(0)
  })

  test('does not include hrZoneSecs when exercise has no HR data', async () => {
    vi.mocked(db.getTimeSeries)
      .mockResolvedValueOnce([]) // daily heart_rate
      .mockResolvedValueOnce([]) // daily steps
      .mockResolvedValueOnce([]) // exercise session HR data - empty

    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getActivities).mockResolvedValue([
      {
        activityType: 'exercise',
        endTime: new Date('2024-01-15T10:30:00Z'),
        source: 'health_connect',
        startTime: new Date('2024-01-15T10:00:00Z'),
        title: 'Running',
      },
    ])
    vi.mocked(db.getTags).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    expect(result.exerciseSessions).toHaveLength(1)
    expect(result.exerciseSessions[0].hrZoneSecs).toBeUndefined()
  })

  test('uses custom HR zones from user settings', async () => {
    // Custom zones: zone 1 starts at 80 (lower than default 90)
    vi.mocked(db.getUserSettings).mockResolvedValue({
      hrZoneStart: { 1: 80, 2: 100, 3: 120, 4: 140, 5: 160 },
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
        activityType: 'exercise',
        endTime: new Date('2024-01-15T10:30:00Z'),
        source: 'health_connect',
        startTime: new Date('2024-01-15T10:00:00Z'),
        title: 'Walking',
      },
    ])
    vi.mocked(db.getTags).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    expect(result.exerciseSessions[0].hrZoneSecs).toBeDefined()
    // With custom zones (zone 1 starts at 80), HR of 85 is in zone 1
    expect(result.exerciseSessions[0].hrZoneSecs![1]).toBeGreaterThan(0)
    expect(result.exerciseSessions[0].hrZoneSecs![0]).toBe(0)
  })

  test('does not compute hrZoneSecs for exercise without endTime', async () => {
    vi.mocked(db.getTimeSeries)
      .mockResolvedValueOnce([]) // daily heart_rate
      .mockResolvedValueOnce([]) // daily steps

    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getActivities).mockResolvedValue([
      {
        activityType: 'exercise',
        // No endTime - ongoing session
        source: 'health_connect',
        startTime: new Date('2024-01-15T10:00:00Z'),
        title: 'Running',
      },
    ])
    vi.mocked(db.getTags).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    expect(result.exerciseSessions).toHaveLength(1)
    expect(result.exerciseSessions[0].hrZoneSecs).toBeUndefined()
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
      { avg: 40, date: '2024-01-01', metric: 'hrv_rmssd' },
      { avg: 45, date: '2024-01-02', metric: 'hrv_rmssd' },
      { avg: 50, date: '2024-01-03', metric: 'hrv_rmssd' },
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
      { avg: 40, date: '2024-01-01', metric: 'hrv_rmssd' },
      { avg: 45, date: '2024-01-02', metric: 'hrv_rmssd' },
      { avg: 50, date: '2024-01-03', metric: 'hrv_rmssd' },
    ])

    const result = await getPeriodSummary(
      'testuser',
      ['hrv_rmssd'],
      new Date('2024-01-01'),
      new Date('2024-01-03'),
    )

    expect(result.metrics[0].trendPerDay).toBe(5)
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

    expect(result.metrics[0].changeFromPreviousPeriodPercent).toBe(25)
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
    expect(result.metrics[0].completenessPercent).toBe(0)
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
      })),
    )

    const result = await getPeriodSummary(
      'testuser',
      ['hrv_rmssd'],
      new Date('2024-01-01'),
      new Date('2024-01-31'),
    )

    expect(result.metrics[0].completenessPercent).toBe(50) // 15/30 = 50%
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
      hrZoneStart: { 1: 70, 2: 100, 3: 130, 4: 150, 5: 170 },
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
