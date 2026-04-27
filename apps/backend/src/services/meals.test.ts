import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { MealFoodItemLink } from '../db/types.ts'

import * as db from '../db/index.ts'
import {
  addMeal,
  buildScaledJunctionItem,
  deleteMealById,
  getMeal,
  hasIncompleteNutrients,
  queryMeals,
  updateMealById,
} from './meals.ts'

// Mock the db module
vi.mock('../db', () => ({
  deleteMeal: vi.fn(),
  findOrCreateFoodItem: vi.fn().mockResolvedValue({ id: 'fi-1', name: 'test' }),
  getFoodItemById: vi.fn().mockResolvedValue(null),
  getMealById: vi.fn(),
  getMealFoodItems: vi.fn().mockResolvedValue([]),
  getMealFoodItemsBatch: vi.fn().mockResolvedValue(new Map()),
  getMeals: vi.fn(),
  setMealFoodItems: vi.fn().mockResolvedValue(undefined),
  updateMeal: vi.fn(),
  upsertMeal: vi.fn(),
}))

const mockUpsertMeal = vi.mocked(db.upsertMeal)
const mockGetMealById = vi.mocked(db.getMealById)
const mockGetMeals = vi.mocked(db.getMeals)
const mockDeleteMeal = vi.mocked(db.deleteMeal)
const mockUpdateMeal = vi.mocked(db.updateMeal)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('addMeal', () => {
  test('creates a meal and returns formatted response', async () => {
    const mockMeal = {
      calories: 650,
      carbs: 80,
      created_at: new Date('2025-06-15T10:00:00Z'),
      fat: 25,
      fiber: 8,
      food_items: [
        { calories: 200, carbs: 40, name: 'Rye bread', protein: 6 },
        { calories: 180, fat: 16, name: 'Peanut butter', protein: 7 },
      ],
      id: 'meal-1',
      meal_type: 'breakfast',
      micros: { iron: 3.2 },
      name: 'Rye bread with PB',
      notes: 'Good breakfast',
      protein: 35,
      source: 'manual',
      time: new Date('2025-06-15T08:00:00Z'),
    }

    mockUpsertMeal.mockResolvedValue(mockMeal)

    const result = await addMeal('testuser', {
      calories: 650,
      carbs: 80,
      fat: 25,
      fiber: 8,
      food_items: [
        { name: 'Rye bread', quantity: 100, unit: 'g' },
        { name: 'Peanut butter', quantity: 30, unit: 'g' },
      ],
      meal_type: 'breakfast',
      micros: { iron: 3.2 },
      name: 'Rye bread with PB',
      notes: 'Good breakfast',
      protein: 35,
      time: '2025-06-15T08:00:00Z',
    })

    expect(result.success).toBe(true)
    expect(result.data).toBeDefined()
    expect(result.data!.id).toBe('meal-1')
    expect(result.data!.meal_type).toBe('breakfast')
    expect(result.data!.time).toBe('2025-06-15T08:00:00.000Z')
    expect(result.data!.food_items).toHaveLength(2)
    expect(result.data!.micros).toEqual({ iron: 3.2 })
  })

  test('creates a meal with sensitivities', async () => {
    mockUpsertMeal.mockResolvedValue({
      created_at: new Date('2025-06-15T10:00:00Z'),
      id: 'meal-3',
      meal_type: 'dinner',
      sensitivities: ['gluten', 'dairy'],
      source: 'manual',
      time: new Date('2025-06-15T18:00:00Z'),
    })

    const result = await addMeal('testuser', {
      meal_type: 'dinner',
      sensitivities: ['gluten', 'dairy'],
      time: '2025-06-15T18:00:00Z',
    })

    expect(result.success).toBe(true)
    expect(result.data!.sensitivities).toEqual(['gluten', 'dairy'])
    expect(mockUpsertMeal).toHaveBeenCalledWith(
      'testuser',
      expect.objectContaining({ sensitivities: ['gluten', 'dairy'] }),
    )
  })

  test('creates a meal with minimal fields', async () => {
    mockUpsertMeal.mockResolvedValue({
      created_at: new Date('2025-06-15T10:00:00Z'),
      id: 'meal-2',
      source: 'manual',
      time: new Date('2025-06-15T12:00:00Z'),
    })

    const result = await addMeal('testuser', {
      time: '2025-06-15T12:00:00Z',
    })

    expect(result.success).toBe(true)
    expect(result.data!.id).toBe('meal-2')
    expect(result.data!.source).toBe('manual')
  })
})

describe('getMeal', () => {
  test('returns formatted meal when found', async () => {
    mockGetMealById.mockResolvedValue({
      calories: 500,
      created_at: new Date('2025-06-15T10:00:00Z'),
      id: 'meal-1',
      meal_type: 'lunch',
      name: 'Salad',
      source: 'manual',
      time: new Date('2025-06-15T12:00:00Z'),
    })

    const result = await getMeal('testuser', 'meal-1')

    expect(result.success).toBe(true)
    expect(result.data!.time).toBe('2025-06-15T12:00:00.000Z')
    expect(result.data!.meal_type).toBe('lunch')
  })

  test('returns error when not found', async () => {
    mockGetMealById.mockResolvedValue(null)

    const result = await getMeal('testuser', 'nonexistent')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Meal not found')
  })
})

describe('queryMeals', () => {
  test('returns formatted meals', async () => {
    mockGetMeals.mockResolvedValue([
      {
        created_at: new Date('2025-06-15T10:00:00Z'),
        id: 'meal-1',
        meal_type: 'breakfast',
        source: 'manual',
        time: new Date('2025-06-15T08:00:00Z'),
      },
    ])

    const result = await queryMeals('testuser', { meal_type: 'breakfast' })

    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(1)
    expect(result.data![0].meal_type).toBe('breakfast')
  })

  test('passes date filters to db', async () => {
    mockGetMeals.mockResolvedValue([])

    await queryMeals('testuser', {
      end: '2025-06-15T23:59:59Z',
      start: '2025-06-15T00:00:00Z',
    })

    expect(mockGetMeals).toHaveBeenCalledWith('testuser', {
      end: new Date('2025-06-15T23:59:59Z'),
      meal_type: undefined,
      start: new Date('2025-06-15T00:00:00Z'),
    })
  })
})

describe('deleteMealById', () => {
  test('deletes meal successfully', async () => {
    mockDeleteMeal.mockResolvedValue(true)

    const result = await deleteMealById('testuser', 'meal-1')

    expect(result.success).toBe(true)
    expect(mockDeleteMeal).toHaveBeenCalledWith('testuser', 'meal-1')
  })

  test('returns error when meal not found', async () => {
    mockDeleteMeal.mockResolvedValue(false)

    const result = await deleteMealById('testuser', 'nonexistent')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Meal not found')
  })
})

describe('updateMealById', () => {
  test('updates meal sensitivities', async () => {
    mockUpdateMeal.mockResolvedValue({
      created_at: new Date('2025-06-15T10:00:00Z'),
      id: 'meal-1',
      meal_type: 'dinner',
      sensitivities: ['gluten', 'dairy'],
      source: 'manual',
      time: new Date('2025-06-15T18:00:00Z'),
    })

    const result = await updateMealById('testuser', 'meal-1', {
      sensitivities: ['gluten', 'dairy'],
    })

    expect(result.success).toBe(true)
    expect(result.data!.sensitivities).toEqual(['gluten', 'dairy'])
    expect(mockUpdateMeal).toHaveBeenCalledWith(
      'testuser',
      'meal-1',
      expect.objectContaining({ sensitivities: ['gluten', 'dairy'] }),
    )
  })

  test('returns error when meal not found', async () => {
    mockUpdateMeal.mockResolvedValue(null)

    const result = await updateMealById('testuser', 'nonexistent', { sensitivities: [] })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Meal not found')
  })
})

// ── buildScaledJunctionItem ───────────────────────────────────────────────

const canonicalFoodItem = (overrides: Record<string, unknown> = {}) =>
  ({
    calories: 200,
    carbs: 40,
    created_at: new Date('2025-01-01T00:00:00Z'),
    default_quantity: 100,
    default_unit: 'g',
    fat: 2,
    fiber: 5,
    id: 'canonical-1',
    name: 'Rye bread',
    name_lower: 'rye bread',
    protein: 8,
    source: 'manual',
    updated_at: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  }) as unknown as Parameters<typeof buildScaledJunctionItem>[1]

describe('buildScaledJunctionItem', () => {
  test('scales nutrients linearly when quantity differs from default', () => {
    const canonical = canonicalFoodItem()
    const item = buildScaledJunctionItem({ name: 'Rye bread', quantity: 500, unit: 'g' }, canonical, 0)
    expect(item.calories).toBe(1000)
    expect(item.protein).toBe(40)
    expect(item.carbs).toBe(200)
    expect(item.fat).toBe(10)
    expect(item.fiber).toBe(25)
    expect(item.food_item_id).toBe('canonical-1')
    expect(item.quantity).toBe(500)
    expect(item.sort_order).toBe(0)
  })

  test('scales down for smaller quantities', () => {
    const item = buildScaledJunctionItem(
      { name: 'Rye bread', quantity: 50, unit: 'g' },
      canonicalFoodItem(),
      1,
    )
    expect(item.calories).toBe(100)
    expect(item.protein).toBe(4)
  })

  test('uses raw canonical values when quantity is missing', () => {
    const item = buildScaledJunctionItem({ name: 'Rye bread' }, canonicalFoodItem(), 0)
    expect(item.calories).toBe(200)
  })

  test('uses raw canonical values when default_quantity is missing', () => {
    const item = buildScaledJunctionItem(
      { name: 'Rye bread', quantity: 500 },
      canonicalFoodItem({ default_quantity: undefined }),
      0,
    )
    expect(item.calories).toBe(200)
  })

  test('falls back to scale=1 when units differ', () => {
    const item = buildScaledJunctionItem(
      { name: 'Rye bread', quantity: 2, unit: 'slice' },
      canonicalFoodItem(),
      0,
    )
    expect(item.calories).toBe(200)
  })

  test('rounds to two decimal places', () => {
    const item = buildScaledJunctionItem(
      { name: 'Rye bread', quantity: 33, unit: 'g' },
      canonicalFoodItem(),
      0,
    )
    expect(item.calories).toBe(66)
    expect(item.protein).toBe(2.64)
  })
})

// ── hasIncompleteNutrients ─────────────────────────────────────────────────

const makeLink = (overrides: Partial<MealFoodItemLink> = {}): MealFoodItemLink =>
  ({
    id: 'link-1',
    meal_id: 'meal-1',
    food_item_id: 'fi-1',
    food_item_name: 'Test food',
    sort_order: 0,
    calories: 200,
    protein: 10,
    carbs: 25,
    fat: 8,
    ...overrides,
  }) as unknown as MealFoodItemLink

describe('hasIncompleteNutrients', () => {
  test('returns false when all items have calories', () => {
    const links = [makeLink({ calories: 200 }), makeLink({ id: 'link-2', calories: 150 })]
    expect(hasIncompleteNutrients(links)).toBe(false)
  })

  test('returns true when an item has undefined calories', () => {
    const links = [makeLink({ calories: 200 }), makeLink({ id: 'link-2', calories: undefined })]
    expect(hasIncompleteNutrients(links)).toBe(true)
  })

  test('returns false for empty array', () => {
    expect(hasIncompleteNutrients([])).toBe(false)
  })

  test('returns false when calories is zero', () => {
    const links = [makeLink({ calories: 0 })]
    expect(hasIncompleteNutrients(links)).toBe(false)
  })
})

// ── nutrient_data_incomplete in getMeal ─────────────────────────────────────

const mockGetMealFoodItemsBatch = vi.mocked(db.getMealFoodItemsBatch)

describe('getMeal nutrient_data_incomplete', () => {
  test('sets nutrient_data_incomplete when a food item lacks calories', async () => {
    mockGetMealById.mockResolvedValue({
      created_at: new Date('2025-06-15T10:00:00Z'),
      id: 'meal-1',
      meal_type: 'lunch',
      source: 'manual',
      time: new Date('2025-06-15T12:00:00Z'),
    })
    mockGetMealFoodItemsBatch.mockResolvedValue(
      new Map([
        [
          'meal-1',
          [
            makeLink({ calories: 200, food_item_name: 'Apple' }),
            makeLink({ id: 'link-2', calories: undefined, food_item_name: 'Mystery item' }),
          ],
        ],
      ]),
    )

    const result = await getMeal('testuser', 'meal-1')

    expect(result.success).toBe(true)
    expect(result.data!.nutrient_data_incomplete).toBe(true)
  })

  test('does not set nutrient_data_incomplete when all items have calories', async () => {
    mockGetMealById.mockResolvedValue({
      created_at: new Date('2025-06-15T10:00:00Z'),
      id: 'meal-1',
      meal_type: 'lunch',
      source: 'manual',
      time: new Date('2025-06-15T12:00:00Z'),
    })
    mockGetMealFoodItemsBatch.mockResolvedValue(
      new Map([
        [
          'meal-1',
          [makeLink({ calories: 200, food_item_name: 'Apple' }), makeLink({ id: 'link-2', calories: 150 })],
        ],
      ]),
    )

    const result = await getMeal('testuser', 'meal-1')

    expect(result.success).toBe(true)
    expect(result.data!.nutrient_data_incomplete).toBeUndefined()
  })

  test('does not set nutrient_data_incomplete when meal has no food items', async () => {
    mockGetMealById.mockResolvedValue({
      created_at: new Date('2025-06-15T10:00:00Z'),
      id: 'meal-1',
      meal_type: 'lunch',
      source: 'manual',
      time: new Date('2025-06-15T12:00:00Z'),
    })
    mockGetMealFoodItemsBatch.mockResolvedValue(new Map())

    const result = await getMeal('testuser', 'meal-1')

    expect(result.success).toBe(true)
    expect(result.data!.nutrient_data_incomplete).toBeUndefined()
  })
})
