import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  clearIngredients,
  getIngredients,
  getIngredientsBatch,
  setIngredients,
} from './food-item-ingredients.ts'
import { deleteFoodItem, getFoodItemById, setFoodItemReference, upsertFoodItem } from './food-items.ts'

const CONTAINER_TIMEOUT = 120_000

describe('food_item_ingredients integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('setIngredients inserts rows in order and flips is_composite', async () => {
    const user = getTestUser()
    const parent = await upsertFoodItem(user, { name: 'Bulletproof coffee' })
    const coffee = await upsertFoodItem(user, { name: 'Coffee', default_quantity: 100, default_unit: 'ml' })
    const oil = await upsertFoodItem(user, { name: 'Coconut oil', default_quantity: 1, default_unit: 'g' })

    await setIngredients(user, parent.id, [
      { ingredient_food_item_id: coffee.id, quantity: 500, sort_order: 0, unit: 'ml' },
      { ingredient_food_item_id: oil.id, quantity: 15, sort_order: 1, unit: 'g' },
    ])

    const rows = await getIngredients(user, parent.id)
    expect(rows.map((r) => r.ingredient_food_item_id)).toEqual([coffee.id, oil.id])
    expect(rows[0].quantity).toBe(500)
    expect(rows[0].unit).toBe('ml')

    const refreshedParent = await getFoodItemById(user, parent.id)
    expect(refreshedParent?.is_composite).toBe(true)
  })

  test('setIngredients with empty list clears is_composite', async () => {
    const user = getTestUser()
    const parent = await upsertFoodItem(user, { name: 'Recipe' })
    const ing = await upsertFoodItem(user, { name: 'Ingredient' })

    await setIngredients(user, parent.id, [{ ingredient_food_item_id: ing.id, quantity: 1, sort_order: 0 }])
    expect((await getFoodItemById(user, parent.id))?.is_composite).toBe(true)

    await setIngredients(user, parent.id, [])
    expect((await getFoodItemById(user, parent.id))?.is_composite).toBe(false)
    expect(await getIngredients(user, parent.id)).toEqual([])
  })

  test('clearIngredients drops rows and reverts is_composite to false', async () => {
    const user = getTestUser()
    const parent = await upsertFoodItem(user, { name: 'Recipe' })
    const ing = await upsertFoodItem(user, { name: 'Ingredient' })

    await setIngredients(user, parent.id, [{ ingredient_food_item_id: ing.id, quantity: 1, sort_order: 0 }])
    await clearIngredients(user, parent.id)

    expect(await getIngredients(user, parent.id)).toEqual([])
    expect((await getFoodItemById(user, parent.id))?.is_composite).toBe(false)
  })

  test('CASCADE on parent delete removes ingredient rows', async () => {
    const user = getTestUser()
    const parent = await upsertFoodItem(user, { name: 'Doomed recipe' })
    const ing = await upsertFoodItem(user, { name: 'Survivor' })
    await setIngredients(user, parent.id, [{ ingredient_food_item_id: ing.id, quantity: 1, sort_order: 0 }])

    await deleteFoodItem(user, parent.id)

    expect(await getIngredients(user, parent.id)).toEqual([])
    // Ingredient itself survives — no FK on ingredient_food_item_id.
    expect(await getFoodItemById(user, ing.id)).not.toBeNull()
  })

  test('self-ingredient inserts are blocked by the SQL CHECK', async () => {
    const user = getTestUser()
    const parent = await upsertFoodItem(user, { name: 'Selfie' })
    await expect(
      setIngredients(user, parent.id, [{ ingredient_food_item_id: parent.id, quantity: 1, sort_order: 0 }]),
    ).rejects.toThrow()
  })

  test('a failing setIngredients rolls back, leaving the previous ingredient list intact', async () => {
    const user = getTestUser()
    const parent = await upsertFoodItem(user, { name: 'Porridge' })
    const oats = await upsertFoodItem(user, { name: 'Oats' })
    await setIngredients(user, parent.id, [{ ingredient_food_item_id: oats.id, quantity: 60, sort_order: 0 }])

    await expect(
      setIngredients(user, parent.id, [{ ingredient_food_item_id: parent.id, quantity: 1, sort_order: 0 }]),
    ).rejects.toThrow()

    const rows = await getIngredients(user, parent.id)
    expect(rows.map((r) => r.ingredient_food_item_id)).toEqual([oats.id])
    expect((await getFoodItemById(user, parent.id))?.is_composite).toBe(true)
  })

  test('deleteFoodItem refuses an item used as an ingredient and changes nothing', async () => {
    const user = getTestUser()
    const parent = await upsertFoodItem(user, { name: 'Pancakes' })
    const flour = await upsertFoodItem(user, { name: 'Flour' })
    const referrer = await upsertFoodItem(user, { name: 'Flour (brand)' })
    await setIngredients(user, parent.id, [
      { ingredient_food_item_id: flour.id, quantity: 100, sort_order: 0 },
    ])
    await setFoodItemReference(user, referrer.id, flour.id)

    await expect(deleteFoodItem(user, flour.id)).rejects.toThrow(
      'Cannot delete: this food item is used as an ingredient in one or more recipes.',
    )

    expect(await getFoodItemById(user, flour.id)).not.toBeNull()
    expect((await getFoodItemById(user, referrer.id))?.reference_food_item_id).toBe(flour.id)
    expect((await getIngredients(user, parent.id)).map((r) => r.ingredient_food_item_id)).toEqual([flour.id])
  })

  test('getIngredientsBatch keys results by parent_food_item_id', async () => {
    const user = getTestUser()
    const parent1 = await upsertFoodItem(user, { name: 'Parent 1' })
    const parent2 = await upsertFoodItem(user, { name: 'Parent 2' })
    const ing = await upsertFoodItem(user, { name: 'Ingredient' })

    await setIngredients(user, parent1.id, [{ ingredient_food_item_id: ing.id, quantity: 1, sort_order: 0 }])
    await setIngredients(user, parent2.id, [{ ingredient_food_item_id: ing.id, quantity: 2, sort_order: 0 }])

    const map = await getIngredientsBatch(user, [parent1.id, parent2.id])
    expect(map.get(parent1.id)).toHaveLength(1)
    expect(map.get(parent2.id)?.[0]?.quantity).toBe(2)
  })
})
