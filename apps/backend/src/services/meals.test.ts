import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../db/index.ts'
import { addMeal, deleteMealById, getMeal, queryMeals, updateMealById } from './meals.ts'

// Mock the db module
vi.mock('../db', () => ({
  deleteMeal: vi.fn(),
  getMealById: vi.fn(),
  getMeals: vi.fn(),
  insertMeal: vi.fn(),
  updateMeal: vi.fn(),
}))

const mockInsertMeal = vi.mocked(db.insertMeal)
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

    mockInsertMeal.mockResolvedValue(mockMeal)

    const result = await addMeal('testuser', {
      calories: 650,
      carbs: 80,
      fat: 25,
      fiber: 8,
      food_items: [
        { calories: 200, carbs: 40, name: 'Rye bread', protein: 6 },
        { calories: 180, fat: 16, name: 'Peanut butter', protein: 7 },
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
    mockInsertMeal.mockResolvedValue({
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
    expect(mockInsertMeal).toHaveBeenCalledWith(
      'testuser',
      expect.objectContaining({ sensitivities: ['gluten', 'dairy'] }),
    )
  })

  test('creates a meal with minimal fields', async () => {
    mockInsertMeal.mockResolvedValue({
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
