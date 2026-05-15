import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { Meal, MealFoodItemLink } from '../../db/index.ts'

import * as db from '../../db/index.ts'
import { getMealPeriodSummary } from './meal-period-summary.ts'

vi.mock('../../db', () => ({
  getMeals: vi.fn(),
  getMealFoodItemsBatch: vi.fn(),
  getMealLogCompletedInRange: vi.fn(),
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
    vi.mocked(db.getMealLogCompletedInRange).mockResolvedValue([])
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
    expect(result.days_with_meals).toBe(2)
    expect(result.nutrients.calories.days_with_value).toBe(2)
    expect(result.nutrients.calories.avg).toBe(700) // (600 + 800) / 2
    expect(result.nutrients.calories.total).toBe(1400)
    expect(result.nutrients.protein.avg).toBe(40)
    expect(result.calories_burned).toBeNull()
  })

  test('intermittent nutrients average over days_with_meals, not days_with_value', async () => {
    // Three meals across three days. Fiber present on only 1 of the 3 days.
    // Old (buggy) semantics: fiber.avg = 30 / 1 = 30.
    // New semantics: fiber.avg = 30 / 3 = 10. days_with_value still reports 1.
    vi.mocked(db.getMeals).mockResolvedValue([
      mealAt('m1', '2025-02-01T12:00:00Z'),
      mealAt('m2', '2025-02-02T12:00:00Z'),
      mealAt('m3', '2025-02-03T12:00:00Z'),
    ])
    vi.mocked(db.getMealFoodItemsBatch).mockResolvedValue(
      new Map<string, MealFoodItemLink[]>([
        ['m1', [link('m1', { calories: 500, fiber: 30 })]],
        ['m2', [link('m2', { calories: 500 })]],
        ['m3', [link('m3', { calories: 500 })]],
      ]),
    )

    const result = await getMealPeriodSummary('user', { start: '2025-02-01', end: '2025-02-03' })

    expect(result.days_with_meals).toBe(3)
    expect(result.nutrients.fiber).toEqual({ avg: 10, total: 30, days_with_value: 1 })
    expect(result.nutrients.calories).toEqual({ avg: 500, total: 1500, days_with_value: 3 })
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
    expect(result.days_with_meals).toBe(1)
    expect(result.nutrients.calories.days_with_value).toBe(1)
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

  test('reports days_completed regardless of count_only_completed', async () => {
    vi.mocked(db.getMeals).mockResolvedValue([
      mealAt('m1', '2025-03-01T12:00:00Z'),
      mealAt('m2', '2025-03-02T12:00:00Z'),
      mealAt('m3', '2025-03-03T12:00:00Z'),
    ])
    vi.mocked(db.getMealFoodItemsBatch).mockResolvedValue(
      new Map<string, MealFoodItemLink[]>([
        ['m1', [link('m1', { calories: 600 })]],
        ['m2', [link('m2', { calories: 900 })]],
        ['m3', [link('m3', { calories: 1200 })]],
      ]),
    )
    vi.mocked(db.getMealLogCompletedInRange).mockResolvedValue(['2025-03-01', '2025-03-03'])

    const noFilter = await getMealPeriodSummary('user', { start: '2025-03-01', end: '2025-03-03' })
    expect(noFilter.days_completed).toBe(2)
    expect(noFilter.days_with_meals).toBe(3)
    expect(noFilter.nutrients.calories.avg).toBe(900) // (600+900+1200)/3
  })

  test('count_only_completed=true averages only over completed days', async () => {
    vi.mocked(db.getMeals).mockResolvedValue([
      mealAt('m1', '2025-03-01T12:00:00Z'),
      mealAt('m2', '2025-03-02T12:00:00Z'),
      mealAt('m3', '2025-03-03T12:00:00Z'),
    ])
    vi.mocked(db.getMealFoodItemsBatch).mockResolvedValue(
      new Map<string, MealFoodItemLink[]>([
        ['m1', [link('m1', { calories: 600 })]],
        ['m2', [link('m2', { calories: 900 })]],
        ['m3', [link('m3', { calories: 1200 })]],
      ]),
    )
    // Only the 1st and 3rd are marked complete.
    vi.mocked(db.getMealLogCompletedInRange).mockResolvedValue(['2025-03-01', '2025-03-03'])

    const result = await getMealPeriodSummary('user', {
      start: '2025-03-01',
      end: '2025-03-03',
      count_only_completed: true,
    })
    expect(result.days_completed).toBe(2)
    expect(result.days_with_meals).toBe(2) // March 2 dropped
    expect(result.nutrients.calories.avg).toBe(900) // (600+1200)/2
    expect(result.nutrients.calories.total).toBe(1800)
  })

  test('count_only_completed=true with no completed days yields empty nutrients', async () => {
    vi.mocked(db.getMeals).mockResolvedValue([
      mealAt('m1', '2025-03-01T12:00:00Z'),
      mealAt('m2', '2025-03-02T12:00:00Z'),
    ])
    vi.mocked(db.getMealFoodItemsBatch).mockResolvedValue(
      new Map<string, MealFoodItemLink[]>([
        ['m1', [link('m1', { calories: 600 })]],
        ['m2', [link('m2', { calories: 900 })]],
      ]),
    )
    vi.mocked(db.getMealLogCompletedInRange).mockResolvedValue([])

    const result = await getMealPeriodSummary('user', {
      start: '2025-03-01',
      end: '2025-03-02',
      count_only_completed: true,
    })
    expect(result.days_completed).toBe(0)
    expect(result.days_with_meals).toBe(0)
    expect(result.nutrients).toEqual({})
  })

  test('vitamin_a derivation is per-row: explicit row keeps its value, precursor-only row contributes derived', async () => {
    // Row 1 has explicit vitamin_a=100 AND retinol=500 — the explicit value
    // already represents that food's RAE, so retinol must NOT be re-added.
    // Row 2 has only retinol=300 → contributes 300 µg RAE.
    // Expected vitamin_a total: 100 + 300 = 400 (NOT 100 + 500 + 300 = 900).
    vi.mocked(db.getMeals).mockResolvedValue([mealAt('m1', '2025-04-20T12:00:00Z')])
    vi.mocked(db.getMealFoodItemsBatch).mockResolvedValue(
      new Map<string, MealFoodItemLink[]>([
        [
          'm1',
          [
            link('m1', { calories: 100, retinol: 500, vitamin_a: 100 }),
            link('m1', { calories: 100, retinol: 300 }),
          ],
        ],
      ]),
    )

    const result = await getMealPeriodSummary('user', { start: '2025-04-20', end: '2025-04-20' })

    expect(result.nutrients.vitamin_a.total).toBe(400)
    expect(result.nutrients.retinol.total).toBe(800)
  })

  test('derives vitamin_a, niacin_equivalents and salt from precursors across a period', async () => {
    // One day, two food items: an LSV-style row carrying only precursors
    // (vitamin_a/niacin_equivalents/sodium null) and an explicit row.
    vi.mocked(db.getMeals).mockResolvedValue([mealAt('m1', '2025-04-10T12:00:00Z')])
    vi.mocked(db.getMealFoodItemsBatch).mockResolvedValue(
      new Map<string, MealFoodItemLink[]>([
        [
          'm1',
          [
            link('m1', {
              calories: 200,
              b3_niacin: 4,
              beta_carotene: 6720,
              retinol: 580,
              salt: 5,
              tryptophan: 0.3,
            }),
            link('m1', { calories: 100, vitamin_a: 50 }),
          ],
        ],
      ]),
    )

    const result = await getMealPeriodSummary('user', { start: '2025-04-10', end: '2025-04-10' })

    // 580 + 6720/12 = 1140 from precursors + 50 explicit = 1190 µg RAE
    expect(result.nutrients.vitamin_a.total).toBeCloseTo(1190)
    // 4 mg niacin + 0.3 g tryptophan × 1000 / 60 = 4 + 5 = 9 mg NE
    expect(result.nutrients.niacin_equivalents.total).toBeCloseTo(9)
    // 5 g salt → 2000 mg sodium
    expect(result.nutrients.sodium.total).toBeCloseTo(2000)
    expect(result.nutrients.salt.total).toBeCloseTo(5)
  })

  test('returns empty nutrients map when there are no meals', async () => {
    vi.mocked(db.getMeals).mockResolvedValue([])
    vi.mocked(db.getMealFoodItemsBatch).mockResolvedValue(new Map())

    const result = await getMealPeriodSummary('user', { start: '2025-01-01', end: '2025-01-07' })

    expect(result.days_in_range).toBe(7)
    expect(result.days_with_meals).toBe(0)
    expect(result.nutrients).toEqual({})
    expect(result.calories_burned).toBeNull()
  })
})
