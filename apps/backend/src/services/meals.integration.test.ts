/**
 * Integration tests for the meals service.
 *
 * Covers the canonical-food + scaling pipeline: add_meal/update_meal must
 * snapshot canonical nutrient values into meal_food_items scaled by quantity,
 * and the meal's macro columns must auto-fill from the snapshot sum unless
 * the caller explicitly provided meal-level macros.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { upsertFoodItem } from '../db/food-items.ts'
import { getMealFoodItemsBatch } from '../db/meal-food-items.ts'
import { getMealById } from '../db/meals.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { addMeal, queryFrequentMeals, updateMealById } from './meals.ts'

const CONTAINER_TIMEOUT = 60_000

describe('Meals service integration tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('scales canonical nutrients by quantity into junction snapshots', async () => {
    const user = getTestUser()
    const canonical = await upsertFoodItem(user, {
      calories: 200,
      carbs: 40,
      default_quantity: 100,
      default_unit: 'g',
      fat: 2,
      fiber: 5,
      name: 'Rye bread',
      protein: 8,
    })

    const result = await addMeal(user, {
      food_items: [{ food_item_id: canonical.id, name: 'Rye bread', quantity: 500, unit: 'g' }],
      time: '2025-06-15T08:00:00Z',
    })

    expect(result.success).toBe(true)
    const mealId = result.data!.id

    const links = (await getMealFoodItemsBatch(user, [mealId])).get(mealId) ?? []
    expect(links).toHaveLength(1)
    expect(links[0].calories).toBe(1000)
    expect(links[0].protein).toBe(40)
    expect(links[0].carbs).toBe(200)
    expect(links[0].fat).toBe(10)
    expect(links[0].fiber).toBe(25)
  })

  test('auto-fills meal-level macros from junction sum when not provided', async () => {
    const user = getTestUser()
    const bread = await upsertFoodItem(user, {
      calories: 200,
      default_quantity: 100,
      default_unit: 'g',
      name: 'Rye bread',
      protein: 8,
    })
    const pb = await upsertFoodItem(user, {
      calories: 600,
      default_quantity: 100,
      default_unit: 'g',
      name: 'Peanut butter',
      protein: 25,
    })

    const result = await addMeal(user, {
      food_items: [
        { food_item_id: bread.id, name: 'Rye bread', quantity: 50, unit: 'g' },
        { food_item_id: pb.id, name: 'Peanut butter', quantity: 30, unit: 'g' },
      ],
      time: '2025-06-15T08:00:00Z',
    })

    const meal = await getMealById(user, result.data!.id)
    expect(meal!.calories).toBe(280)
    expect(meal!.protein).toBe(11.5)
  })

  test('honors explicit meal-level macros when caller provides them', async () => {
    const user = getTestUser()
    const bread = await upsertFoodItem(user, {
      calories: 200,
      default_quantity: 100,
      default_unit: 'g',
      name: 'Rye bread',
      protein: 8,
    })

    const result = await addMeal(user, {
      calories: 1234,
      food_items: [{ food_item_id: bread.id, name: 'Rye bread', quantity: 100, unit: 'g' }],
      time: '2025-06-15T08:00:00Z',
    })

    const meal = await getMealById(user, result.data!.id)
    expect(meal!.calories).toBe(1234)
    expect(meal!.protein).toBe(8)
  })

  test('rescales snapshots when a meal is updated with a new quantity', async () => {
    const user = getTestUser()
    const bread = await upsertFoodItem(user, {
      calories: 200,
      default_quantity: 100,
      default_unit: 'g',
      name: 'Rye bread',
      protein: 8,
    })

    const created = await addMeal(user, {
      food_items: [{ food_item_id: bread.id, name: 'Rye bread', quantity: 100, unit: 'g' }],
      time: '2025-06-15T08:00:00Z',
    })
    const mealId = created.data!.id

    const updated = await updateMealById(user, mealId, {
      food_items: [{ food_item_id: bread.id, name: 'Rye bread', quantity: 500, unit: 'g' }],
    })

    expect(updated.success).toBe(true)
    const links = (await getMealFoodItemsBatch(user, [mealId])).get(mealId) ?? []
    expect(links[0].calories).toBe(1000)
    expect(links[0].protein).toBe(40)

    const meal = await getMealById(user, mealId)
    expect(meal!.calories).toBe(1000)
  })

  describe('queryFrequentMeals', () => {
    test('returns frequent names with food items and icon from most recent occurrence', async () => {
      const user = getTestUser()
      const banana = await upsertFoodItem(user, {
        calories: 100,
        default_quantity: 1,
        default_unit: 'piece',
        icon: '🍌',
        name: 'Banana',
      })
      const coffee = await upsertFoodItem(user, {
        calories: 5,
        default_quantity: 1,
        default_unit: 'cup',
        icon: '☕',
        name: 'Coffee',
      })

      // Bananmacka logged twice, most recent has the food items
      await addMeal(user, {
        food_items: [{ food_item_id: banana.id, name: 'Banana', quantity: 1 }],
        meal_type: 'breakfast',
        name: 'Bananmacka',
        time: '2026-04-20T08:00:00Z',
      })
      await addMeal(user, {
        food_items: [
          { food_item_id: banana.id, name: 'Banana', quantity: 1 },
          { food_item_id: coffee.id, name: 'Coffee', quantity: 1 },
        ],
        meal_type: 'breakfast',
        name: 'Bananmacka',
        time: '2026-04-26T08:00:00Z',
      })

      const result = await queryFrequentMeals(user, { meal_type: 'breakfast' })

      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(1)
      const entry = result.data[0]
      expect(entry.name).toBe('Bananmacka')
      expect(entry.count).toBe(2)
      // Icon picked from the first food item of the most recent occurrence
      expect(entry.icon).toBe('🍌')
      expect(entry.food_items?.map((fi) => fi.name)).toEqual(['Banana', 'Coffee'])
    })

    test('returns null icon when most recent occurrence has no food items', async () => {
      const user = getTestUser()

      await addMeal(user, {
        meal_type: 'breakfast',
        name: 'Toast',
        time: '2026-04-26T08:00:00Z',
      })

      const result = await queryFrequentMeals(user, { meal_type: 'breakfast' })
      expect(result.data).toHaveLength(1)
      expect(result.data[0].icon).toBeNull()
      expect(result.data[0].food_items).toBeUndefined()
    })
  })
})
