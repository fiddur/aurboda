/**
 * Integration tests for portion-based recipe ingredients.
 *
 * Recipes can measure an ingredient in one of the ingredient food's portions
 * (e.g. "2 brödkaka") instead of a free-form quantity/unit, mirroring meals.
 * The ingredient's nutrient contribution then scales by
 * `portion_count × portion.base_equivalent / ingredient.default_quantity`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { CentralDb } from './central-db.ts'

import { getIngredients, setIngredients } from '../db/food-item-ingredients.ts'
import { insertFoodItemPortion } from '../db/food-item-portions.ts'
import { getFoodItemById, upsertFoodItem } from '../db/food-items.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { createFoodItemsService, prepareIngredientInputs } from './food-items.ts'

const CONTAINER_TIMEOUT = 120_000

const stubCentral = (): CentralDb =>
  ({
    getSharedFoodItemById: async () => null,
    getSharedFoodItemByName: async () => null,
    getSharedFoodItemsByIds: async () => new Map(),
    searchSharedFoodItems: async () => [],
  }) as unknown as CentralDb

describe('recipe ingredient portions integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('prepareIngredientInputs fills quantity/unit from the portion and round-trips', async () => {
    const user = getTestUser()
    const bread = await upsertFoodItem(user, {
      calories: 200,
      default_quantity: 100,
      default_unit: 'g',
      name: 'Bread',
    })
    const portion = await insertFoodItemPortion(user, {
      base_equivalent: 35,
      food_item_id: bread.id,
      label_unit: 'brödkaka',
      sort_order: 0,
    })
    const recipe = await upsertFoodItem(user, {
      default_quantity: 1,
      default_unit: 'recipe',
      name: 'Bananmacka',
    })

    const prepared = await prepareIngredientInputs(user, [
      {
        food_item_portion_id: portion.id,
        ingredient_food_item_id: bread.id,
        portion_count: 2,
        sort_order: 0,
      },
    ])
    // The portion path fills the display columns from the portion.
    expect(prepared[0]).toMatchObject({
      food_item_portion_id: portion.id,
      portion_count: 2,
      quantity: 2,
      unit: 'brödkaka',
    })

    await setIngredients(user, recipe.id, prepared)

    const rows = await getIngredients(user, recipe.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].food_item_portion_id).toBe(portion.id)
    expect(rows[0].portion_count).toBe(2)
    expect(rows[0].unit).toBe('brödkaka')
  })

  test('derived nutrients scale by portion_count × base_equivalent / default_quantity', async () => {
    const user = getTestUser()
    const bread = await upsertFoodItem(user, {
      calories: 200,
      default_quantity: 100,
      default_unit: 'g',
      protein: 8,
      name: 'Bread',
    })
    const portion = await insertFoodItemPortion(user, {
      base_equivalent: 35, // 1 brödkaka = 35 g
      food_item_id: bread.id,
      label_unit: 'brödkaka',
      sort_order: 0,
    })
    const recipe = await upsertFoodItem(user, {
      default_quantity: 1,
      default_unit: 'recipe',
      name: 'Bananmacka',
    })
    const prepared = await prepareIngredientInputs(user, [
      {
        food_item_portion_id: portion.id,
        ingredient_food_item_id: bread.id,
        portion_count: 2,
        sort_order: 0,
      },
    ])
    await setIngredients(user, recipe.id, prepared)

    const service = createFoodItemsService(stubCentral())
    const detail = await service.getDetail(user, recipe.id)
    // 2 brödkaka = 70 g; scale = 70/100 = 0.7 → calories 200×0.7 = 140, protein 8×0.7 = 5.6.
    expect(detail?.derived_nutrients?.values.calories).toBe(140)
    expect(detail?.derived_nutrients?.values.protein).toBe(5.6)
    expect(detail?.derived_nutrients?.nutrient_data_incomplete).toBe(false)
  })

  test('legacy quantity-based ingredients still scale (no portion)', async () => {
    const user = getTestUser()
    const milk = await upsertFoodItem(user, {
      calories: 60,
      default_quantity: 100,
      default_unit: 'ml',
      name: 'Milk',
    })
    const recipe = await upsertFoodItem(user, {
      default_quantity: 1,
      default_unit: 'recipe',
      name: 'Latte',
    })
    const prepared = await prepareIngredientInputs(user, [
      { ingredient_food_item_id: milk.id, quantity: 250, sort_order: 0, unit: 'ml' },
    ])
    await setIngredients(user, recipe.id, prepared)

    const service = createFoodItemsService(stubCentral())
    const detail = await service.getDetail(user, recipe.id)
    expect(detail?.derived_nutrients?.values.calories).toBe(150) // 60 × 250/100
  })

  test('rejects a portion that does not belong to the ingredient food', async () => {
    const user = getTestUser()
    const bread = await upsertFoodItem(user, {
      calories: 200,
      default_quantity: 100,
      default_unit: 'g',
      name: 'Bread',
    })
    const other = await upsertFoodItem(user, {
      calories: 50,
      default_quantity: 100,
      default_unit: 'g',
      name: 'Cheese',
    })
    // Portion belongs to `other`, not `bread`.
    const portion = await insertFoodItemPortion(user, {
      base_equivalent: 20,
      food_item_id: other.id,
      label_unit: 'slice',
      sort_order: 0,
    })

    await expect(
      prepareIngredientInputs(user, [
        {
          food_item_portion_id: portion.id,
          ingredient_food_item_id: bread.id,
          portion_count: 1,
          sort_order: 0,
        },
      ]),
    ).rejects.toThrow(/does not belong/)
  })

  test('cached row columns reflect portion scaling after setIngredients via the route path', async () => {
    // Mirrors what the PUT route does: prepare → setIngredients → cache.
    const user = getTestUser()
    const bread = await upsertFoodItem(user, {
      calories: 200,
      default_quantity: 100,
      default_unit: 'g',
      name: 'Bread',
    })
    const portion = await insertFoodItemPortion(user, {
      base_equivalent: 50,
      food_item_id: bread.id,
      label_unit: 'big slice',
      sort_order: 0,
    })
    const recipe = await upsertFoodItem(user, {
      default_quantity: 1,
      default_unit: 'recipe',
      name: 'Toast',
    })
    const { cacheCompositeNutrients } = await import('./food-items.ts')
    const prepared = await prepareIngredientInputs(user, [
      {
        food_item_portion_id: portion.id,
        ingredient_food_item_id: bread.id,
        portion_count: 3,
        sort_order: 0,
      },
    ])
    await setIngredients(user, recipe.id, prepared)
    await cacheCompositeNutrients(user, stubCentral(), recipe.id)

    // 3 big slice = 150 g; scale 1.5 → calories 300 cached on the row.
    expect((await getFoodItemById(user, recipe.id))?.calories).toBe(300)
  })
})
