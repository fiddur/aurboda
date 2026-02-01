import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as db from '../db'
import {
  getActivityImpact,
  getBaseline,
  getEventProbability,
  getHrvActivitiesCorrelation,
} from './correlations'
import * as locations from './locations'

// Mock db module
vi.mock('../db', () => ({
  getActivities: vi.fn(),
  getProductivity: vi.fn(),
  getTags: vi.fn(),
  getTimeSeries: vi.fn(),
  getTimeSeriesStats: vi.fn(),
}))

// Mock locations module
vi.mock('./locations', () => ({
  getPlaceVisits: vi.fn(),
}))

describe('correlations service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getBaseline', () => {
    test('returns HRV and resting HR baseline statistics', async () => {
      // Mock stats - order: HRV 7-day, HRV 30-day, HRV prev-30, HR 7-day, HR 30-day, HR prev-30
      vi.mocked(db.getTimeSeriesStats)
        .mockResolvedValueOnce([
          { avg: 45.5, count: 100, max: 80, metric: 'hrv_rmssd', min: 20, stddev: 5, unit: 'ms' },
        ]) // 7-day HRV
        .mockResolvedValueOnce([
          { avg: 44.2, count: 400, max: 85, metric: 'hrv_rmssd', min: 18, stddev: 6, unit: 'ms' },
        ]) // 30-day HRV
        .mockResolvedValueOnce([
          { avg: 43.0, count: 400, max: 82, metric: 'hrv_rmssd', min: 17, stddev: 5, unit: 'ms' },
        ]) // previous 30-day HRV
        .mockResolvedValueOnce([
          { avg: 60.3, count: 100, max: 70, metric: 'resting_heart_rate', min: 52, stddev: 3, unit: 'bpm' },
        ]) // 7-day resting HR
        .mockResolvedValueOnce([
          { avg: 61.1, count: 400, max: 72, metric: 'resting_heart_rate', min: 50, stddev: 4, unit: 'bpm' },
        ]) // 30-day resting HR
        .mockResolvedValueOnce([
          { avg: 62.5, count: 400, max: 73, metric: 'resting_heart_rate', min: 51, stddev: 4, unit: 'bpm' },
        ]) // previous 30-day HR

      const result = await getBaseline('testuser')

      expect(result.hrv.avg7day).toBe(45.5)
      expect(result.hrv.avg30day).toBe(44.2)
      expect(result.restingHr.avg7day).toBe(60.3)
      expect(result.restingHr.avg30day).toBe(61.1)
      expect(result.hrv.trendPercent).not.toBeNull()
      expect(result.restingHr.trendPercent).not.toBeNull()
      expect(result.period.start).toBeDefined()
      expect(result.period.end).toBeDefined()
    })

    test('handles missing data gracefully', async () => {
      vi.mocked(db.getTimeSeriesStats).mockResolvedValue([])

      const result = await getBaseline('testuser')

      expect(result.hrv.avg7day).toBeNull()
      expect(result.hrv.avg30day).toBeNull()
      expect(result.restingHr.avg7day).toBeNull()
      expect(result.restingHr.avg30day).toBeNull()
    })

    test('uses reference date when provided', async () => {
      vi.mocked(db.getTimeSeriesStats).mockResolvedValue([])

      const referenceDate = new Date('2024-01-15T12:00:00Z')
      await getBaseline('testuser', referenceDate)

      // Should be called with dates calculated from reference date
      expect(db.getTimeSeriesStats).toHaveBeenCalled()
      const calls = vi.mocked(db.getTimeSeriesStats).mock.calls
      // First call should be for 7-day HRV ending on reference date
      const [, , , endDate] = calls[0]
      expect(new Date(endDate).toISOString().split('T')[0]).toBe('2024-01-15')
    })
  })

  describe('getHrvActivitiesCorrelation', () => {
    test('returns correlations for productivity, locations, activities and tags', async () => {
      const now = new Date()
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

      vi.mocked(db.getTimeSeries).mockResolvedValue([
        [yesterday, 45] as [Date, number],
        [now, 50] as [Date, number],
      ])
      vi.mocked(db.getProductivity).mockResolvedValue([
        {
          activity: 'vscode',
          category: 'Software Development',
          durationSec: 3600,
          endTime: new Date(yesterday.getTime() + 3600000),
          productivity: 2,
          startTime: yesterday,
        },
      ])
      vi.mocked(locations.getPlaceVisits).mockResolvedValue([
        {
          durationMinutes: 60,
          endTime: new Date(yesterday.getTime() + 3600000),
          lat: 59.33,
          lon: 18.07,
          name: 'Office',
          source: 'named' as const,
          startTime: yesterday,
        },
      ])
      vi.mocked(db.getActivities).mockResolvedValue([
        {
          activityType: 'exercise' as const,
          endTime: new Date(yesterday.getTime() + 3600000),
          id: 'act1',
          source: 'health_connect' as const,
          startTime: yesterday,
        },
      ])
      vi.mocked(db.getTags).mockResolvedValue([
        {
          endTime: new Date(yesterday.getTime() + 300000),
          externalId: 'tag1',
          source: 'manual' as const,
          startTime: yesterday,
          tag: 'coffee',
        },
      ])

      const result = await getHrvActivitiesCorrelation('testuser', 7)

      expect(result.period.days).toBe(7)
      expect(result.baseline).toBeDefined()
      expect(result.correlations.productivity).toBeInstanceOf(Array)
      expect(result.correlations.locations).toBeInstanceOf(Array)
      expect(result.correlations.activities).toBeInstanceOf(Array)
      expect(result.correlations.tags).toBeInstanceOf(Array)
    })

    test('calls sync provider when provided', async () => {
      vi.mocked(db.getTimeSeries).mockResolvedValue([])
      vi.mocked(db.getProductivity).mockResolvedValue([])
      vi.mocked(locations.getPlaceVisits).mockResolvedValue([])
      vi.mocked(db.getActivities).mockResolvedValue([])
      vi.mocked(db.getTags).mockResolvedValue([])

      const syncProvider = {
        syncOuraIfNeeded: vi.fn().mockResolvedValue(undefined),
        syncRescueTimeIfNeeded: vi.fn().mockResolvedValue(undefined),
      }

      await getHrvActivitiesCorrelation('testuser', 30, syncProvider)

      expect(syncProvider.syncOuraIfNeeded).toHaveBeenCalledWith('testuser', 'tags')
      expect(syncProvider.syncOuraIfNeeded).toHaveBeenCalledWith('testuser', 'sessions')
      expect(syncProvider.syncRescueTimeIfNeeded).toHaveBeenCalledWith('testuser')
    })
  })

  describe('getActivityImpact', () => {
    test('returns HRV timeline for tag activity', async () => {
      const baseTime = new Date('2024-01-15T12:00:00Z')

      vi.mocked(db.getTimeSeries).mockResolvedValue([
        [new Date(baseTime.getTime() - 25 * 60 * 1000), 45], // before30
        [new Date(baseTime.getTime() - 10 * 60 * 1000), 48], // before15
        [new Date(baseTime.getTime() + 5 * 60 * 1000), 42], // during
        [new Date(baseTime.getTime() + 20 * 60 * 1000), 50], // after15
        [new Date(baseTime.getTime() + 35 * 60 * 1000), 52], // after30
      ] as [Date, number][])
      vi.mocked(db.getTags).mockResolvedValue([
        {
          endTime: new Date(baseTime.getTime() + 10 * 60 * 1000),
          externalId: 'tag1',
          source: 'manual' as const,
          startTime: baseTime,
          tag: 'coffee',
        },
      ])

      const result = await getActivityImpact('testuser', 'coffee', 'tag', 30, 90)

      expect(result.activity).toBe('coffee')
      expect(result.activityType).toBe('tag')
      expect(result.occurrences).toBe(1)
      expect(result.hrvTimeline).toBeDefined()
      expect(result.hrTimeline).toBeDefined()
      expect(result.hrvTimeline.before30min).toBeDefined()
      expect(result.hrvTimeline.during).toBeDefined()
      expect(result.hrvTimeline.after30min).toBeDefined()
    })

    test('returns zero occurrences when no matching tags', async () => {
      vi.mocked(db.getTimeSeries).mockResolvedValue([])
      vi.mocked(db.getTags).mockResolvedValue([])

      const result = await getActivityImpact('testuser', 'nonexistent', 'tag', 30, 90)

      expect(result.occurrences).toBe(0)
      expect(result.avgDurationMin).toBe(0)
    })

    test('handles productivity category activity type', async () => {
      const baseTime = new Date('2024-01-15T12:00:00Z')

      vi.mocked(db.getTimeSeries).mockResolvedValue([])
      vi.mocked(db.getProductivity).mockResolvedValue([
        {
          activity: 'vscode',
          category: 'Software Development',
          durationSec: 3600,
          endTime: new Date(baseTime.getTime() + 3600000),
          productivity: 2,
          startTime: baseTime,
        },
      ])

      const result = await getActivityImpact('testuser', 'software development', 'productivity_category')

      expect(result.activityType).toBe('productivity_category')
      expect(result.occurrences).toBe(1)
    })
  })

  describe('getEventProbability', () => {
    test('calculates probability of outcome after trigger', async () => {
      const day1 = new Date('2024-01-01T10:00:00Z')
      const day1Later = new Date('2024-01-01T18:00:00Z')
      const day2 = new Date('2024-01-02T10:00:00Z')

      vi.mocked(db.getTags).mockResolvedValue([
        // Trigger events (gym)
        { externalId: 't1', source: 'manual' as const, startTime: day1, tag: 'gym' },
        { externalId: 't2', source: 'manual' as const, startTime: day2, tag: 'gym' },
        // Outcome events (headache)
        { externalId: 'o1', source: 'manual' as const, startTime: day1Later, tag: 'headache' },
      ])

      const result = await getEventProbability(
        'testuser',
        { type: 'tag', value: 'gym' },
        { pattern: 'headache', type: 'tag' },
        ['12h', '24h'],
        365,
      )

      expect(result.trigger.type).toBe('tag')
      expect(result.trigger.value).toBe('gym')
      expect(result.outcome.pattern).toBe('headache')
      expect(result.sampleSize.triggerEvents).toBe(2)
      expect(result.sampleSize.outcomeEvents).toBe(1)
      expect(result.postTrigger['12h']).toBeDefined()
      expect(result.postTrigger['24h']).toBeDefined()
      expect(result.baseline.probability).toBeGreaterThanOrEqual(0)
    })

    test('handles activity triggers', async () => {
      const day1 = new Date('2024-01-01T10:00:00Z')
      const day1End = new Date('2024-01-01T11:00:00Z')
      const day1Later = new Date('2024-01-01T18:00:00Z')

      vi.mocked(db.getActivities).mockResolvedValue([
        {
          activityType: 'exercise' as const,
          endTime: day1End,
          id: 'a1',
          source: 'health_connect' as const,
          startTime: day1,
        },
      ])
      vi.mocked(db.getTags).mockResolvedValue([
        { externalId: 'o1', source: 'manual' as const, startTime: day1Later, tag: 'headache' },
      ])

      const result = await getEventProbability(
        'testuser',
        { type: 'activity', value: 'exercise' },
        { pattern: 'headache', type: 'tag' },
        ['24h'],
        30,
      )

      expect(result.trigger.type).toBe('activity')
      expect(result.sampleSize.triggerEvents).toBe(1)
    })

    test('returns zero probability when no outcomes', async () => {
      const day1 = new Date('2024-01-01T10:00:00Z')

      vi.mocked(db.getTags).mockResolvedValue([
        { externalId: 't1', source: 'manual' as const, startTime: day1, tag: 'gym' },
      ])

      const result = await getEventProbability(
        'testuser',
        { type: 'tag', value: 'gym' },
        { pattern: 'headache', type: 'tag' },
      )

      expect(result.sampleSize.outcomeEvents).toBe(0)
      expect(result.baseline.probability).toBe(0)
    })
  })
})
