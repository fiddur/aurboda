import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  deleteFoodItem,
  findOrCreateFoodItem,
  getFoodItemById,
  getFoodItemByName,
  searchFoodItems,
  updateFoodItem,
  upsertFoodItem,
} from './food-items.ts'
import { getMealFoodItems, setMealFoodItems } from './meal-food-items.ts'
import { insertMeal } from './meals.ts'

const CONTAINER_TIMEOUT = 60_000

describe('Food Items Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('upsertFoodItem', () => {
    test('creates a food item with macros', async () => {
      const user = getTestUser()

      const item = await upsertFoodItem(user, {
        name: 'Rye Bread',
        source: 'cronometer',
        default_quantity: 2,
        default_unit: 'large slice',
        calories: 222.74,
        protein: 7.31,
        carbs: 41.54,
        fat: 2.84,
        fiber: 3.84,
      })

      expect(item.id).toBeDefined()
      expect(item.name).toBe('Rye Bread')
      expect(item.name_lower).toBe('rye bread')
      expect(item.source).toBe('cronometer')
      expect(item.calories).toBe(222.74)
      expect(item.protein).toBe(7.31)
    })

    test('deduplicates by name (case-insensitive)', async () => {
      const user = getTestUser()

      const first = await upsertFoodItem(user, { name: 'Rye Bread', calories: 200 })
      const second = await upsertFoodItem(user, { name: 'rye bread', calories: 250 })

      expect(first.id).toBe(second.id)
      expect(second.calories).toBe(250) // Updated
    })
  })

  describe('searchFoodItems', () => {
    test('finds items by prefix', async () => {
      const user = getTestUser()

      await upsertFoodItem(user, { name: 'Rye Bread' })
      await upsertFoodItem(user, { name: 'Rice' })
      await upsertFoodItem(user, { name: 'Banana' })

      const results = await searchFoodItems(user, 'r', 10)
      expect(results).toHaveLength(2)
      expect(results.map((r) => r.name).sort()).toEqual(['Rice', 'Rye Bread'])
    })

    test('is case-insensitive', async () => {
      const user = getTestUser()

      await upsertFoodItem(user, { name: 'Fat Coffee' })

      const results = await searchFoodItems(user, 'fat', 10)
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Fat Coffee')
    })
  })

  describe('getFoodItemByName', () => {
    test('finds by exact name (case-insensitive)', async () => {
      const user = getTestUser()

      await upsertFoodItem(user, { name: 'Banana', calories: 105 })

      const found = await getFoodItemByName(user, 'BANANA')
      expect(found).not.toBeNull()
      expect(found!.calories).toBe(105)
    })

    test('returns null for missing name', async () => {
      const user = getTestUser()
      const found = await getFoodItemByName(user, 'Nonexistent')
      expect(found).toBeNull()
    })
  })

  describe('findOrCreateFoodItem', () => {
    test('creates if not found', async () => {
      const user = getTestUser()

      const item = await findOrCreateFoodItem(user, 'New Food', { calories: 100 })
      expect(item.name).toBe('New Food')
      expect(item.calories).toBe(100)
    })

    test('returns existing if found', async () => {
      const user = getTestUser()

      const first = await upsertFoodItem(user, { name: 'Existing', calories: 200 })
      const second = await findOrCreateFoodItem(user, 'existing', { calories: 300 })

      expect(second.id).toBe(first.id)
      expect(second.calories).toBe(200) // Not overwritten
    })
  })

  describe('updateFoodItem', () => {
    test('updates specific fields', async () => {
      const user = getTestUser()

      const item = await upsertFoodItem(user, { name: 'Bread', calories: 200, protein: 7 })
      const updated = await updateFoodItem(user, item.id, { calories: 250 })

      expect(updated!.calories).toBe(250)
      expect(updated!.protein).toBe(7) // Unchanged
    })
  })

  describe('deleteFoodItem', () => {
    test('deletes a food item', async () => {
      const user = getTestUser()

      const item = await upsertFoodItem(user, { name: 'ToDelete' })
      const deleted = await deleteFoodItem(user, item.id)
      expect(deleted).toBe(true)

      const found = await getFoodItemById(user, item.id)
      expect(found).toBeNull()
    })
  })

  describe('meal_food_items junction', () => {
    test('links food items to meals', async () => {
      const user = getTestUser()

      const food1 = await upsertFoodItem(user, { name: 'Bread', calories: 200 })
      const food2 = await upsertFoodItem(user, { name: 'Butter', calories: 100, fat: 11 })
      const meal = await insertMeal(user, { time: new Date('2025-06-15T08:00:00Z') })

      await setMealFoodItems(user, meal.id, [
        { food_item_id: food1.id, quantity: 2, unit: 'slice', sort_order: 0, calories: 400 },
        { food_item_id: food2.id, quantity: 1, unit: 'tbsp', sort_order: 1, calories: 100, fat: 11 },
      ])

      const links = await getMealFoodItems(user, meal.id)
      expect(links).toHaveLength(2)
      expect(links[0].food_item_name).toBe('Bread')
      expect(links[0].calories).toBe(400)
      expect(links[1].food_item_name).toBe('Butter')
      expect(links[1].fat).toBe(11)
    })

    test('replaces junction rows on re-set', async () => {
      const user = getTestUser()

      const food = await upsertFoodItem(user, { name: 'Rice' })
      const meal = await insertMeal(user, { time: new Date('2025-06-15T12:00:00Z') })

      await setMealFoodItems(user, meal.id, [
        { food_item_id: food.id, quantity: 1, unit: 'cup', sort_order: 0 },
      ])

      const food2 = await upsertFoodItem(user, { name: 'Chicken' })
      await setMealFoodItems(user, meal.id, [
        { food_item_id: food2.id, quantity: 150, unit: 'g', sort_order: 0 },
      ])

      const links = await getMealFoodItems(user, meal.id)
      expect(links).toHaveLength(1)
      expect(links[0].food_item_name).toBe('Chicken')
    })

    test('cascade deletes junction rows when meal is deleted', async () => {
      const user = getTestUser()

      const food = await upsertFoodItem(user, { name: 'Egg' })
      const meal = await insertMeal(user, { time: new Date('2025-06-15T07:00:00Z') })

      await setMealFoodItems(user, meal.id, [{ food_item_id: food.id, quantity: 2, sort_order: 0 }])

      const { deleteMeal } = await import('./meals.ts')
      await deleteMeal(user, meal.id)

      const links = await getMealFoodItems(user, meal.id)
      expect(links).toHaveLength(0)
    })
  })
})
