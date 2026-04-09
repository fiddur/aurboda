import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { MetricType } from '../schema.ts'

import * as db from '../db/index.ts'
import * as locationsService from './locations.ts'
import {
  assembleScreentimeBuckets,
  computeSleepStageSummary,
  findSleepLocation,
  getDailySummary,
  getPeriodSummary,
  mergeProductivitySpans,
  mergeByCategorySpans,
  parseBucketSize,
  queryActivities,
  queryMetrics,
  queryMetricsBucketed,
  queryProductivity,
  queryTags,
} from './queries.ts'

// Mock the db module
vi.mock('../db', () => ({
  getActivities: vi.fn(),
  getActivitiesByCategory: vi.fn(),
  getActivitiesExcludingCategories: vi.fn(),
  getDailyAggregateValue: vi.fn(),
  getDailyAggregates: vi.fn(),
  getDistinctMetrics: vi.fn(),
  getLocations: vi.fn(),
  getMeals: vi.fn(),
  getNonSleepActivitiesMerged: vi.fn(),
  getNotesByEntityIds: vi.fn(),
  getNotesForTimeRange: vi.fn(),
  getProductivity: vi.fn(),
  getSleepSessions: vi.fn(),
  getTimeSeries: vi.fn(),
  getTimeSeriesBucketed: vi.fn(),
  getTimeSeriesMultiMetric: vi.fn(),
  getTimeSeriesStats: vi.fn(),
  getTimeSeriesWithSource: vi.fn(),
  getUserSettings: vi.fn(),
}))

// Mock the screentime-categories module
import * as screentimeCategoriesDb from '../db/screentime-categories.ts'
vi.mock('../db/screentime-categories', () => ({
  getScreentimeCategories: vi.fn().mockResolvedValue([]),
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
    // Default: no notes overlapping the day
    vi.mocked(db.getNotesForTimeRange).mockResolvedValue([])
    // Default: no notes for activities
    vi.mocked(db.getNotesByEntityIds).mockResolvedValue(new Map())
    // Default: no meals
    vi.mocked(db.getMeals).mockResolvedValue([])
    // Default: no non-sleep activities
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
  })

  test('aggregates all data sources for a day', async () => {
    vi.mocked(db.getTimeSeries)
      .mockResolvedValueOnce([
        // Daily heart rate data (exercise session HR is filtered from this in memory)
        [new Date('2024-01-15T10:00:00Z'), 72],
        [new Date('2024-01-15T10:15:00Z'), 80],
        [new Date('2024-01-15T10:30:00Z'), 75],
        [new Date('2024-01-15T11:00:00Z'), 80],
        [new Date('2024-01-15T12:00:00Z'), 65],
      ])
      .mockResolvedValueOnce([
        // Daily steps data
        [new Date('2024-01-15T08:00:00Z'), 5000],
        [new Date('2024-01-15T12:00:00Z'), 3000],
      ])
      .mockResolvedValueOnce([]) // stress_level

    // Sleep sessions now use getSleepSessions with date overlap logic
    vi.mocked(db.getSleepSessions).mockResolvedValue([
      {
        activity_type: 'sleep',
        end_time: new Date('2024-01-15T07:00:00Z'),
        source: 'oura',
        start_time: new Date('2024-01-14T23:00:00Z'),
      },
    ])

    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([
      {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T10:30:00Z'),
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Running',
      },
      {
        activity_type: 'coffee',
        source: 'aurboda',
        start_time: new Date('2024-01-15T08:00:00Z'),
      },
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
      avg: 74, // (72+80+75+80+65)/5 = 74.4, rounded to 74
      count: 5,
      max: 80,
      min: 65,
    })

    // Steps
    expect(result.steps.total).toBe(8000)

    // Sleep sessions
    expect(result.sleep_sessions).toHaveLength(1)
    expect(result.sleep_sessions[0].duration).toBe(480) // 8 hours in minutes
    expect(result.sleep_sessions[0].sleep_date).toBe('2024-01-15') // woke up on this date
    expect(result.sleep_sessions[0].sleep_location).toEqual({
      lat: 59.33,
      lon: 18.07,
      name: 'Home',
      source: 'named',
    })

    // Activities (unified array)
    const exerciseActivities = result.activities.filter((a) => a.activity_type === 'exercise')
    expect(exerciseActivities).toHaveLength(1)
    expect(exerciseActivities[0].title).toBe('Running')

    const tagActivities = result.activities.filter(
      (a) => a.activity_type !== 'exercise' && a.activity_type !== 'screentime',
    )
    expect(tagActivities).toHaveLength(1)
    expect(tagActivities[0].activity_type).toBe('coffee')

    // Productivity
    expect(result.productivity).toEqual({
      categories: [{ duration_sec: 4200, path: [] }],
      distracting_sec: 600,
      productive_sec: 3600,
      total_duration_sec: 4200,
      very_productive_sec: 3600,
    })

    // Places
    expect(result.places).toHaveLength(1)
    expect(result.places[0].name).toBe('Home')
    expect(result.places[0].source).toBe('named')

    // Stress zones (no stress data)
    expect(result.stress_zones).toBeNull()
  })

  test('returns null for heartRate when no data', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
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
      .mockResolvedValueOnce([]) // stress_level

    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
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
      .mockResolvedValueOnce([]) // stress_level

    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
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
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
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
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
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
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
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

  test('computes hr_zone_secs for exercise activities with HR data', async () => {
    // First call: daily heart rate (includes exercise session data), second call: daily steps, third: stress
    vi.mocked(db.getTimeSeries)
      .mockResolvedValueOnce([
        // exercise session HR data - in zone 1 (90-107 with default zones)
        [new Date('2024-01-15T10:00:00Z'), 95],
        [new Date('2024-01-15T10:00:02Z'), 100],
        [new Date('2024-01-15T10:00:04Z'), 98],
      ]) // daily heart_rate (filtered in memory for exercise sessions)
      .mockResolvedValueOnce([]) // daily steps
      .mockResolvedValueOnce([]) // stress_level

    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([
      {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T10:30:00Z'),
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Running',
      },
    ])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    const exerciseActivities = result.activities.filter((a) => a.activity_type === 'exercise')
    expect(exerciseActivities).toHaveLength(1)
    expect(exerciseActivities[0].hr_zone_secs).toBeDefined()
    // All HR values (95, 100, 98) are in zone 1 (90-107 with default zones)
    expect(exerciseActivities[0].hr_zone_secs![1]).toBeGreaterThan(0)
  })

  test('does not include hr_zone_secs when exercise has no HR data', async () => {
    vi.mocked(db.getTimeSeries)
      .mockResolvedValueOnce([]) // daily heart_rate (no HR data during exercise)
      .mockResolvedValueOnce([]) // daily steps
      .mockResolvedValueOnce([]) // stress_level

    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([
      {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T10:30:00Z'),
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Running',
      },
    ])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    const exerciseActivities = result.activities.filter((a) => a.activity_type === 'exercise')
    expect(exerciseActivities).toHaveLength(1)
    expect(exerciseActivities[0].hr_zone_secs).toBeUndefined()
  })

  test('uses custom HR zones from user settings', async () => {
    // Custom zones: zone 1 starts at 80 (lower than default 90)
    vi.mocked(db.getUserSettings).mockResolvedValue({
      hr_zone_start: { 1: 80, 2: 100, 3: 120, 4: 140, 5: 160 },
    })

    vi.mocked(db.getTimeSeries)
      .mockResolvedValueOnce([
        // HR at 85 - would be zone 0 with defaults (90), but zone 1 with custom (80)
        [new Date('2024-01-15T10:00:00Z'), 85],
        [new Date('2024-01-15T10:00:02Z'), 85],
      ]) // daily heart_rate (filtered in memory for exercise sessions)
      .mockResolvedValueOnce([]) // daily steps
      .mockResolvedValueOnce([]) // stress_level

    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([
      {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T10:30:00Z'),
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Walking',
      },
    ])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    const exerciseActivities = result.activities.filter((a) => a.activity_type === 'exercise')
    expect(exerciseActivities[0].hr_zone_secs).toBeDefined()
    // With custom zones (zone 1 starts at 80), HR of 85 is in zone 1
    expect(exerciseActivities[0].hr_zone_secs![1]).toBeGreaterThan(0)
    expect(exerciseActivities[0].hr_zone_secs![0]).toBe(0)
  })

  test('does not compute hr_zone_secs for exercise without endTime', async () => {
    vi.mocked(db.getTimeSeries)
      .mockResolvedValueOnce([]) // daily heart_rate
      .mockResolvedValueOnce([]) // daily steps
      .mockResolvedValueOnce([]) // stress_level

    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([
      {
        activity_type: 'exercise',
        // No end_time - ongoing session
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Running',
      },
    ])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    const exerciseActivities = result.activities.filter((a) => a.activity_type === 'exercise')
    expect(exerciseActivities).toHaveLength(1)
    expect(exerciseActivities[0].hr_zone_secs).toBeUndefined()
    // Should not have called getTimeSeries for the exercise session
    expect(db.getTimeSeries).toHaveBeenCalledTimes(3) // Daily HR, steps, and stress
  })

  test('overnight sleep appears in sleep_sessions on wake-up date', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([
      {
        activity_type: 'sleep',
        end_time: new Date('2024-03-08T06:23:00Z'),
        source: 'oura',
        start_time: new Date('2024-03-07T22:01:00Z'),
      },
    ])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    // Query for March 8 — the date the user woke up
    const result = await getDailySummary('testuser', new Date('2024-03-08'))

    expect(result.sleep_sessions).toHaveLength(1)
    expect(result.sleep_sessions[0].start_time).toBe('2024-03-07T22:01:00.000Z')
    expect(result.sleep_sessions[0].end_time).toBe('2024-03-08T06:23:00.000Z')
    expect(result.sleep_sessions[0].sleep_date).toBe('2024-03-08')
  })

  test('multiple sleep sessions appear in sleep_sessions', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([
      // Morning sleep — woke up on Mar 8
      {
        activity_type: 'sleep',
        end_time: new Date('2024-03-08T06:23:00Z'),
        source: 'oura',
        start_time: new Date('2024-03-07T22:01:00Z'),
      },
      // Evening sleep — fell asleep on Mar 8, wakes up Mar 9
      {
        activity_type: 'sleep',
        end_time: new Date('2024-03-09T07:00:00Z'),
        source: 'oura',
        start_time: new Date('2024-03-08T22:30:00Z'),
      },
    ])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-03-08'))

    // Both should appear in sleep_sessions
    expect(result.sleep_sessions).toHaveLength(2)
    expect(result.sleep_sessions[0].sleep_date).toBe('2024-03-08')
    expect(result.sleep_sessions[1].sleep_date).toBe('2024-03-09')
  })

  test('returns empty sleep_sessions when no sleep data', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-03-08'))

    expect(result.sleep_sessions).toHaveLength(0)
  })

  test('adds sleep_location from overlapping place visits', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([
      {
        activity_type: 'sleep',
        end_time: new Date('2024-03-08T07:00:00Z'),
        source: 'oura',
        start_time: new Date('2024-03-07T23:00:00Z'),
      },
    ])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([
      {
        duration_minutes: 300,
        end_time: new Date('2024-03-08T08:00:00Z'),
        lat: 57.7,
        lon: 11.97,
        name: 'Hökås',
        source: 'named',
        start_time: new Date('2024-03-07T22:00:00Z'),
      },
    ])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-03-08'))

    expect(result.sleep_sessions).toHaveLength(1)
    expect(result.sleep_sessions[0].sleep_location).toEqual({
      lat: 57.7,
      lon: 11.97,
      name: 'Hökås',
      source: 'named',
    })
  })

  test('sleep_location picks the place with longest overlap', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([
      {
        activity_type: 'sleep',
        end_time: new Date('2024-03-08T07:00:00Z'),
        source: 'oura',
        start_time: new Date('2024-03-07T23:00:00Z'),
      },
    ])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([
      // Short visit at Office before sleep
      {
        duration_minutes: 30,
        end_time: new Date('2024-03-07T23:30:00Z'),
        lat: 59.33,
        lon: 18.07,
        name: 'Office',
        source: 'named',
        start_time: new Date('2024-03-07T22:00:00Z'),
      },
      // Long stay at Home covering most of sleep
      {
        duration_minutes: 600,
        end_time: new Date('2024-03-08T08:00:00Z'),
        lat: 57.7,
        lon: 11.97,
        name: 'Home',
        source: 'named',
        start_time: new Date('2024-03-07T23:30:00Z'),
      },
    ])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-03-08'))

    // Should pick Home (7.5h overlap) over Office (30min overlap)
    expect(result.sleep_sessions[0].sleep_location!.name).toBe('Home')
  })

  test('sleep_location is undefined when no place visits overlap', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([
      {
        activity_type: 'sleep',
        end_time: new Date('2024-03-08T07:00:00Z'),
        source: 'oura',
        start_time: new Date('2024-03-07T23:00:00Z'),
      },
    ])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-03-08'))

    expect(result.sleep_sessions[0].sleep_location).toBeUndefined()
  })

  test('includes exercise_type name from numeric Health Connect code', async () => {
    vi.mocked(db.getTimeSeries)
      .mockResolvedValueOnce([]) // heart rate
      .mockResolvedValueOnce([]) // steps
      .mockResolvedValueOnce([]) // stress_level

    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([
      {
        activity_type: 'exercise',
        data: { exerciseType: 83 }, // yoga
        end_time: new Date('2024-01-15T07:00:00Z'),
        source: 'health_connect',
        start_time: new Date('2024-01-15T06:30:00Z'),
      },
      {
        activity_type: 'exercise',
        data: { exerciseType: 56 }, // running
        end_time: new Date('2024-01-15T12:00:00Z'),
        source: 'health_connect',
        start_time: new Date('2024-01-15T11:30:00Z'),
      },
    ])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    const exerciseActivities = result.activities.filter((a) => a.activity_type === 'exercise')
    expect(exerciseActivities).toHaveLength(2)
    expect(exerciseActivities[0].exercise_type).toBe('yoga')
    expect(exerciseActivities[1].exercise_type).toBe('running')
  })

  test('includes meals with food item names', async () => {
    vi.mocked(db.getTimeSeries)
      .mockResolvedValueOnce([]) // heart rate
      .mockResolvedValueOnce([]) // steps
      .mockResolvedValueOnce([]) // stress_level

    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)
    vi.mocked(db.getMeals).mockResolvedValue([
      {
        id: 'meal-1',
        calories: 450,
        carbs: 30,
        created_at: new Date('2024-01-15T08:00:00Z'),
        fat: 20,
        fiber: 5,
        food_items: [
          { name: 'Oatmeal', calories: 300 },
          { name: 'Banana', calories: 100 },
          { name: 'Honey', calories: 50 },
        ],
        meal_type: 'breakfast',
        name: 'Morning oatmeal',
        protein: 15,
        source: 'manual',
        time: new Date('2024-01-15T08:00:00Z'),
      },
    ])

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    expect(result.meals).toHaveLength(1)
    expect(result.meals[0]).toEqual({
      calories: 450,
      carbs: 30,
      fat: 20,
      fiber: 5,
      food_items: ['Oatmeal', 'Banana', 'Honey'],
      meal_type: 'breakfast',
      name: 'Morning oatmeal',
      protein: 15,
      time: '2024-01-15T08:00:00.000Z',
    })
  })

  test('returns empty meals array when no meals logged', async () => {
    vi.mocked(db.getTimeSeries)
      .mockResolvedValueOnce([]) // heart rate
      .mockResolvedValueOnce([]) // steps
      .mockResolvedValueOnce([]) // stress_level

    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    expect(result.meals).toEqual([])
  })

  test('includes sleep_stages summary from stage data', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([
      {
        activity_type: 'sleep',
        data: {
          stages: [
            { stage: 1, startTime: '2024-01-14T23:00:00Z', endTime: '2024-01-14T23:10:00Z' }, // 10 min awake
            { stage: 4, startTime: '2024-01-14T23:10:00Z', endTime: '2024-01-15T01:10:00Z' }, // 120 min light
            { stage: 5, startTime: '2024-01-15T01:10:00Z', endTime: '2024-01-15T02:40:00Z' }, // 90 min deep
            { stage: 6, startTime: '2024-01-15T02:40:00Z', endTime: '2024-01-15T04:10:00Z' }, // 90 min REM
            { stage: 1, startTime: '2024-01-15T04:10:00Z', endTime: '2024-01-15T04:20:00Z' }, // 10 min awake
            { stage: 4, startTime: '2024-01-15T04:20:00Z', endTime: '2024-01-15T07:00:00Z' }, // 160 min light
          ],
        },
        end_time: new Date('2024-01-15T07:00:00Z'),
        source: 'oura',
        start_time: new Date('2024-01-14T23:00:00Z'),
      },
    ])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    expect(result.sleep_sessions).toHaveLength(1)
    expect(result.sleep_sessions[0].sleep_stages).toEqual({
      awake_min: 20,
      deep_min: 90,
      light_min: 280,
      rem_min: 90,
    })
  })

  test('omits data blob from activities and sleep sessions', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([
      {
        activity_type: 'sleep',
        data: { stages: [], metadata: { device: 'oura' } },
        end_time: new Date('2024-01-15T07:00:00Z'),
        source: 'oura',
        start_time: new Date('2024-01-14T23:00:00Z'),
      },
    ])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([
      {
        activity_type: 'exercise',
        data: { exerciseType: 83, metadata: { device: 'oura' } },
        end_time: new Date('2024-01-15T07:30:00Z'),
        source: 'health_connect',
        start_time: new Date('2024-01-15T07:00:00Z'),
      },
    ])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    // Exercise activities should not have raw data blob
    const exerciseActivities = result.activities.filter((a) => a.activity_type === 'exercise')
    expect(exerciseActivities[0]).not.toHaveProperty('data')
    // Sleep sessions should not have raw data blob
    expect(result.sleep_sessions[0]).not.toHaveProperty('data')
  })

  test('includes category breakdown in productivity summary', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([
      {
        activity: 'VS Code',
        duration_sec: 3600,
        end_time: new Date('2024-01-15T11:00:00Z'),
        productivity: 2,
        resolved_category: ['Work', 'Programming'],
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity: 'Slack',
        duration_sec: 1800,
        end_time: new Date('2024-01-15T12:30:00Z'),
        productivity: 1,
        resolved_category: ['Work', 'Communication'],
        start_time: new Date('2024-01-15T12:00:00Z'),
      },
      {
        activity: 'YouTube',
        duration_sec: 600,
        end_time: new Date('2024-01-15T13:10:00Z'),
        productivity: -1,
        resolved_category: ['Entertainment'],
        start_time: new Date('2024-01-15T13:00:00Z'),
      },
      {
        activity: 'Unknown App',
        duration_sec: 300,
        end_time: new Date('2024-01-15T14:05:00Z'),
        productivity: 0,
        start_time: new Date('2024-01-15T14:00:00Z'),
      },
    ])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    expect(result.productivity!.categories).toEqual([
      { duration_sec: 3600, path: ['Work', 'Programming'] },
      { duration_sec: 1800, path: ['Work', 'Communication'] },
      { duration_sec: 600, path: ['Entertainment'] },
      { duration_sec: 300, path: [] },
    ])
  })

  test('excludes categories marked with exclude_from_screentime', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([
      {
        activity: 'VS Code',
        duration_sec: 3600,
        end_time: new Date('2024-01-15T11:00:00Z'),
        productivity: 2,
        resolved_category: ['Work', 'Programming'],
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity: 'System Idle',
        duration_sec: 1200,
        end_time: new Date('2024-01-15T12:20:00Z'),
        productivity: 0,
        resolved_category: ['System'],
        start_time: new Date('2024-01-15T12:00:00Z'),
      },
      {
        activity: 'System Update',
        duration_sec: 300,
        end_time: new Date('2024-01-15T13:05:00Z'),
        productivity: 0,
        resolved_category: ['System', 'Updates'],
        start_time: new Date('2024-01-15T13:00:00Z'),
      },
    ])
    vi.mocked(screentimeCategoriesDb.getScreentimeCategories).mockResolvedValue([
      {
        created_at: new Date(),
        exclude_from_screentime: true,
        id: 'cat-1',
        ignore_case: true,
        name: ['System'],
        rule_type: 'regex',
        sort_order: 0,
        updated_at: new Date(),
      },
    ])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    // System and System > Updates should be excluded, totals still include all
    expect(result.productivity!.total_duration_sec).toBe(5100)
    expect(result.productivity!.categories).toEqual([{ duration_sec: 3600, path: ['Work', 'Programming'] }])
  })

  test('adds screen time categories as screentime activities', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([
      {
        activity: 'VS Code',
        duration_sec: 3600,
        end_time: new Date('2024-01-15T11:00:00Z'),
        productivity: 2,
        resolved_category: ['Work', 'Programming'],
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity: 'YouTube',
        duration_sec: 600,
        end_time: new Date('2024-01-15T13:10:00Z'),
        productivity: -1,
        resolved_category: ['Entertainment'],
        start_time: new Date('2024-01-15T13:00:00Z'),
      },
    ])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    const screentimeActivities = result.activities.filter((a) => a.activity_type === 'screentime')
    expect(screentimeActivities.length).toBeGreaterThan(0)
    // Each screentime activity should have category_path and title
    for (const act of screentimeActivities) {
      expect(act.category_path).toBeDefined()
      expect(act.title).toBeDefined()
      expect(act.end_time).toBeDefined()
    }
  })

  test('computes stress_zone_secs on activities with time range', async () => {
    vi.mocked(db.getTimeSeries)
      .mockResolvedValueOnce([]) // heart_rate
      .mockResolvedValueOnce([]) // steps
      .mockResolvedValueOnce([
        // stress_level data during the exercise
        [new Date('2024-01-15T10:00:00Z'), 30], // low
        [new Date('2024-01-15T10:03:00Z'), 60], // medium
        [new Date('2024-01-15T10:06:00Z'), 80], // high
      ])

    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([
      {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T10:30:00Z'),
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Running',
      },
    ])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    const exerciseActivities = result.activities.filter((a) => a.activity_type === 'exercise')
    expect(exerciseActivities).toHaveLength(1)
    expect(exerciseActivities[0].stress_zone_secs).toBeDefined()
    // Should have some time in low, medium, and high zones
    expect(exerciseActivities[0].stress_zone_secs!.low).toBeGreaterThan(0)
    expect(exerciseActivities[0].stress_zone_secs!.medium).toBeGreaterThan(0)
    expect(exerciseActivities[0].stress_zone_secs!.high).toBeGreaterThan(0)
  })

  test('computes day-level stress_zones when stress data exists', async () => {
    vi.mocked(db.getTimeSeries)
      .mockResolvedValueOnce([]) // heart_rate
      .mockResolvedValueOnce([]) // steps
      .mockResolvedValueOnce([
        // stress_level data throughout the day
        [new Date('2024-01-15T08:00:00Z'), 10], // rest
        [new Date('2024-01-15T08:03:00Z'), 20], // rest
        [new Date('2024-01-15T10:00:00Z'), 40], // low
        [new Date('2024-01-15T14:00:00Z'), 65], // medium
      ])

    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    expect(result.stress_zones).not.toBeNull()
    expect(result.stress_zones!.rest).toBeGreaterThan(0)
    expect(result.stress_zones!.low).toBeGreaterThan(0)
    expect(result.stress_zones!.medium).toBeGreaterThan(0)
  })

  test('returns null stress_zones when no stress data', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    expect(result.stress_zones).toBeNull()
  })

  test('filters out notes attached to activities from top-level notes', async () => {
    const activityId = 'activity-123'
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([
      {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T10:30:00Z'),
        id: activityId,
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Running',
      },
    ])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    // Notes: one attached to an activity, one orphaned
    vi.mocked(db.getNotesForTimeRange).mockResolvedValue([
      {
        content: 'Attached to exercise',
        created_at: new Date('2024-01-15T11:00:00Z'),
        entity_id: activityId,
        entity_type: 'activity',
        id: 'note-attached',
        updated_at: new Date('2024-01-15T11:00:00Z'),
      },
      {
        content: 'General note for the day',
        created_at: new Date('2024-01-15T12:00:00Z'),
        entity_id: 'some-other-id',
        entity_type: 'report',
        id: 'note-orphan',
        updated_at: new Date('2024-01-15T12:00:00Z'),
      },
    ])

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    // Only the orphaned note should appear in top-level notes
    expect(result.notes).toHaveLength(1)
    expect(result.notes[0].id).toBe('note-orphan')
    expect(result.notes[0].content).toBe('General note for the day')
  })

  test('activities are sorted chronologically', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([
      {
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T10:30:00Z'),
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Running',
      },
      {
        activity_type: 'coffee',
        source: 'aurboda',
        start_time: new Date('2024-01-15T08:00:00Z'),
      },
      {
        activity_type: 'meeting',
        end_time: new Date('2024-01-15T15:00:00Z'),
        source: 'aurboda',
        start_time: new Date('2024-01-15T14:00:00Z'),
        title: 'Standup',
      },
    ])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    // Activities should be sorted by start_time
    const startTimes = result.activities.map((a) => a.start_time)
    for (let i = 1; i < startTimes.length; i++) {
      expect(startTimes[i] >= startTimes[i - 1]).toBe(true)
    }
  })
})

describe('computeSleepStageSummary', () => {
  test('returns undefined for missing data', () => {
    expect(computeSleepStageSummary(undefined)).toBeUndefined()
  })

  test('returns undefined when no stages array', () => {
    expect(computeSleepStageSummary({ total_sleep_duration: 28800 })).toBeUndefined()
  })

  test('computes minutes per stage from Health Connect stages', () => {
    const result = computeSleepStageSummary({
      stages: [
        { stage: 1, startTime: '2024-01-15T00:00:00Z', endTime: '2024-01-15T00:15:00Z' }, // 15 min awake
        { stage: 4, startTime: '2024-01-15T00:15:00Z', endTime: '2024-01-15T02:15:00Z' }, // 120 min light
        { stage: 5, startTime: '2024-01-15T02:15:00Z', endTime: '2024-01-15T03:45:00Z' }, // 90 min deep
        { stage: 6, startTime: '2024-01-15T03:45:00Z', endTime: '2024-01-15T05:15:00Z' }, // 90 min REM
      ],
    })
    expect(result).toEqual({ awake_min: 15, deep_min: 90, light_min: 120, rem_min: 90 })
  })

  test('omits zero-duration stages', () => {
    const result = computeSleepStageSummary({
      stages: [
        { stage: 4, startTime: '2024-01-15T00:00:00Z', endTime: '2024-01-15T06:00:00Z' }, // 360 min light
      ],
    })
    expect(result).toEqual({ awake_min: undefined, deep_min: undefined, light_min: 360, rem_min: undefined })
  })
})

describe('findSleepLocation', () => {
  test('returns undefined when no place visits', () => {
    const result = findSleepLocation(new Date('2024-03-07T23:00:00Z'), new Date('2024-03-08T07:00:00Z'), [])
    expect(result).toBeUndefined()
  })

  test('returns the place with longest overlap', () => {
    const result = findSleepLocation(new Date('2024-03-07T23:00:00Z'), new Date('2024-03-08T07:00:00Z'), [
      {
        duration_minutes: 30,
        end_time: new Date('2024-03-07T23:30:00Z'),
        lat: 59.33,
        lon: 18.07,
        name: 'Office',
        source: 'named' as const,
        start_time: new Date('2024-03-07T22:00:00Z'),
      },
      {
        duration_minutes: 600,
        end_time: new Date('2024-03-08T08:00:00Z'),
        lat: 57.7,
        lon: 11.97,
        name: 'Home',
        source: 'named' as const,
        start_time: new Date('2024-03-07T23:30:00Z'),
      },
    ])
    expect(result).toEqual({
      lat: 57.7,
      lon: 11.97,
      name: 'Home',
      source: 'named',
    })
  })

  test('ignores places with no overlap', () => {
    const result = findSleepLocation(new Date('2024-03-07T23:00:00Z'), new Date('2024-03-08T07:00:00Z'), [
      {
        duration_minutes: 120,
        end_time: new Date('2024-03-07T20:00:00Z'),
        lat: 59.33,
        lon: 18.07,
        name: 'Office',
        source: 'named' as const,
        start_time: new Date('2024-03-07T18:00:00Z'),
      },
    ])
    expect(result).toBeUndefined()
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
    const mockBuckets: db.BucketedMetricData[] = [
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
    const mockBuckets: db.BucketedMetricData[] = [
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
    const mockBuckets: db.BucketedMetricData[] = [
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
    const mockBuckets: db.BucketedMetricData[] = [
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
    const mockBuckets: db.BucketedMetricData[] = [
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

describe('mergeProductivitySpans', () => {
  test('merges consecutive spans for the same activity', () => {
    const result = mergeProductivitySpans([
      {
        activity: 'emacs',
        category: 'Software Development',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:05:00Z'),
        id: 'id-1',
        productivity: 2,
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity: 'emacs',
        category: 'Software Development',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:10:00Z'),
        id: 'id-2',
        productivity: 2,
        start_time: new Date('2024-01-15T10:05:00Z'),
      },
      {
        activity: 'emacs',
        category: 'Software Development',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:15:00Z'),
        id: 'id-3',
        productivity: 2,
        start_time: new Date('2024-01-15T10:10:00Z'),
      },
    ])

    expect(result).toHaveLength(1)
    expect(result[0]!.activity).toBe('emacs')
    expect(result[0]!.start_time).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(result[0]!.end_time).toEqual(new Date('2024-01-15T10:15:00Z'))
    expect(result[0]!.duration_sec).toBe(900)
    expect(result[0]!.source_ids).toEqual(['id-1', 'id-2', 'id-3'])
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

  test('merges interleaved same-activity spans within gap threshold', () => {
    // emacs → firefox (30s) → emacs: the two emacs spans are within 2 min of each other
    const result = mergeProductivitySpans([
      {
        activity: 'emacs',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:05:00Z'),
        id: 'id-emacs-1',
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity: 'firefox',
        duration_sec: 30,
        end_time: new Date('2024-01-15T10:05:30Z'),
        id: 'id-firefox-1',
        start_time: new Date('2024-01-15T10:05:00Z'),
      },
      {
        activity: 'emacs',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:10:30Z'),
        id: 'id-emacs-2',
        start_time: new Date('2024-01-15T10:05:30Z'),
      },
    ])

    // emacs spans merge (gap = 30s < 2min); firefox stays separate
    expect(result).toHaveLength(2)
    const emacs = result.find((r) => r.activity === 'emacs')!
    expect(emacs.start_time).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(emacs.end_time).toEqual(new Date('2024-01-15T10:10:30Z'))
    expect(emacs.duration_sec).toBe(600) // only actual emacs time, not the firefox gap
    expect(emacs.source_ids).toEqual(['id-emacs-1', 'id-emacs-2'])
  })

  test('does not merge interleaved same-activity spans when gap exceeds threshold', () => {
    // emacs → firefox (5 min) → emacs: gap too large, stays as 2 separate emacs spans
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

    expect(result).toHaveLength(3)
  })

  test('real-world ActivityWatch pattern: rapid Alacritty/firefox interleaving', () => {
    // Derived from actual MCP data: 06:00-07:10 on 2026-02-27
    // Sub-second granularity, lots of 3-30s switches between terminal and browser
    const records = [
      {
        activity: 'Alacritty',
        duration_sec: 257,
        end_time: new Date('2026-02-27T06:04:18Z'),
        id: 'a1',
        start_time: new Date('2026-02-27T06:00:01Z'),
      },
      {
        activity: 'firefox',
        duration_sec: 3,
        end_time: new Date('2026-02-27T06:04:22Z'),
        id: 'f1',
        start_time: new Date('2026-02-27T06:04:18Z'),
      },
      {
        activity: 'Alacritty',
        duration_sec: 11,
        end_time: new Date('2026-02-27T06:04:34Z'),
        id: 'a2',
        start_time: new Date('2026-02-27T06:04:23Z'),
      },
      {
        activity: 'firefox',
        duration_sec: 7,
        end_time: new Date('2026-02-27T06:04:42Z'),
        id: 'f2',
        start_time: new Date('2026-02-27T06:04:35Z'),
      },
      {
        activity: 'Alacritty',
        duration_sec: 0,
        end_time: new Date('2026-02-27T06:04:43Z'),
        id: 'a3',
        start_time: new Date('2026-02-27T06:04:43Z'),
      },
      {
        activity: 'firefox',
        duration_sec: 13,
        end_time: new Date('2026-02-27T06:04:58Z'),
        id: 'f3',
        start_time: new Date('2026-02-27T06:04:44Z'),
      },
      {
        activity: 'Alacritty',
        duration_sec: 66,
        end_time: new Date('2026-02-27T06:06:06Z'),
        id: 'a4',
        start_time: new Date('2026-02-27T06:04:59Z'),
      },
      {
        activity: 'Alacritty',
        duration_sec: 3,
        end_time: new Date('2026-02-27T06:06:10Z'),
        id: 'a5',
        start_time: new Date('2026-02-27T06:06:07Z'),
      },
      {
        activity: 'Alacritty',
        duration_sec: 21,
        end_time: new Date('2026-02-27T06:06:35Z'),
        id: 'a6',
        start_time: new Date('2026-02-27T06:06:14Z'),
      },
      {
        activity: 'Alacritty',
        duration_sec: 1,
        end_time: new Date('2026-02-27T06:06:39Z'),
        id: 'a7',
        start_time: new Date('2026-02-27T06:06:38Z'),
      },
      {
        activity: 'firefox',
        duration_sec: 16,
        end_time: new Date('2026-02-27T06:07:02Z'),
        id: 'f4',
        start_time: new Date('2026-02-27T06:06:40Z'),
      },
      {
        activity: 'Alacritty',
        duration_sec: 3,
        end_time: new Date('2026-02-27T06:07:06Z'),
        id: 'a8',
        start_time: new Date('2026-02-27T06:07:03Z'),
      },
      {
        activity: 'Alacritty',
        duration_sec: 173,
        end_time: new Date('2026-02-27T06:10:01Z'),
        id: 'a9',
        start_time: new Date('2026-02-27T06:07:08Z'),
      },
      {
        activity: 'Alacritty',
        duration_sec: 241,
        end_time: new Date('2026-02-27T06:14:02Z'),
        id: 'a10',
        start_time: new Date('2026-02-27T06:10:01Z'),
      },
    ]

    const result = mergeProductivitySpans(records)

    // All Alacritty spans should merge into one (max gap between consecutive Alacritty ≤ 2min)
    const alacrittySpans = result.filter((r) => r.activity === 'Alacritty')
    expect(alacrittySpans).toHaveLength(1)
    expect(alacrittySpans[0]!.start_time).toEqual(new Date('2026-02-27T06:00:01Z'))
    expect(alacrittySpans[0]!.end_time).toEqual(new Date('2026-02-27T06:14:02Z'))
    // duration_sec is the sum of actual Alacritty time only (not firefox gaps)
    expect(alacrittySpans[0]!.duration_sec).toBe(257 + 11 + 0 + 66 + 3 + 21 + 1 + 3 + 173 + 241)
    expect(alacrittySpans[0]!.source_ids).toContain('a1')
    expect(alacrittySpans[0]!.source_ids).toContain('a10')

    // All firefox spans merge into one (all gaps ≤ 2min)
    const firefoxSpans = result.filter((r) => r.activity === 'firefox')
    expect(firefoxSpans).toHaveLength(1)
    expect(firefoxSpans[0]!.duration_sec).toBe(3 + 7 + 13 + 16)
  })

  test('zero-duration blip records are absorbed into the surrounding span', () => {
    // A 0-second focus event (e.g. system notification stealing focus briefly)
    const result = mergeProductivitySpans([
      {
        activity: 'Alacritty',
        duration_sec: 60,
        end_time: new Date('2024-01-15T10:01:00Z'),
        id: 'a1',
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity: 'plasmashell',
        duration_sec: 0,
        end_time: new Date('2024-01-15T10:01:00Z'),
        id: 'p1',
        start_time: new Date('2024-01-15T10:01:00Z'),
      },
      {
        activity: 'Alacritty',
        duration_sec: 60,
        end_time: new Date('2024-01-15T10:02:00Z'),
        id: 'a2',
        start_time: new Date('2024-01-15T10:01:00Z'),
      },
    ])

    // Alacritty spans on either side of a 0-sec plasmashell event should merge
    const alacritty = result.find((r) => r.activity === 'Alacritty')!
    expect(alacritty.duration_sec).toBe(120)
    expect(alacritty.source_ids).toEqual(['a1', 'a2'])
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
    expect(result[0]).toMatchObject(record)
    expect(result[0]!.source_ids).toEqual([]) // no id on input record, so no source_ids collected
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
    const activityId = 'activity-id-1'
    vi.mocked(db.getActivitiesExcludingCategories).mockResolvedValue([
      {
        activity_type: 'coffee',
        external_id: 'ext-1',
        id: activityId,
        source: 'aurboda',
        start_time: new Date('2024-01-15T08:00:00Z'),
      },
    ])

    const notesMap = new Map([
      [
        activityId,
        [
          {
            content: 'Morning coffee',
            created_at: new Date('2024-01-15T08:01:00Z'),
            entity_id: activityId,
            entity_type: 'activity' as const,
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
    vi.mocked(db.getActivitiesExcludingCategories).mockResolvedValue([
      {
        activity_type: 'coffee',
        external_id: 'ext-1',
        id: 'activity-1',
        source: 'aurboda',
        start_time: new Date('2024-01-15T08:00:00Z'),
      },
    ])
    vi.mocked(db.getNotesByEntityIds).mockResolvedValue(new Map())

    const result = await queryTags('testuser', new Date('2024-01-15'), new Date('2024-01-16'))

    expect(result[0].comments).toEqual([])
  })
})

describe('assembleScreentimeBuckets', () => {
  test('groups rows by bucket and aggregates totals', () => {
    const rows = [
      {
        bucket_start: new Date('2024-01-15T10:00:00Z'),
        resolved_category: ['Work', 'Programming'],
        total_sec: 1800,
      },
      {
        bucket_start: new Date('2024-01-15T10:00:00Z'),
        resolved_category: ['Work', 'Communication'],
        total_sec: 600,
      },
      { bucket_start: new Date('2024-01-15T11:00:00Z'), resolved_category: ['Media', 'TV'], total_sec: 3600 },
    ]
    const buckets = assembleScreentimeBuckets(rows, 3600000)

    expect(buckets).toHaveLength(2)
    expect(buckets[0].total_sec).toBe(2400) // 1800 + 600
    expect(buckets[0].categories).toHaveLength(2)
    // Sorted by duration desc
    expect(buckets[0].categories[0].total_sec).toBe(1800)
    expect(buckets[1].total_sec).toBe(3600)
  })

  test('handles null resolved_category as empty path', () => {
    const rows = [{ bucket_start: new Date('2024-01-15T10:00:00Z'), resolved_category: null, total_sec: 300 }]
    const buckets = assembleScreentimeBuckets(rows, 3600000)

    expect(buckets).toHaveLength(1)
    expect(buckets[0].categories[0].path).toEqual([])
  })

  test('returns empty array for empty input', () => {
    expect(assembleScreentimeBuckets([], 3600000)).toEqual([])
  })

  test('sorts buckets chronologically', () => {
    const rows = [
      { bucket_start: new Date('2024-01-15T12:00:00Z'), resolved_category: null, total_sec: 100 },
      { bucket_start: new Date('2024-01-15T10:00:00Z'), resolved_category: null, total_sec: 200 },
    ]
    const buckets = assembleScreentimeBuckets(rows, 3600000)
    expect(new Date(buckets[0].start).getTime()).toBeLessThan(new Date(buckets[1].start).getTime())
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

    expect(result.data).toHaveLength(1)
    expect(result.data[0].comments).toHaveLength(1)
    expect(result.data[0].comments[0].content).toBe('Deep focus session')
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

    expect(result.data[0].comments).toEqual([])
  })
})

describe('mergeByCategorySpans', () => {
  const mkRecord = (
    start: string,
    end: string,
    activity: string,
    resolved_category?: string[],
    id?: string,
  ) => ({
    activity,
    duration_sec: (new Date(end).getTime() - new Date(start).getTime()) / 1000,
    end_time: new Date(end),
    id,
    resolved_category,
    source_ids: id ? [id] : [],
    start_time: new Date(start),
  })

  const workDevCategory = {
    color: '#4ade80',
    created_at: new Date(),
    exclude_from_screentime: false,
    id: 'cat-work',
    ignore_case: true,
    name: ['Work & Dev'],
    rule_type: 'none' as const,
    score: 2,
    sort_order: 0,
    updated_at: new Date(),
  }

  const softwareDevCategory = {
    ...workDevCategory,
    id: 'cat-softdev',
    name: ['Work & Dev', 'Software Dev'],
    rule_type: 'regex' as const,
  }

  const communicationCategory = {
    ...workDevCategory,
    id: 'cat-comm',
    name: ['Work & Dev', 'Communication'],
    rule_type: 'regex' as const,
  }

  const excludedCategory = {
    ...workDevCategory,
    exclude_from_screentime: true,
    id: 'cat-excluded',
    name: ['Excluded'],
  }

  const categories = [workDevCategory, softwareDevCategory, communicationCategory, excludedCategory]

  test('merges same-category adjacent records', () => {
    const records = [
      mkRecord('2024-01-15T08:00:00Z', '2024-01-15T08:30:00Z', 'Emacs', ['Work & Dev', 'Software Dev'], 'r1'),
      mkRecord(
        '2024-01-15T08:31:00Z',
        '2024-01-15T09:00:00Z',
        'Alacritty',
        ['Work & Dev', 'Software Dev'],
        'r2',
      ),
    ]
    const { results } = mergeByCategorySpans(records, 2 * 60 * 1000, categories)

    expect(results).toHaveLength(1)
    expect(results[0].resolved_category).toEqual(['Work & Dev', 'Software Dev'])
    expect(results[0].source_ids).toEqual(['r1', 'r2'])
  })

  test('promotes overlapping subcategories to parent', () => {
    const records = [
      mkRecord('2024-01-15T08:00:00Z', '2024-01-15T08:30:00Z', 'Emacs', ['Work & Dev', 'Software Dev'], 'r1'),
      mkRecord(
        '2024-01-15T08:25:00Z',
        '2024-01-15T09:00:00Z',
        'Slack',
        ['Work & Dev', 'Communication'],
        'r2',
      ),
    ]
    const { results } = mergeByCategorySpans(records, 2 * 60 * 1000, categories)

    expect(results).toHaveLength(1)
    expect(results[0].resolved_category).toEqual(['Work & Dev'])
    expect(results[0].category_id).toBe('cat-work')
  })

  test('keeps non-overlapping subcategories separate', () => {
    const records = [
      mkRecord('2024-01-15T08:00:00Z', '2024-01-15T09:00:00Z', 'Emacs', ['Work & Dev', 'Software Dev'], 'r1'),
      mkRecord(
        '2024-01-15T10:00:00Z',
        '2024-01-15T11:00:00Z',
        'Slack',
        ['Work & Dev', 'Communication'],
        'r2',
      ),
    ]
    const { results } = mergeByCategorySpans(records, 2 * 60 * 1000, categories)

    expect(results).toHaveLength(2)
    expect(results[0].resolved_category).toEqual(['Work & Dev', 'Software Dev'])
    expect(results[1].resolved_category).toEqual(['Work & Dev', 'Communication'])
  })

  test('filters out excluded categories', () => {
    const records = [
      mkRecord('2024-01-15T08:00:00Z', '2024-01-15T08:30:00Z', 'plasmashell', ['Excluded'], 'r1'),
      mkRecord('2024-01-15T08:00:00Z', '2024-01-15T09:00:00Z', 'Emacs', ['Work & Dev', 'Software Dev'], 'r2'),
    ]
    const { results } = mergeByCategorySpans(records, 2 * 60 * 1000, categories)

    expect(results).toHaveLength(1)
    expect(results[0].activity).toBe('Emacs')
  })

  test('filters out uncategorized records', () => {
    const records = [
      mkRecord('2024-01-15T08:00:00Z', '2024-01-15T08:30:00Z', 'random-app', undefined, 'r1'),
      mkRecord('2024-01-15T08:00:00Z', '2024-01-15T09:00:00Z', 'Emacs', ['Work & Dev', 'Software Dev'], 'r2'),
    ]
    const { results } = mergeByCategorySpans(records, 2 * 60 * 1000, categories)

    expect(results).toHaveLength(1)
    expect(results[0].activity).toBe('Emacs')
  })

  test('returns categories map with resolved category metadata', () => {
    const records = [
      mkRecord('2024-01-15T08:00:00Z', '2024-01-15T09:00:00Z', 'Emacs', ['Work & Dev', 'Software Dev'], 'r1'),
    ]
    const { categoriesMap } = mergeByCategorySpans(records, 2 * 60 * 1000, categories)

    expect(categoriesMap['cat-softdev']).toEqual({
      color: '#4ade80',
      name: ['Work & Dev', 'Software Dev'],
      score: 2,
    })
  })

  test('joins multiple apps in activity field', () => {
    const records = [
      mkRecord('2024-01-15T08:00:00Z', '2024-01-15T08:30:00Z', 'Emacs', ['Work & Dev', 'Software Dev'], 'r1'),
      mkRecord(
        '2024-01-15T08:25:00Z',
        '2024-01-15T09:00:00Z',
        'Slack',
        ['Work & Dev', 'Communication'],
        'r2',
      ),
    ]
    const { results } = mergeByCategorySpans(records, 2 * 60 * 1000, categories)

    expect(results[0].activity).toBe('Emacs, Slack')
  })

  test('sums duration_sec from constituent records', () => {
    const records = [
      mkRecord('2024-01-15T08:00:00Z', '2024-01-15T08:30:00Z', 'Emacs', ['Work & Dev', 'Software Dev'], 'r1'),
      mkRecord('2024-01-15T08:31:00Z', '2024-01-15T09:00:00Z', 'Emacs', ['Work & Dev', 'Software Dev'], 'r2'),
    ]
    const { results } = mergeByCategorySpans(records, 2 * 60 * 1000, categories)

    expect(results[0].duration_sec).toBe(1800 + 1740)
  })
})
