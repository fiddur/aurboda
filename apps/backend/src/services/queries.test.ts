import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as db from '../db'
import { MetricType } from '../schema'
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

    vi.mocked(db.getLocations).mockResolvedValue({
      locations: [],
      places: [
        {
          endTime: new Date('2024-01-15T18:00:00Z'),
          region: 'Home',
          startTime: new Date('2024-01-15T00:00:00Z'),
        },
      ],
    })

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
    expect(result.places[0].region).toBe('Home')
  })

  test('returns null for heartRate when no data', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getActivities).mockResolvedValue([])
    vi.mocked(db.getTags).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(db.getLocations).mockResolvedValue({ locations: [], places: [] })
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
    vi.mocked(db.getLocations).mockResolvedValue({ locations: [], places: [] })
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
    vi.mocked(db.getLocations).mockResolvedValue({ locations: [], places: [] })
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
    vi.mocked(db.getLocations).mockResolvedValue({ locations: [], places: [] })
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
    vi.mocked(db.getLocations).mockResolvedValue({ locations: [], places: [] })
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
    vi.mocked(db.getLocations).mockResolvedValue({ locations: [], places: [] })
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
})
