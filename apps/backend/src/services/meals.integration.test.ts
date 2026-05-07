/**
 * Integration tests for the meals service.
 *
 * Covers the canonical-food + scaling pipeline: add_meal/update_meal must
 * snapshot canonical nutrient values into meal_food_items scaled by quantity,
 * and the meal's macro columns must auto-fill from the snapshot sum unless
 * the caller explicitly provided meal-level macros.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { updateFoodItem, upsertFoodItem } from '../db/food-items.ts'
import { setIngredients } from '../db/food-item-ingredients.ts'
import { getMealFoodItemsBatch } from '../db/meal-food-items.ts'
import { getMealById } from '../db/meals.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  addMeal,
  getMeal,
  queryFrequentMeals,
  resnapshotMealsForFoodItem,
  updateMealById,
} from './meals.ts'

const CONTAINER_TIMEOUT = 120_000

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

  describe('resnapshotMealsForFoodItem', () => {
    test('refreshes composite snapshots from current derived totals; leaves other items alone', async () => {
      const user = getTestUser()
      // Two simple atomic ingredients.
      const coffee = await upsertFoodItem(user, {
        calories: 2,
        default_quantity: 100,
        default_unit: 'g',
        name: 'Coffee',
        water: 99,
      })
      const oil = await upsertFoodItem(user, {
        calories: 880,
        default_quantity: 100,
        default_unit: 'g',
        fat: 100,
        name: 'Coconut oil',
      })
      // A composite parent with stale row columns.
      const recipe = await upsertFoodItem(user, {
        calories: 999, // stale leftover
        default_quantity: 1,
        default_unit: 'recipe',
        fiber: 99,
        name: 'Fat coffee',
      })
      await setIngredients(user, recipe.id, [
        { ingredient_food_item_id: coffee.id, quantity: 500, sort_order: 0, unit: 'g' },
        { ingredient_food_item_id: oil.id, quantity: 15, sort_order: 1, unit: 'g' },
      ])
      // An unrelated food item (must be left untouched in the meal).
      const banana = await upsertFoodItem(user, {
        calories: 89,
        default_quantity: 100,
        default_unit: 'g',
        name: 'Banana',
      })

      // Log a meal with the recipe + banana.
      const created = await addMeal(user, {
        food_items: [
          { food_item_id: recipe.id, name: 'Fat coffee', quantity: 1, unit: 'recipe' },
          { food_item_id: banana.id, name: 'Banana', quantity: 100, unit: 'g' },
        ],
        time: '2025-06-15T08:00:00Z',
      })
      const mealId = created.data!.id

      // Sanity: snapshot already uses derived totals (because syncFoodItemsToJunction
      // fetches detail for composites). 500 g × 0.02 + 15 g × 8.8 = 10 + 132 = 142 kcal.
      let links = (await getMealFoodItemsBatch(user, [mealId])).get(mealId) ?? []
      const recipeLink = links.find((l) => l.food_item_id === recipe.id)!
      expect(recipeLink.calories).toBe(142)

      // Now fiddle with the recipe directly via stale row columns to simulate
      // a snapshot taken before the bug fix landed (older meal data). We
      // overwrite the junction row, then verify resnapshot fixes it.
      const bananaLinkBefore = links.find((l) => l.food_item_id === banana.id)!
      expect(bananaLinkBefore.calories).toBe(89)

      // Tweak ingredients: bump oil to 25 g → 500×0.02 + 25×8.8 = 10 + 220 = 230.
      await setIngredients(user, recipe.id, [
        { ingredient_food_item_id: coffee.id, quantity: 500, sort_order: 0, unit: 'g' },
        { ingredient_food_item_id: oil.id, quantity: 25, sort_order: 1, unit: 'g' },
      ])

      const result = await resnapshotMealsForFoodItem(user, recipe.id)
      expect(result.meals_updated).toBe(1)
      expect(result.rows_updated).toBe(1)

      links = (await getMealFoodItemsBatch(user, [mealId])).get(mealId) ?? []
      const refreshed = links.find((l) => l.food_item_id === recipe.id)!
      expect(refreshed.calories).toBe(230)
      // Banana row stays untouched.
      const bananaAfter = links.find((l) => l.food_item_id === banana.id)!
      expect(bananaAfter.calories).toBe(89)

      // Meal-level macros recomputed from the new junction rows.
      const meal = await getMealById(user, mealId)
      expect(meal!.calories).toBe(319) // 230 + 89
    })

    test('atomic plain item — refreshes from row columns when they change', async () => {
      const user = getTestUser()
      const food = await upsertFoodItem(user, {
        calories: 200,
        default_quantity: 100,
        default_unit: 'g',
        name: 'Bread',
      })
      const meal = await addMeal(user, {
        food_items: [{ food_item_id: food.id, name: 'Bread', quantity: 50, unit: 'g' }],
        time: '2025-06-15T08:00:00Z',
      })
      // Bump the canonical calories to 240, then re-snapshot.
      await updateFoodItem(user, food.id, { calories: 240 })
      const result = await resnapshotMealsForFoodItem(user, food.id)
      expect(result.rows_updated).toBe(1)
      const links = (await getMealFoodItemsBatch(user, [meal.data!.id])).get(meal.data!.id) ?? []
      expect(links[0].calories).toBe(120) // 50/100 × 240
    })
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

  describe('food item display is resolved live', () => {
    test('editing a food item icon updates the icon on past meals (the timeline-stack bug)', async () => {
      const user = getTestUser()
      const bread = await upsertFoodItem(user, {
        calories: 200,
        default_quantity: 100,
        default_unit: 'g',
        name: 'Vitlöksbaguette',
      })

      const meal = await addMeal(user, {
        food_items: [{ food_item_id: bread.id, name: 'Vitlöksbaguette', quantity: 100, unit: 'g' }],
        meal_type: 'lunch',
        time: '2026-04-26T12:00:00Z',
      })
      const mealId = meal.data!.id

      // No icon at meal-creation time → meal renders without one.
      const before = await getMeal(user, mealId)
      expect(before.data!.food_items?.[0].icon).toBeUndefined()

      // User decorates the food item *after* logging the meal — the timeline
      // should pick this up immediately, no resnapshot needed.
      await updateFoodItem(user, bread.id, { icon: '🥖' })

      const after = await getMeal(user, mealId)
      expect(after.data!.food_items?.[0].icon).toBe('🥖')
      expect(after.data!.food_items?.[0].name).toBe('Vitlöksbaguette')
    })

    test('renaming a food item updates the name on past meals', async () => {
      const user = getTestUser()
      const item = await upsertFoodItem(user, {
        calories: 90,
        default_quantity: 1,
        default_unit: 'piece',
        icon: '🍌',
        name: 'Banana',
      })

      const meal = await addMeal(user, {
        food_items: [{ food_item_id: item.id, name: 'Banana', quantity: 1 }],
        meal_type: 'snack',
        time: '2026-04-26T15:00:00Z',
      })

      await updateFoodItem(user, item.id, { name: 'Banan' })

      const refreshed = await getMeal(user, meal.data!.id)
      expect(refreshed.data!.food_items?.[0].name).toBe('Banan')
    })

  })
})
