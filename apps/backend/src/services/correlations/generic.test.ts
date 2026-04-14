import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../../db/index.ts'
import { getGenericCorrelation } from './generic.ts'

// Mock db module
vi.mock('../../db', () => ({
  getAllActivitiesInRange: vi.fn(),
  getProductivity: vi.fn(),
  getTimeSeries: vi.fn(),
}))

describe('getGenericCorrelation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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
