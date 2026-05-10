import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { Meal, MealFoodItemLink } from '../../db/index.ts'

import * as db from '../../db/index.ts'
import { getMealPeriodSummary } from './meal-period-summary.ts'

vi.mock('../../db', () => ({
  getMeals: vi.fn(),
  getMealFoodItemsBatch: vi.fn(),
  getTimeSeriesBucketed: vi.fn(),
}))

const mealAt = (id: string, isoTime: string): Meal =>
  ({
    id,
    source: 'manual',
    meal_type: 'lunch',
    time: new Date(isoTime),
    created_at: new Date(isoTime),
  }) as unknown as Meal

const link = (mealId: string, fields: Partial<MealFoodItemLink>): MealFoodItemLink =>
  ({
    meal_id: mealId,
    food_item_id: 'f1',
    sort_order: 0,
    ...fields,
  }) as unknown as MealFoodItemLink

describe('getMealPeriodSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getTimeSeriesBucketed).mockResolvedValue([])
  })

  test('averages over days that have data, not the full range', async () => {
    // 3-day window; only 2 days have meals.
    vi.mocked(db.getMeals).mockResolvedValue([
      mealAt('m1', '2025-01-10T12:00:00Z'),
      mealAt('m2', '2025-01-12T12:00:00Z'),
    ])

    vi.mocked(db.getMealFoodItemsBatch).mockResolvedValue(
      new Map<string, MealFoodItemLink[]>([
        ['m1', [link('m1', { calories: 600, protein: 30 })]],
        ['m2', [link('m2', { calories: 800, protein: 50 })]],
      ]),
    )

    const result = await getMealPeriodSummary('user', { start: '2025-01-10', end: '2025-01-12' })

    expect(result.start).toBe('2025-01-10')
    expect(result.end).toBe('2025-01-12')
    expect(result.days_in_range).toBe(3)
    expect(result.nutrients.calories.days_with_data).toBe(2)
    expect(result.nutrients.calories.avg).toBe(700) // (600 + 800) / 2
    expect(result.nutrients.calories.total).toBe(1400)
    expect(result.nutrients.protein.avg).toBe(40)
    expect(result.calories_burned).toBeNull()
  })

  test('sums multiple meals on the same day before averaging', async () => {
    vi.mocked(db.getMeals).mockResolvedValue([
      mealAt('m1', '2025-01-10T08:00:00Z'),
      mealAt('m2', '2025-01-10T18:00:00Z'),
    ])

    vi.mocked(db.getMealFoodItemsBatch).mockResolvedValue(
      new Map<string, MealFoodItemLink[]>([
        ['m1', [link('m1', { calories: 400 })]],
        ['m2', [link('m2', { calories: 700 })]],
      ]),
    )

    const result = await getMealPeriodSummary('user', { start: '2025-01-10', end: '2025-01-10' })

    expect(result.days_in_range).toBe(1)
    expect(result.nutrients.calories.days_with_data).toBe(1)
    expect(result.nutrients.calories.avg).toBe(1100)
    expect(result.nutrients.calories.total).toBe(1100)
  })

  test('averages calories_burned only over days with a positive sum', async () => {
    vi.mocked(db.getMeals).mockResolvedValue([])
    vi.mocked(db.getMealFoodItemsBatch).mockResolvedValue(new Map())
    vi.mocked(db.getTimeSeriesBucketed).mockResolvedValue([
      {
        avg: 0,
        bucket_start: new Date('2025-01-10T00:00:00Z'),
        count: 1,
        max: 2400,
        metric: 'calories_total',
        min: 2400,
        sum: 2400,
      },
      {
        avg: 0,
        bucket_start: new Date('2025-01-11T00:00:00Z'),
        count: 0,
        max: 0,
        metric: 'calories_total',
        min: 0,
        sum: 0,
      },
      {
        avg: 0,
        bucket_start: new Date('2025-01-12T00:00:00Z'),
        count: 1,
        max: 2600,
        metric: 'calories_total',
        min: 2600,
        sum: 2600,
      },
    ])

    const result = await getMealPeriodSummary('user', { start: '2025-01-10', end: '2025-01-12' })

    expect(result.calories_burned).toEqual({ avg: 2500, days_with_data: 2 })
  })

  test('returns empty nutrients map when there are no meals', async () => {
    vi.mocked(db.getMeals).mockResolvedValue([])
    vi.mocked(db.getMealFoodItemsBatch).mockResolvedValue(new Map())

    const result = await getMealPeriodSummary('user', { start: '2025-01-01', end: '2025-01-07' })

    expect(result.days_in_range).toBe(7)
    expect(result.nutrients).toEqual({})
    expect(result.calories_burned).toBeNull()
  })
})
