import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { MetricType } from '../../schema.ts'

import * as db from '../../db/index.ts'
import * as locationsService from '../locations.ts'
import { computeSleepStageSummary, findSleepLocation, getDailySummary } from './daily-summary.ts'

// Mock the db module
vi.mock('../../db', () => ({
  getActivities: vi.fn(),
  getActivityTypeDefinitions: vi.fn().mockResolvedValue([]),
  getDailyAggregateValue: vi.fn(),
  getMeals: vi.fn(),
  getNonSleepActivitiesMerged: vi.fn(),
  getNotesByEntityIds: vi.fn(),
  getNotesForTimeRange: vi.fn(),
  getProductivity: vi.fn(),
  getSleepSessions: vi.fn(),
  getTimeSeries: vi.fn(),
  getTimeSeriesMultiMetric: vi.fn(),
  getUserSettings: vi.fn(),
}))

// Mock the screentime-categories module
import * as screentimeCategoriesDb from '../../db/screentime-categories.ts'
vi.mock('../../db/screentime-categories', () => ({
  getScreentimeCategories: vi.fn().mockResolvedValue([]),
}))

// Mock the locations service
vi.mock('../locations', () => ({
  getPlaceVisits: vi.fn(),
}))

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

    expect(result.scores).toEqual({
      cardiovascular_age: 35,
      readiness_score: 85,
      resilience_score: 75,
      sleep_score: 92,
    })
  })

  test('returns null scores when no score data', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({} as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    expect(result.scores).toBeNull()
  })

  test('returns partial scores when some metrics are missing', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([])
    vi.mocked(db.getSleepSessions).mockResolvedValue([])
    vi.mocked(db.getNonSleepActivitiesMerged).mockResolvedValue([])
    vi.mocked(db.getProductivity).mockResolvedValue([])
    vi.mocked(locationsService.getPlaceVisits).mockResolvedValue([])
    vi.mocked(db.getDailyAggregateValue).mockResolvedValue(null)

    // Only some score metrics available
    vi.mocked(db.getTimeSeriesMultiMetric).mockResolvedValue({
      readiness_score: [[new Date('2024-01-15T00:00:00Z'), 85]],
      sleep_score: [[new Date('2024-01-15T00:00:00Z'), 92]],
    } as Record<MetricType, [Date, number][]>)

    const result = await getDailySummary('testuser', new Date('2024-01-15'))

    expect(result.scores).toEqual({
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
