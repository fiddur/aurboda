import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { setMealFoodItems } from './meal-food-items.ts'
import {
  deleteMeal,
  getFrequentFoodItems,
  getFrequentMeals,
  getMealById,
  getMeals,
  insertMeal,
  updateMeal,
} from './meals.ts'

const CONTAINER_TIMEOUT = 120_000

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

  describe('getFrequentFoodItems', () => {
    test('aggregates by food_item_id, ranks by usage, exposes the most recent quantity/unit', async () => {
      const user = getTestUser()
      const now = Date.now()
      const days = (n: number) => new Date(now - n * 86_400_000)

      const breadId = '11111111-1111-1111-1111-111111111111'
      const oatsId = '22222222-2222-2222-2222-222222222222'
      const teaId = '33333333-3333-3333-3333-333333333333'

      // Bread: used 3 times, most recent quantity = 80g
      const breadMeals = [
        await insertMeal(user, { meal_type: 'breakfast', time: days(10) }),
        await insertMeal(user, { meal_type: 'breakfast', time: days(5) }),
        await insertMeal(user, { meal_type: 'breakfast', time: days(1) }),
      ]
      for (let i = 0; i < breadMeals.length; i++) {
        await setMealFoodItems(user, breadMeals[i].id, [
          {
            food_item_icon: '🍞',
            food_item_id: breadId,
            food_item_name: 'Rye bread',
            quantity: i === breadMeals.length - 1 ? 80 : 100,
            sort_order: 0,
            unit: 'g',
          },
        ])
      }

      // Oats: used twice
      for (const day of [7, 3]) {
        const meal = await insertMeal(user, { meal_type: 'breakfast', time: days(day) })
        await setMealFoodItems(user, meal.id, [
          {
            food_item_icon: '🥣',
            food_item_id: oatsId,
            food_item_name: 'Oats',
            quantity: 50,
            sort_order: 0,
            unit: 'g',
          },
        ])
      }

      // Tea: once but outside the 30-day window — should be excluded.
      const oldTeaMeal = await insertMeal(user, { meal_type: 'breakfast', time: days(120) })
      await setMealFoodItems(user, oldTeaMeal.id, [
        {
          food_item_icon: undefined,
          food_item_id: teaId,
          food_item_name: 'Tea',
          quantity: 1,
          sort_order: 0,
          unit: 'cup',
        },
      ])

      const rows = await getFrequentFoodItems(user, { limit: 10, since_days: 30 })

      expect(rows.map((r) => r.food_item_id)).toEqual([breadId, oatsId])
      expect(rows[0]).toMatchObject({
        count: 3,
        food_item_id: breadId,
        icon: '🍞',
        last_quantity: 80,
        last_unit: 'g',
        name: 'Rye bread',
      })
      expect(rows[1]).toMatchObject({ count: 2, food_item_id: oatsId, name: 'Oats' })
    })

    test('respects limit', async () => {
      const user = getTestUser()
      for (let i = 0; i < 5; i++) {
        const meal = await insertMeal(user, { meal_type: 'breakfast', time: new Date() })
        await setMealFoodItems(user, meal.id, [
          {
            food_item_id: `00000000-0000-0000-0000-00000000000${i}`,
            food_item_name: `Food ${i}`,
            quantity: 1,
            sort_order: 0,
            unit: 'g',
          },
        ])
      }
      const rows = await getFrequentFoodItems(user, { limit: 3, since_days: 30 })
      expect(rows).toHaveLength(3)
    })

    test('scopes to meal_type when provided so per-slot strips show different "usuals"', async () => {
      const user = getTestUser()
      const oats = '11111111-1111-1111-1111-aaaaaaaaaaaa'
      const soup = '22222222-2222-2222-2222-bbbbbbbbbbbb'

      const breakfast = await insertMeal(user, { meal_type: 'breakfast', time: new Date() })
      await setMealFoodItems(user, breakfast.id, [
        { food_item_id: oats, food_item_name: 'Oats', quantity: 50, sort_order: 0, unit: 'g' },
      ])
      const lunch = await insertMeal(user, { meal_type: 'lunch', time: new Date() })
      await setMealFoodItems(user, lunch.id, [
        { food_item_id: soup, food_item_name: 'Soup', quantity: 1, sort_order: 0, unit: 'bowl' },
      ])

      const breakfastRows = await getFrequentFoodItems(user, {
        limit: 10,
        meal_type: 'breakfast',
        since_days: 30,
      })
      expect(breakfastRows.map((r) => r.food_item_id)).toEqual([oats])

      const lunchRows = await getFrequentFoodItems(user, {
        limit: 10,
        meal_type: 'lunch',
        since_days: 30,
      })
      expect(lunchRows.map((r) => r.food_item_id)).toEqual([soup])

      // Without the filter both items are returned.
      const all = await getFrequentFoodItems(user, { limit: 10, since_days: 30 })
      expect(all.map((r) => r.food_item_id).sort()).toEqual([oats, soup].sort())
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
