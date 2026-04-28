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

const CONTAINER_TIMEOUT = 120_000

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

    test('matches mid-word substrings (brand-prefixed names)', async () => {
      const user = getTestUser()

      await upsertFoodItem(user, { name: 'Arla, Hushallsost' })
      await upsertFoodItem(user, { name: 'Banana' })

      const results = await searchFoodItems(user, 'hushallsost', 10)
      expect(results.map((r) => r.name)).toContain('Arla, Hushallsost')
    })

    test('folds diacritics (å/ä/ö → a/a/o)', async () => {
      const user = getTestUser()

      await upsertFoodItem(user, { name: 'Arla, Hushållsost' })
      await upsertFoodItem(user, { name: 'Mjölk' })

      const cheeseHits = await searchFoodItems(user, 'hushallsost', 10)
      expect(cheeseHits.map((r) => r.name)).toContain('Arla, Hushållsost')

      const milkHits = await searchFoodItems(user, 'mjolk', 10)
      expect(milkHits.map((r) => r.name)).toContain('Mjölk')
    })

    test('tolerates typos via trigram similarity', async () => {
      const user = getTestUser()

      await upsertFoodItem(user, { name: 'Arla, Hushållsost' })
      await upsertFoodItem(user, { name: 'Banana' })

      // "hushalsost" — missing one 'l' compared to "hushållsost"
      const results = await searchFoodItems(user, 'hushalsost', 10)
      expect(results.map((r) => r.name)).toContain('Arla, Hushållsost')
    })

    test('ranks substring hits above fuzzy-only hits', async () => {
      const user = getTestUser()

      // "hushallsost" is a substring of the first; only fuzzy-similar to the second.
      await upsertFoodItem(user, { name: 'Arla, Hushållsost' })
      await upsertFoodItem(user, { name: 'Hushållsosk' })

      const results = await searchFoodItems(user, 'hushallsost', 10)
      expect(results[0].name).toBe('Arla, Hushållsost')
    })

    test('returns empty array for empty query', async () => {
      const user = getTestUser()
      await upsertFoodItem(user, { name: 'Banana' })

      expect(await searchFoodItems(user, '', 10)).toEqual([])
      expect(await searchFoodItems(user, '   ', 10)).toEqual([])
    })

    test('treats LIKE wildcards in user input as literals', async () => {
      const user = getTestUser()

      await upsertFoodItem(user, { name: '500g pasta' })
      await upsertFoodItem(user, { name: '50% off-cut bacon' })

      // Plain "50%" must only match the literal "50%" string, not "500g..."
      const percentHits = await searchFoodItems(user, '50%', 10)
      expect(percentHits.map((r) => r.name)).toEqual(['50% off-cut bacon'])

      // Plain "_" must be a literal (it shouldn't match the underscore wildcard).
      await upsertFoodItem(user, { name: 'a_b widget' })
      const underscoreHits = await searchFoodItems(user, 'a_b', 10)
      expect(underscoreHits.map((r) => r.name)).toEqual(['a_b widget'])
    })

    test('does not run trigram fuzzy matching for queries shorter than 3 chars', async () => {
      const user = getTestUser()

      // "hu" is a fuzzy-similar substring of "Hushållsost" — the trigram path
      // would surface it, but we want short queries restricted to substring.
      await upsertFoodItem(user, { name: 'Hushållsost' })
      await upsertFoodItem(user, { name: 'Cucumber' })

      // 'cu' is a literal substring of 'Cucumber' (substring path)
      const subHits = await searchFoodItems(user, 'cu', 10)
      expect(subHits.map((r) => r.name)).toEqual(['Cucumber'])

      // 'xz' has no substring match anywhere; without trigram it returns nothing.
      const noHits = await searchFoodItems(user, 'xz', 10)
      expect(noHits).toEqual([])
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
        {
          calories: 400,
          food_item_icon: undefined,
          food_item_id: food1.id,
          food_item_name: 'Bread',
          quantity: 2,
          sort_order: 0,
          unit: 'slice',
        },
        {
          calories: 100,
          fat: 11,
          food_item_icon: undefined,
          food_item_id: food2.id,
          food_item_name: 'Butter',
          quantity: 1,
          sort_order: 1,
          unit: 'tbsp',
        },
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
        { food_item_id: food.id, food_item_name: 'Rice', quantity: 1, sort_order: 0, unit: 'cup' },
      ])

      const food2 = await upsertFoodItem(user, { name: 'Chicken' })
      await setMealFoodItems(user, meal.id, [
        { food_item_id: food2.id, food_item_name: 'Chicken', quantity: 150, sort_order: 0, unit: 'g' },
      ])

      const links = await getMealFoodItems(user, meal.id)
      expect(links).toHaveLength(1)
      expect(links[0].food_item_name).toBe('Chicken')
    })

    test('cascade deletes junction rows when meal is deleted', async () => {
      const user = getTestUser()

      const food = await upsertFoodItem(user, { name: 'Egg' })
      const meal = await insertMeal(user, { time: new Date('2025-06-15T07:00:00Z') })

      await setMealFoodItems(user, meal.id, [
        { food_item_id: food.id, food_item_name: 'Egg', quantity: 2, sort_order: 0 },
      ])

      const { deleteMeal } = await import('./meals.ts')
      await deleteMeal(user, meal.id)

      const links = await getMealFoodItems(user, meal.id)
      expect(links).toHaveLength(0)
    })
  })
})
