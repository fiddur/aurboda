import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../db/index.ts'
import {
  getActivityImpact,
  getBaseline,
  getEventProbability,
  getGenericCorrelation,
  getHrvActivitiesCorrelation,
} from './correlations/index.ts'
import * as locations from './locations.ts'
import * as queries from './queries/index.ts'

// Mock db module
vi.mock('../db', () => ({
  getAllActivitiesInRange: vi.fn(),
  getProductivity: vi.fn(),
  getTimeSeries: vi.fn(),
  getTimeSeriesStats: vi.fn(),
}))

// Mock locations module
vi.mock('./locations', () => ({
  getPlaceVisits: vi.fn(),
}))

// Mock queries module (for queryMetrics used by getBaseline)
vi.mock('./queries/index', async (importOriginal) => {
  const actual = await importOriginal<typeof queries>()
  return {
    ...actual,
    queryMetrics: vi.fn(),
  }
})

describe('correlations service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getBaseline', () => {
    const emptyHrvResult = { count: 0, data: [], metric: 'hrv_sleep', unit: 'ms' }

    test('returns sleep HRV and resting HR baseline statistics', async () => {
      // Mock queryMetrics for sleep HRV (3 calls: 7-day, 30-day, prev-30)
      vi.mocked(queries.queryMetrics)
        .mockResolvedValueOnce({
          count: 3,
          data: [
            { time: '2024-01-13T02:00:00Z', value: 40 },
            { time: '2024-01-14T02:00:00Z', value: 46 },
            { time: '2024-01-15T02:00:00Z', value: 50.5 },
          ],
          metric: 'hrv_sleep',
          unit: 'ms',
        }) // 7-day sleep HRV (avg = 45.5)
        .mockResolvedValueOnce({
          count: 2,
          data: [
            { time: '2024-01-01T02:00:00Z', value: 42 },
            { time: '2024-01-10T02:00:00Z', value: 46.4 },
          ],
          metric: 'hrv_sleep',
          unit: 'ms',
        }) // 30-day sleep HRV (avg = 44.2)
        .mockResolvedValueOnce({
          count: 2,
          data: [
            { time: '2023-12-01T02:00:00Z', value: 41 },
            { time: '2023-12-15T02:00:00Z', value: 45 },
          ],
          metric: 'hrv_sleep',
          unit: 'ms',
        }) // previous 30-day sleep HRV (avg = 43.0)

      // Mock resting HR stats (3 calls: 7-day, 30-day, prev-30) and stress stats (3 calls)
      vi.mocked(db.getTimeSeriesStats)
        .mockResolvedValueOnce([
          { avg: 60.3, count: 100, max: 70, metric: 'resting_heart_rate', min: 52, stddev: 3, unit: 'bpm' },
        ]) // 7-day resting HR
        .mockResolvedValueOnce([
          { avg: 61.1, count: 400, max: 72, metric: 'resting_heart_rate', min: 50, stddev: 4, unit: 'bpm' },
        ]) // 30-day resting HR
        .mockResolvedValueOnce([
          { avg: 62.5, count: 400, max: 73, metric: 'resting_heart_rate', min: 51, stddev: 4, unit: 'bpm' },
        ]) // previous 30-day HR
        .mockResolvedValueOnce([
          { avg: 35.2, count: 100, max: 80, metric: 'stress_level', min: 10, stddev: 12, unit: '' },
        ]) // 7-day stress
        .mockResolvedValueOnce([
          { avg: 37.5, count: 400, max: 85, metric: 'stress_level', min: 8, stddev: 14, unit: '' },
        ]) // 30-day stress
        .mockResolvedValueOnce([
          { avg: 40.0, count: 400, max: 90, metric: 'stress_level', min: 12, stddev: 15, unit: '' },
        ]) // previous 30-day stress

      const result = await getBaseline('testuser')

      // Verify HRV is fetched via queryMetrics('hrv_sleep'), not getTimeSeriesStats('hrv_rmssd')
      expect(queries.queryMetrics).toHaveBeenCalledTimes(3)
      for (const [, metric] of vi.mocked(queries.queryMetrics).mock.calls) {
        expect(metric).toBe('hrv_sleep')
      }

      // Verify averages are computed correctly from the data points
      expect(result.hrv.avg7day).toBe(45.5) // (40 + 46 + 50.5) / 3
      expect(result.hrv.avg30day).toBe(44.2) // (42 + 46.4) / 2
      expect(result.resting_hr.avg7day).toBe(60.3)
      expect(result.resting_hr.avg30day).toBe(61.1)
      expect(result.stress.avg7day).toBe(35.2)
      expect(result.stress.avg30day).toBe(37.5)

      // Verify trends are calculated (30-day vs previous 30-day)
      expect(result.hrv.trend_percent).not.toBeNull()
      expect(result.resting_hr.trend_percent).not.toBeNull()
      expect(result.stress.trend_percent).not.toBeNull()
      expect(result.period.start).toBeDefined()
      expect(result.period.end).toBeDefined()
    })

    test('handles missing data gracefully', async () => {
      vi.mocked(queries.queryMetrics).mockResolvedValue(emptyHrvResult)
      vi.mocked(db.getTimeSeriesStats).mockResolvedValue([])

      const result = await getBaseline('testuser')

      // Should still call queryMetrics for sleep HRV even when empty
      expect(queries.queryMetrics).toHaveBeenCalledTimes(3)

      expect(result.hrv.avg7day).toBeNull()
      expect(result.hrv.avg30day).toBeNull()
      expect(result.resting_hr.avg7day).toBeNull()
      expect(result.resting_hr.avg30day).toBeNull()
      expect(result.stress.avg7day).toBeNull()
      expect(result.stress.avg30day).toBeNull()
    })

    test('uses reference date when provided', async () => {
      vi.mocked(queries.queryMetrics).mockResolvedValue(emptyHrvResult)
      vi.mocked(db.getTimeSeriesStats).mockResolvedValue([])

      const referenceDate = new Date('2024-01-15T12:00:00Z')
      await getBaseline('testuser', referenceDate)

      // queryMetrics called for sleep HRV with dates from reference date
      expect(queries.queryMetrics).toHaveBeenCalled()
      const hrvCalls = vi.mocked(queries.queryMetrics).mock.calls
      // First call: 7-day sleep HRV ending on reference date
      const [, metric, , endDate] = hrvCalls[0]
      expect(metric).toBe('hrv_sleep')
      expect(endDate.toISOString().split('T')[0]).toBe('2024-01-15')

      // getTimeSeriesStats called for resting HR and stress with dates from reference date
      expect(db.getTimeSeriesStats).toHaveBeenCalledTimes(6) // 3 for HR + 3 for stress
      const statsCalls = vi.mocked(db.getTimeSeriesStats).mock.calls
      const [, , , hrEndDate] = statsCalls[0]
      expect(new Date(hrEndDate).toISOString().split('T')[0]).toBe('2024-01-15')
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
          duration_sec: 3600,
          end_time: new Date(yesterday.getTime() + 3600000),
          productivity: 2,
          start_time: yesterday,
        },
      ])
      vi.mocked(locations.getPlaceVisits).mockResolvedValue([
        {
          duration_minutes: 60,
          end_time: new Date(yesterday.getTime() + 3600000),
          lat: 59.33,
          lon: 18.07,
          name: 'Office',
          source: 'named' as const,
          start_time: yesterday,
        },
      ])
      vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([
        {
          activity_type: 'exercise' as const,
          end_time: new Date(yesterday.getTime() + 3600000),
          id: 'act1',
          source: 'health_connect' as const,
          start_time: yesterday,
        },
      ])
      vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([
        {
          end_time: new Date(yesterday.getTime() + 300000),
          external_id: 'tag1',
          source: 'manual' as const,
          start_time: yesterday,
          activity_type: 'coffee',
        },
      ])

      const result = await getHrvActivitiesCorrelation('testuser', 7)

      expect(result.period.days).toBe(7)
      expect(result.baseline).toBeDefined()
      expect(result.correlations.productivity).toBeInstanceOf(Array)
      expect(result.correlations.locations).toBeInstanceOf(Array)
      expect(result.correlations.activities).toBeInstanceOf(Array)
    })

    test('calls sync provider when provided', async () => {
      vi.mocked(db.getTimeSeries).mockResolvedValue([])
      vi.mocked(db.getProductivity).mockResolvedValue([])
      vi.mocked(locations.getPlaceVisits).mockResolvedValue([])
      vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([])
      vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([])

      const syncProvider = {
        syncCalendarsIfNeeded: vi.fn().mockResolvedValue(undefined),
        syncGarminIfNeeded: vi.fn().mockResolvedValue(undefined),
        syncLastFmIfNeeded: vi.fn().mockResolvedValue(undefined),
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
      vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([
        {
          end_time: new Date(baseTime.getTime() + 10 * 60 * 1000),
          external_id: 'tag1',
          source: 'manual' as const,
          start_time: baseTime,
          activity_type: 'coffee',
        },
      ])

      const result = await getActivityImpact('testuser', 'coffee', 'tag', 30, 90)

      expect(result.activity).toBe('coffee')
      expect(result.activity_type).toBe('tag')
      expect(result.occurrences).toBe(1)
      expect(result.hrv_timeline).toBeDefined()
      expect(result.hr_timeline).toBeDefined()
      expect(result.stress_timeline).toBeDefined()
      expect(result.hrv_timeline.before30min).toBeDefined()
      expect(result.hrv_timeline.during).toBeDefined()
      expect(result.hrv_timeline.after30min).toBeDefined()
      expect(result.stress_timeline.before30min).toBeDefined()
      expect(result.stress_timeline.during).toBeDefined()
      expect(result.stress_timeline.after30min).toBeDefined()
    })

    test('returns zero occurrences when no matching tags', async () => {
      vi.mocked(db.getTimeSeries).mockResolvedValue([])
      vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([])

      const result = await getActivityImpact('testuser', 'nonexistent', 'tag', 30, 90)

      expect(result.occurrences).toBe(0)
      expect(result.avg_duration_min).toBe(0)
    })

    test('handles productivity category activity type', async () => {
      const baseTime = new Date('2024-01-15T12:00:00Z')

      vi.mocked(db.getTimeSeries).mockResolvedValue([])
      vi.mocked(db.getProductivity).mockResolvedValue([
        {
          activity: 'vscode',
          category: 'Software Development',
          duration_sec: 3600,
          end_time: new Date(baseTime.getTime() + 3600000),
          productivity: 2,
          start_time: baseTime,
        },
      ])

      const result = await getActivityImpact('testuser', 'software development', 'productivity_category')

      expect(result.activity_type).toBe('productivity_category')
      expect(result.occurrences).toBe(1)
    })
  })

  describe('getEventProbability', () => {
    test('calculates probability of outcome after trigger', async () => {
      const day1 = new Date('2024-01-01T10:00:00Z')
      const day1Later = new Date('2024-01-01T18:00:00Z')
      const day2 = new Date('2024-01-02T10:00:00Z')

      vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([
        // Trigger events (gym)
        { external_id: 't1', source: 'manual' as const, start_time: day1, activity_type: 'gym' },
        { external_id: 't2', source: 'manual' as const, start_time: day2, activity_type: 'gym' },
        // Outcome events (headache)
        { external_id: 'o1', source: 'manual' as const, start_time: day1Later, activity_type: 'headache' },
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
      expect(result.sample_size.trigger_events).toBe(2)
      expect(result.sample_size.outcome_events).toBe(1)
      expect(result.post_trigger['12h']).toBeDefined()
      expect(result.post_trigger['24h']).toBeDefined()
      expect(result.baseline.probability).toBeGreaterThanOrEqual(0)
    })

    test('handles activity triggers', async () => {
      const day1 = new Date('2024-01-01T10:00:00Z')
      const day1End = new Date('2024-01-01T11:00:00Z')
      const day1Later = new Date('2024-01-01T18:00:00Z')

      vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([
        {
          activity_type: 'exercise',
          end_time: day1End,
          id: 'a1',
          source: 'health_connect' as const,
          start_time: day1,
        },
        { activity_type: 'headache', external_id: 'o1', source: 'manual' as const, start_time: day1Later },
      ])

      const result = await getEventProbability(
        'testuser',
        { type: 'activity', value: 'exercise' },
        { pattern: 'headache', type: 'tag' },
        ['24h'],
        30,
      )

      expect(result.trigger.type).toBe('activity')
      expect(result.sample_size.trigger_events).toBe(1)
    })

    test('returns zero probability when no outcomes', async () => {
      const day1 = new Date('2024-01-01T10:00:00Z')

      vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([
        { external_id: 't1', source: 'manual' as const, start_time: day1, activity_type: 'gym' },
      ])

      const result = await getEventProbability(
        'testuser',
        { type: 'tag', value: 'gym' },
        { pattern: 'headache', type: 'tag' },
      )

      expect(result.sample_size.outcome_events).toBe(0)
      expect(result.baseline.probability).toBe(0)
    })
  })

  describe('getGenericCorrelation', () => {
    describe('single trigger with tag outcome', () => {
      test('correlates tag trigger with tag outcome', async () => {
        // Use dates relative to now so they fall within the period
        const now = new Date()
        const day1 = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000) // 10 days ago
        day1.setHours(10, 0, 0, 0)
        const day1Later = new Date(day1.getTime() + 8 * 60 * 60 * 1000) // 8 hours later
        const day2 = new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000) // 9 days ago
        day2.setHours(10, 0, 0, 0)

        vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([
          { external_id: 't1', source: 'manual' as const, start_time: day1, activity_type: 'meditation' },
          { external_id: 't2', source: 'manual' as const, start_time: day2, activity_type: 'meditation' },
          { external_id: 'o1', source: 'manual' as const, start_time: day1Later, activity_type: 'fatcoffee' },
        ])
        vi.mocked(db.getProductivity).mockResolvedValue([])
        vi.mocked(db.getTimeSeries).mockResolvedValue([])

        const result = await getGenericCorrelation(
          'testuser',
          [{ pattern: 'meditation', type: 'tag' }],
          { pattern: 'fatcoffee', type: 'tag' },
          ['24h'],
          90,
        )

        expect(result.triggers).toHaveLength(1)
        expect(result.triggers[0].type).toBe('tag')
        expect(result.outcome.type).toBe('tag')
        expect(result.windows_matched).toBe(2)
        expect(result.post_trigger['24h']).toBeDefined()
      })
    })

    describe('single trigger with metric outcome', () => {
      test('correlates activity trigger with weight metric', async () => {
        // Use relative dates
        const now = new Date()

        // Week 1: Exercise 3 times, then weight measured
        const week1Day1 = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000) // 20 days ago
        week1Day1.setHours(10, 0, 0, 0)
        const week1Day2 = new Date(week1Day1.getTime() + 24 * 60 * 60 * 1000)
        const week1Day3 = new Date(week1Day1.getTime() + 2 * 24 * 60 * 60 * 1000)
        const week1WeightDay = new Date(week1Day1.getTime() + 4 * 24 * 60 * 60 * 1000)
        week1WeightDay.setHours(8, 0, 0, 0)

        // Week 2: No exercise, weight measured (baseline)
        const week2WeightDay = new Date(week1Day1.getTime() + 11 * 24 * 60 * 60 * 1000)
        week2WeightDay.setHours(8, 0, 0, 0)

        vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([
          {
            activity_type: 'exercise' as const,
            end_time: new Date(week1Day1.getTime() + 3600000),
            id: 'e1',
            source: 'health_connect' as const,
            start_time: week1Day1,
          },
          {
            activity_type: 'exercise' as const,
            end_time: new Date(week1Day2.getTime() + 3600000),
            id: 'e2',
            source: 'health_connect' as const,
            start_time: week1Day2,
          },
          {
            activity_type: 'exercise' as const,
            end_time: new Date(week1Day3.getTime() + 3600000),
            id: 'e3',
            source: 'health_connect' as const,
            start_time: week1Day3,
          },
        ])
        vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([])
        vi.mocked(db.getProductivity).mockResolvedValue([])
        vi.mocked(db.getTimeSeries).mockResolvedValue([
          [week1WeightDay, 80.5],
          [week2WeightDay, 81.2],
        ] as [Date, number][])

        const result = await getGenericCorrelation(
          'testuser',
          [{ min_count: 3, pattern: 'exercise', type: 'activity', window_days: 7 }],
          { metric: 'weight', type: 'metric' },
          ['7d'],
          30,
        )

        expect(result.triggers).toHaveLength(1)
        expect(result.outcome.type).toBe('metric')
        if (result.outcome.type === 'metric') {
          expect(result.outcome.metric).toBe('weight')
        }
        expect(result.post_trigger['7d']).toBeDefined()
        expect(result.baseline).toBeDefined()
      })
    })

    describe('compound triggers', () => {
      test('correlates multiple conditions (exercise 3x AND fatcoffee 5x in a week)', async () => {
        // Set up a week with both conditions met, using relative dates
        const now = new Date()
        const baseDate = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000) // 20 days ago
        baseDate.setHours(10, 0, 0, 0)

        const exercises = []
        const tags = []

        // 3 exercise sessions over 3 days
        for (let i = 0; i < 3; i++) {
          const day = new Date(baseDate.getTime() + i * 24 * 60 * 60 * 1000)
          exercises.push({
            activity_type: 'exercise' as const,
            end_time: new Date(day.getTime() + 3600000),
            id: `e${i}`,
            source: 'health_connect' as const,
            start_time: day,
          })
        }

        // 5 fatcoffee tags over 5 days
        for (let i = 0; i < 5; i++) {
          const day = new Date(baseDate.getTime() + i * 24 * 60 * 60 * 1000)
          tags.push({
            external_id: `fc${i}`,
            source: 'manual' as const,
            start_time: new Date(day.getTime() + 6 * 60 * 60 * 1000), // Morning coffee
            activity_type: 'fatcoffee',
          })
        }

        // Weight measurement after the week
        const weightDay = new Date(baseDate.getTime() + 10 * 24 * 60 * 60 * 1000)

        vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([...exercises, ...tags])
        vi.mocked(db.getProductivity).mockResolvedValue([])
        vi.mocked(db.getTimeSeries).mockResolvedValue([[weightDay, 79.5]] as [Date, number][])

        const result = await getGenericCorrelation(
          'testuser',
          [
            { min_count: 3, pattern: 'exercise', type: 'activity', window_days: 7 },
            { min_count: 5, pattern: 'fatcoffee', type: 'tag', window_days: 7 },
          ],
          { metric: 'weight', type: 'metric' },
          ['7d', '14d'],
          90,
        )

        expect(result.triggers).toHaveLength(2)
        expect(result.windows_matched).toBeGreaterThanOrEqual(1)
        expect(result.post_trigger['7d']).toBeDefined()
        expect(result.post_trigger['14d']).toBeDefined()
      })

      test('returns zero windows when compound conditions not all met', async () => {
        // Use relative dates
        const now = new Date()
        const baseDate = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000) // 15 days ago
        baseDate.setHours(10, 0, 0, 0)

        // Only 2 exercise sessions (need 3)
        vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([
          {
            activity_type: 'exercise' as const,
            end_time: new Date(baseDate.getTime() + 3600000),
            id: 'e1',
            source: 'health_connect' as const,
            start_time: baseDate,
          },
          {
            activity_type: 'exercise' as const,
            end_time: new Date(baseDate.getTime() + 24 * 60 * 60 * 1000 + 3600000),
            id: 'e2',
            source: 'health_connect' as const,
            start_time: new Date(baseDate.getTime() + 24 * 60 * 60 * 1000),
          },
        ])
        // 5 fatcoffee tags (this condition is met)
        const tags = []
        for (let i = 0; i < 5; i++) {
          tags.push({
            external_id: `fc${i}`,
            source: 'manual' as const,
            start_time: new Date(baseDate.getTime() + i * 24 * 60 * 60 * 1000),
            activity_type: 'fatcoffee',
          })
        }
        vi.mocked(db.getAllActivitiesInRange).mockResolvedValue(tags)
        vi.mocked(db.getProductivity).mockResolvedValue([])
        vi.mocked(db.getTimeSeries).mockResolvedValue([])

        const result = await getGenericCorrelation(
          'testuser',
          [
            { min_count: 3, pattern: 'exercise', type: 'activity', window_days: 7 },
            { min_count: 5, pattern: 'fatcoffee', type: 'tag', window_days: 7 },
          ],
          { metric: 'weight', type: 'metric' },
          ['7d'],
          30,
        )

        expect(result.windows_matched).toBe(0)
      })
    })

    describe('productivity outcome', () => {
      test('correlates meditation with productive time', async () => {
        // Use relative dates
        const now = new Date()
        const day1 = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000) // 5 days ago
        day1.setHours(7, 0, 0, 0)
        const day1Work = new Date(day1.getTime() + 2 * 60 * 60 * 1000) // 2 hours later (9am)

        vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([
          { external_id: 't1', source: 'manual' as const, start_time: day1, activity_type: 'meditation' },
        ])
        vi.mocked(db.getProductivity).mockResolvedValue([
          {
            activity: 'vscode',
            category: 'Software Development',
            duration_sec: 7200, // 2 hours
            end_time: new Date(day1Work.getTime() + 7200000),
            productivity: 2,
            start_time: day1Work,
          },
        ])
        vi.mocked(db.getTimeSeries).mockResolvedValue([])

        const result = await getGenericCorrelation(
          'testuser',
          [{ pattern: 'meditation', type: 'tag' }],
          { category: 'Software Development', type: 'productivity' },
          ['12h', '24h'],
          30,
        )

        expect(result.outcome.type).toBe('productivity')
        if (result.outcome.type === 'productivity') {
          expect(result.outcome.category).toBe('Software Development')
        }
        expect(result.post_trigger['12h']).toBeDefined()
        const lag12h = result.post_trigger['12h'] as { total_minutes: number }
        expect(lag12h.total_minutes).toBeGreaterThan(0)
      })
    })

    describe('metric baseline comparison', () => {
      test('calculates delta from baseline for metric outcomes', async () => {
        // Use relative dates
        const now = new Date()

        // Week with exercise -> weight measured
        const exerciseDay = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000) // 15 days ago
        exerciseDay.setHours(10, 0, 0, 0)
        const postExerciseWeight = new Date(exerciseDay.getTime() + 4 * 24 * 60 * 60 * 1000)
        postExerciseWeight.setHours(8, 0, 0, 0)

        // Week without exercise -> weight measured (baseline)
        const baselineWeight = new Date(exerciseDay.getTime() + 11 * 24 * 60 * 60 * 1000)
        baselineWeight.setHours(8, 0, 0, 0)

        vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([
          {
            activity_type: 'exercise' as const,
            end_time: new Date(exerciseDay.getTime() + 3600000),
            id: 'e1',
            source: 'health_connect' as const,
            start_time: exerciseDay,
          },
        ])
        vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([])
        vi.mocked(db.getProductivity).mockResolvedValue([])
        vi.mocked(db.getTimeSeries).mockResolvedValue([
          [postExerciseWeight, 79.0], // After exercise
          [baselineWeight, 80.5], // Baseline (no exercise that week)
        ] as [Date, number][])

        const result = await getGenericCorrelation(
          'testuser',
          [{ pattern: 'exercise', type: 'activity' }],
          { metric: 'weight', type: 'metric' },
          ['7d'],
          30,
        )

        const lag7d = result.post_trigger['7d'] as { mean: number | null; delta_from_baseline: number | null }
        const baseline = result.baseline as { mean: number | null }
        expect(lag7d.mean).toBeDefined()
        expect(baseline.mean).toBeDefined()
        expect(lag7d.delta_from_baseline).toBeDefined()
      })
    })
  })
})
