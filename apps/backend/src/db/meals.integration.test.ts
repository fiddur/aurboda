import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { deleteMeal, getFrequentMeals, getMealById, getMeals, insertMeal, updateMeal } from './meals.ts'

const CONTAINER_TIMEOUT = 60_000

describe('Meals Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('insertMeal', () => {
    test('creates a meal with all fields and returns generated ID', async () => {
      const user = getTestUser()

      const meal = await insertMeal(user, {
        calories: 650,
        carbs: 80,
        fat: 25,
        fiber: 8,
        food_items: [
          { calories: 200, carbs: 40, name: 'Rye bread', protein: 6, unit: 'slice' },
          { calories: 180, fat: 16, name: 'Peanut butter', protein: 7, quantity: 2, unit: 'tbsp' },
          { calories: 105, carbs: 27, name: 'Banana', protein: 1.3 },
        ],
        meal_type: 'breakfast',
        micros: { iron: 3.2, vitamin_c: 10 },
        name: 'Rye bread with peanut butter and banana',
        notes: 'Quick morning breakfast',
        protein: 35,
        source: 'manual',
        time: new Date('2025-06-15T08:00:00Z'),
      })

      expect(meal.id).toBeDefined()
      expect(meal.source).toBe('manual')
      expect(meal.meal_type).toBe('breakfast')
      expect(meal.name).toBe('Rye bread with peanut butter and banana')
      expect(meal.time).toEqual(new Date('2025-06-15T08:00:00Z'))
      expect(meal.calories).toBe(650)
      expect(meal.protein).toBe(35)
      expect(meal.carbs).toBe(80)
      expect(meal.fat).toBe(25)
      expect(meal.fiber).toBe(8)
      expect(meal.food_items).toHaveLength(3)
      expect(meal.food_items![0].name).toBe('Rye bread')
      expect(meal.micros).toEqual({ iron: 3.2, vitamin_c: 10 })
      expect(meal.notes).toBe('Quick morning breakfast')
      expect(meal.created_at).toBeInstanceOf(Date)
    })

    test('creates a meal with minimal fields', async () => {
      const user = getTestUser()

      const meal = await insertMeal(user, {
        time: new Date('2025-06-15T12:00:00Z'),
      })

      expect(meal.id).toBeDefined()
      expect(meal.source).toBe('manual')
      expect(meal.meal_type).toBeUndefined()
      expect(meal.name).toBeUndefined()
      expect(meal.calories).toBeUndefined()
      expect(meal.food_items).toBeUndefined()
      expect(meal.micros).toBeUndefined()
      expect(meal.notes).toBeUndefined()
    })

    test('creates a meal from Oura-style data (food items without macros)', async () => {
      const user = getTestUser()

      const meal = await insertMeal(user, {
        food_items: [{ name: 'Chicken breast' }, { name: 'Rice' }, { name: 'Broccoli' }],
        meal_type: 'lunch',
        name: 'Chicken rice bowl',
        source: 'oura',
        time: new Date('2025-06-15T12:30:00Z'),
      })

      expect(meal.source).toBe('oura')
      expect(meal.food_items).toHaveLength(3)
      expect(meal.food_items![0].name).toBe('Chicken breast')
      // No macro data
      expect(meal.calories).toBeUndefined()
      expect(meal.protein).toBeUndefined()
    })
  })

  describe('getMealById', () => {
    test('retrieves meal by ID', async () => {
      const user = getTestUser()

      const created = await insertMeal(user, {
        calories: 500,
        meal_type: 'lunch',
        name: 'Salad',
        time: new Date('2025-06-15T12:00:00Z'),
      })

      const found = await getMealById(user, created.id)

      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
      expect(found!.meal_type).toBe('lunch')
      expect(found!.calories).toBe(500)
    })

    test('returns null for non-existent meal', async () => {
      const user = getTestUser()
      const found = await getMealById(user, '00000000-0000-0000-0000-000000000000')
      expect(found).toBeNull()
    })
  })

  describe('getMeals', () => {
    test('returns all meals ordered by time descending', async () => {
      const user = getTestUser()

      await insertMeal(user, {
        meal_type: 'breakfast',
        time: new Date('2025-06-15T08:00:00Z'),
      })
      await insertMeal(user, {
        meal_type: 'lunch',
        time: new Date('2025-06-15T12:00:00Z'),
      })

      const meals = await getMeals(user, {})

      expect(meals).toHaveLength(2)
      expect(meals[0].time.getTime()).toBeGreaterThan(meals[1].time.getTime())
    })

    test('filters by meal_type', async () => {
      const user = getTestUser()

      await insertMeal(user, {
        meal_type: 'breakfast',
        time: new Date('2025-06-15T08:00:00Z'),
      })
      await insertMeal(user, {
        meal_type: 'snack',
        time: new Date('2025-06-15T15:00:00Z'),
      })

      const meals = await getMeals(user, { meal_type: 'breakfast' })

      expect(meals).toHaveLength(1)
      expect(meals[0].meal_type).toBe('breakfast')
    })

    test('filters by date range', async () => {
      const user = getTestUser()

      await insertMeal(user, {
        time: new Date('2025-06-14T08:00:00Z'),
      })
      await insertMeal(user, {
        time: new Date('2025-06-15T12:00:00Z'),
      })

      const meals = await getMeals(user, {
        end: new Date('2025-06-15T23:59:59Z'),
        start: new Date('2025-06-15T00:00:00Z'),
      })

      expect(meals).toHaveLength(1)
      expect(meals[0].time.getDate()).toBe(15)
    })

    test('returns empty array when no meals match', async () => {
      const user = getTestUser()
      const meals = await getMeals(user, { meal_type: 'nonexistent' })
      expect(meals).toEqual([])
    })
  })

  describe('deleteMeal', () => {
    test('deletes a meal', async () => {
      const user = getTestUser()

      const meal = await insertMeal(user, {
        meal_type: 'dinner',
        time: new Date('2025-06-15T19:00:00Z'),
      })

      const deleted = await deleteMeal(user, meal.id)
      expect(deleted).toBe(true)

      const found = await getMealById(user, meal.id)
      expect(found).toBeNull()
    })

    test('returns false for non-existent meal', async () => {
      const user = getTestUser()
      const deleted = await deleteMeal(user, '00000000-0000-0000-0000-000000000000')
      expect(deleted).toBe(false)
    })
  })

  describe('sensitivities', () => {
    test('round-trips sensitivities through TEXT[]', async () => {
      const user = getTestUser()

      const meal = await insertMeal(user, {
        meal_type: 'dinner',
        sensitivities: ['gluten', 'dairy', 'red_meat'],
        time: new Date('2025-06-15T18:00:00Z'),
      })

      expect(meal.sensitivities).toEqual(['gluten', 'dairy', 'red_meat'])

      const found = await getMealById(user, meal.id)
      expect(found!.sensitivities).toEqual(['gluten', 'dairy', 'red_meat'])
    })

    test('returns undefined when no sensitivities set', async () => {
      const user = getTestUser()

      const meal = await insertMeal(user, {
        time: new Date('2025-06-15T12:00:00Z'),
      })

      expect(meal.sensitivities).toBeUndefined()
    })
  })

  describe('updateMeal', () => {
    test('updates sensitivities on an existing meal', async () => {
      const user = getTestUser()

      const meal = await insertMeal(user, {
        meal_type: 'dinner',
        sensitivities: ['gluten'],
        time: new Date('2025-06-15T18:00:00Z'),
      })

      const updated = await updateMeal(user, meal.id, {
        sensitivities: ['gluten', 'dairy', 'red_meat'],
      })

      expect(updated).not.toBeNull()
      expect(updated!.sensitivities).toEqual(['gluten', 'dairy', 'red_meat'])
      expect(updated!.meal_type).toBe('dinner')
    })

    test('updates time without changing other fields', async () => {
      const user = getTestUser()

      const meal = await insertMeal(user, {
        meal_type: 'lunch',
        name: 'Salad',
        sensitivities: ['dairy'],
        time: new Date('2025-06-15T12:00:00Z'),
      })

      const updated = await updateMeal(user, meal.id, {
        time: new Date('2025-06-15T13:00:00Z'),
      })

      expect(updated!.time).toEqual(new Date('2025-06-15T13:00:00Z'))
      expect(updated!.name).toBe('Salad')
      expect(updated!.sensitivities).toEqual(['dairy'])
    })

    test('returns null for non-existent meal', async () => {
      const user = getTestUser()
      const result = await updateMeal(user, '00000000-0000-0000-0000-000000000000', {
        sensitivities: ['gluten'],
      })
      expect(result).toBeNull()
    })
  })

  describe('getFrequentMeals', () => {
    test('groups by name and orders by count then most recent', async () => {
      const user = getTestUser()
      const now = Date.now()
      const days = (n: number) => new Date(now - n * 86_400_000)

      // Bananmacka logged 3 times — most frequent
      await insertMeal(user, { meal_type: 'breakfast', name: 'Bananmacka', time: days(10) })
      await insertMeal(user, { meal_type: 'breakfast', name: 'Bananmacka', time: days(5) })
      await insertMeal(user, { meal_type: 'breakfast', name: 'Bananmacka', time: days(1) })
      // Oats twice — second most frequent
      await insertMeal(user, { meal_type: 'breakfast', name: 'Oats', time: days(7) })
      await insertMeal(user, { meal_type: 'breakfast', name: 'Oats', time: days(3) })
      // Yogurt once — least frequent
      await insertMeal(user, { meal_type: 'breakfast', name: 'Yogurt', time: days(2) })

      const rows = await getFrequentMeals(user, { meal_type: 'breakfast', limit: 6, since_days: 90 })

      expect(rows.map((r) => r.name)).toEqual(['Bananmacka', 'Oats', 'Yogurt'])
      expect(rows[0].count).toBe(3)
      expect(rows[1].count).toBe(2)
      expect(rows[2].count).toBe(1)
      // last_time is the most recent occurrence per name
      expect(rows[0].last_time.getTime()).toBeCloseTo(days(1).getTime(), -3)
    })

    test('scopes to meal_type — frequent breakfasts do not appear under lunch', async () => {
      const user = getTestUser()
      const now = Date.now()
      const days = (n: number) => new Date(now - n * 86_400_000)

      await insertMeal(user, { meal_type: 'breakfast', name: 'Bananmacka', time: days(2) })
      await insertMeal(user, { meal_type: 'breakfast', name: 'Bananmacka', time: days(1) })
      await insertMeal(user, { meal_type: 'lunch', name: 'Soup', time: days(1) })

      const breakfast = await getFrequentMeals(user, { meal_type: 'breakfast', limit: 6, since_days: 30 })
      const lunch = await getFrequentMeals(user, { meal_type: 'lunch', limit: 6, since_days: 30 })

      expect(breakfast.map((r) => r.name)).toEqual(['Bananmacka'])
      expect(lunch.map((r) => r.name)).toEqual(['Soup'])
    })

    test('respects since_days window', async () => {
      const user = getTestUser()
      const now = Date.now()
      const days = (n: number) => new Date(now - n * 86_400_000)

      await insertMeal(user, { meal_type: 'breakfast', name: 'Old', time: days(120) })
      await insertMeal(user, { meal_type: 'breakfast', name: 'Recent', time: days(2) })

      const rows = await getFrequentMeals(user, { meal_type: 'breakfast', limit: 6, since_days: 90 })

      expect(rows.map((r) => r.name)).toEqual(['Recent'])
    })

    test('excludes meals with empty or null name', async () => {
      const user = getTestUser()
      const now = Date.now()
      const days = (n: number) => new Date(now - n * 86_400_000)

      await insertMeal(user, { meal_type: 'breakfast', time: days(2) })
      await insertMeal(user, { meal_type: 'breakfast', name: '', time: days(1) })
      await insertMeal(user, { meal_type: 'breakfast', name: 'Real', time: days(1) })

      const rows = await getFrequentMeals(user, { meal_type: 'breakfast', limit: 6, since_days: 30 })
      expect(rows.map((r) => r.name)).toEqual(['Real'])
    })

    test('honors limit', async () => {
      const user = getTestUser()
      const now = Date.now()
      const days = (n: number) => new Date(now - n * 86_400_000)

      for (let i = 0; i < 5; i++) {
        await insertMeal(user, { meal_type: 'breakfast', name: `Meal ${i}`, time: days(i + 1) })
      }

      const rows = await getFrequentMeals(user, { meal_type: 'breakfast', limit: 2, since_days: 30 })
      expect(rows).toHaveLength(2)
    })
  })

  describe('JSONB storage', () => {
    test('round-trips food_items through JSONB', async () => {
      const user = getTestUser()

      const foodItems = [
        { calories: 200, carbs: 40, name: 'Rice', protein: 4, quantity: 1, unit: 'cup' },
        { calories: 150, fat: 3, fiber: 2, name: 'Grilled chicken', protein: 30, quantity: 150, unit: 'g' },
      ]

      const meal = await insertMeal(user, {
        food_items: foodItems,
        time: new Date('2025-06-15T12:00:00Z'),
      })

      const found = await getMealById(user, meal.id)
      expect(found!.food_items).toEqual(foodItems)
    })

    test('round-trips micros through JSONB', async () => {
      const user = getTestUser()

      const micros = {
        calcium: 200,
        iron: 8,
        vitamin_a: 500,
        vitamin_c: 45,
        zinc: 11,
      }

      const meal = await insertMeal(user, {
        micros,
        time: new Date('2025-06-15T12:00:00Z'),
      })

      const found = await getMealById(user, meal.id)
      expect(found!.micros).toEqual(micros)
    })
  })
})
