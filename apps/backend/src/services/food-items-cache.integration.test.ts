/**
 * Integration tests for the composite-nutrient cache.
 *
 * The cache writes derived totals onto a composite's `food_items` row columns
 * so search dropdowns, frequent-meal queries, and parent recipes that read
 * `food.calories` directly all see live values. Editing a recipe must also
 * propagate up to every parent recipe that uses it as an ingredient.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { CentralDb } from './central-db.ts'

import { setIngredients } from '../db/food-item-ingredients.ts'
import { getFoodItemById, upsertFoodItem } from '../db/food-items.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { cacheCompositeNutrients, clearCompositeNutrientCache } from './food-items.ts'

const CONTAINER_TIMEOUT = 120_000

// All ingredients live in the per-user DB, so the central DB is never hit.
// A bare stub satisfies the type without needing a real connection.
const stubCentral = (): CentralDb =>
  ({
    getSharedFoodItemById: async () => null,
    getSharedFoodItemByName: async () => null,
    listSharedFoodItems: async () => [],
    searchSharedFoodItems: async () => [],
    upsertSharedFoodItem: async () => undefined,
  }) as unknown as CentralDb

describe('cacheCompositeNutrients integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('writes derived totals onto the composite row + propagates to parent recipes', async () => {
    const user = getTestUser()
    // Atomic leaves.
    const oil = await upsertFoodItem(user, {
      calories: 900,
      default_quantity: 100,
      default_unit: 'g',
      fat: 100,
      vitamin_e: 17,
      name: 'Olive oil',
    })
    const garlic = await upsertFoodItem(user, {
      calories: 100,
      default_quantity: 100,
      default_unit: 'g',
      name: 'Garlic',
    })

    // Composite A: 50 g oil → 450 kcal, 8.5 mg vitamin E.
    const recipeA = await upsertFoodItem(user, {
      calories: 9999, // stale leftover; the cache should overwrite this
      default_quantity: 1,
      default_unit: 'recipe',
      name: 'Garlic oil',
    })
    await setIngredients(user, recipeA.id, [
      { ingredient_food_item_id: oil.id, quantity: 50, sort_order: 0, unit: 'g' },
      { ingredient_food_item_id: garlic.id, quantity: 10, sort_order: 1, unit: 'g' },
    ])

    // Composite B contains A as an ingredient (1 recipe of A → A's totals).
    const recipeB = await upsertFoodItem(user, {
      default_quantity: 1,
      default_unit: 'serving',
      name: 'Pasta with garlic oil',
    })
    await setIngredients(user, recipeB.id, [
      { ingredient_food_item_id: recipeA.id, quantity: 1, sort_order: 0, unit: 'recipe' },
    ])

    // Cache for A: derived from leaves; should overwrite stale 9999 calories.
    await cacheCompositeNutrients(user, stubCentral(), recipeA.id)
    const cachedA = await getFoodItemById(user, recipeA.id)
    expect(cachedA?.calories).toBe(460) // 50 g × 9 + 10 g × 1 = 450 + 10 = 460
    expect(cachedA?.fat).toBe(50) // 50 g × 1 g/g
    expect(cachedA?.vitamin_e).toBe(8.5) // 50 g × 17 mg / 100 g

    // Edit A: drop the garlic; cache + propagate.
    await setIngredients(user, recipeA.id, [
      { ingredient_food_item_id: oil.id, quantity: 50, sort_order: 0, unit: 'g' },
    ])
    await cacheCompositeNutrients(user, stubCentral(), recipeA.id)

    const cachedA2 = await getFoodItemById(user, recipeA.id)
    expect(cachedA2?.calories).toBe(450)

    // B's row cache must have been refreshed too — it reads A's now-cached
    // calories (450) × 1 recipe × scale 1 = 450.
    const cachedB = await getFoodItemById(user, recipeB.id)
    expect(cachedB?.calories).toBe(450)
    expect(cachedB?.vitamin_e).toBe(8.5)
  })

  test('clearCompositeNutrientCache nulls the cached columns and refreshes parents', async () => {
    const user = getTestUser()
    const oil = await upsertFoodItem(user, {
      calories: 900,
      default_quantity: 100,
      default_unit: 'g',
      name: 'Olive oil',
    })
    const recipeA = await upsertFoodItem(user, {
      default_quantity: 1,
      default_unit: 'recipe',
      name: 'Recipe A',
    })
    await setIngredients(user, recipeA.id, [
      { ingredient_food_item_id: oil.id, quantity: 50, sort_order: 0, unit: 'g' },
    ])
    const recipeB = await upsertFoodItem(user, {
      default_quantity: 1,
      default_unit: 'recipe',
      name: 'Recipe B',
    })
    await setIngredients(user, recipeB.id, [
      { ingredient_food_item_id: recipeA.id, quantity: 1, sort_order: 0, unit: 'recipe' },
    ])
    await cacheCompositeNutrients(user, stubCentral(), recipeA.id)
    expect((await getFoodItemById(user, recipeA.id))?.calories).toBe(450)
    expect((await getFoodItemById(user, recipeB.id))?.calories).toBe(450)

    await clearCompositeNutrientCache(user, stubCentral(), recipeA.id)
    // A's cache nulled.
    expect((await getFoodItemById(user, recipeA.id))?.calories).toBeUndefined()
    // B's cache recomputed — A no longer contributes (resolves but yields 0/null),
    // so B drops to 0 / null too.
    const cachedB = await getFoodItemById(user, recipeB.id)
    expect(cachedB?.calories === undefined || cachedB.calories === 0).toBe(true)
  })

  test('non-composite items are not touched by cacheCompositeNutrients', async () => {
    const user = getTestUser()
    const atom = await upsertFoodItem(user, {
      calories: 200,
      default_quantity: 100,
      default_unit: 'g',
      name: 'Bread',
    })
    await cacheCompositeNutrients(user, stubCentral(), atom.id)
    // Calories untouched — the user's authoritative value stays.
    expect((await getFoodItemById(user, atom.id))?.calories).toBe(200)
  })
})
