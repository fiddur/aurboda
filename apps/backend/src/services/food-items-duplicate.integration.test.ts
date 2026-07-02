/**
 * Integration tests for duplicateFoodItem.
 *
 * Duplicating copies a food item into a fresh per-user "manual" item: its
 * nutrients, defaults, composite ingredients, portions, reference pointer, and
 * sensitivity flags. The copy must be fully independent of the source (editing
 * one must not touch the other) and must never overwrite an existing item via
 * the name_lower upsert conflict.
 *
 * Note: duplicateFoodItem returns the *service* FoodItemDetail shape — the row
 * fields live under `.item`, while ingredients/portions/sensitivities/reference
 * are top-level. (The flattened "name at top level" shape is the REST
 * serializer's job, covered by the router test.)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { CentralDb } from './central-db.ts'
import type { SharedFoodItemEntity } from './central-food-items.ts'

import { setIngredients } from '../db/food-item-ingredients.ts'
import { insertFoodItemPortion, listPortionsForFoodItem } from '../db/food-item-portions.ts'
import { getFoodItemById, setFoodItemReference, updateFoodItem, upsertFoodItem } from '../db/food-items.ts'
import { insertSensitivityFlag, setFoodItemSensitivities } from '../db/sensitivities.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { createFoodItemsService, duplicateFoodItem, type FoodItemDetail } from './food-items.ts'

const CONTAINER_TIMEOUT = 120_000

/** Narrow a duplicate result to non-null so the assertions can read `.item`. */
function assertDetail(detail: FoodItemDetail | null): asserts detail is FoodItemDetail {
  if (detail === null) throw new Error('expected a food item detail, got null')
}

// Most paths keep everything in the per-user DB, so a bare stub satisfies the
// type. The central-source test overrides getSharedFoodItemById.
const stubCentral = (item: SharedFoodItemEntity | null = null): CentralDb =>
  ({
    getSharedFoodItemById: async (id: string) => (item && item.id === id ? item : null),
    getSharedFoodItemByName: async () => null,
    getSharedFoodItemsByIds: async () => new Map(),
    listSharedFoodItems: async () => [],
    searchSharedFoodItems: async () => [],
    upsertSharedFoodItem: async () => undefined,
  }) as unknown as CentralDb

describe('duplicateFoodItem integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('copies an atomic item with a "(copy)" name and manual source', async () => {
    const user = getTestUser()
    const source = await upsertFoodItem(user, {
      calories: 52,
      carbs: 14,
      default_quantity: 100,
      default_unit: 'g',
      fiber: 2.4,
      icon: '🍎',
      name: 'Apple',
      source: 'livsmedelsverket',
    })

    const copy = await duplicateFoodItem(user, stubCentral(), source.id)
    assertDetail(copy)

    expect(copy.item.name).toBe('Apple (copy)')
    expect(copy.item.id).not.toBe(source.id)
    expect(copy.item.source).toBe('manual')
    expect(copy.item.calories).toBe(52)
    expect(copy.item.carbs).toBe(14)
    expect(copy.item.fiber).toBe(2.4)
    expect(copy.item.default_quantity).toBe(100)
    expect(copy.item.default_unit).toBe('g')
    expect(copy.item.icon).toBe('🍎')

    // Editing the copy must not touch the original.
    await updateFoodItem(user, copy.item.id, { calories: 99 })
    expect((await getFoodItemById(user, source.id))?.calories).toBe(52)
  })

  test('copies a composite recipe with its ingredients and derived nutrients, independently', async () => {
    const user = getTestUser()
    const oil = await upsertFoodItem(user, {
      calories: 900,
      default_quantity: 100,
      default_unit: 'g',
      fat: 100,
      name: 'Olive oil',
    })
    const garlic = await upsertFoodItem(user, {
      calories: 100,
      default_quantity: 100,
      default_unit: 'g',
      name: 'Garlic',
    })
    const recipe = await upsertFoodItem(user, {
      default_quantity: 1,
      default_unit: 'recipe',
      name: 'Garlic oil',
    })
    await setIngredients(user, recipe.id, [
      { ingredient_food_item_id: oil.id, quantity: 50, sort_order: 0, unit: 'g' },
      { ingredient_food_item_id: garlic.id, quantity: 10, sort_order: 1, unit: 'g' },
    ])

    const copy = await duplicateFoodItem(user, stubCentral(), recipe.id)
    assertDetail(copy)

    expect(copy.item.name).toBe('Garlic oil (copy)')
    expect(copy.item.is_composite).toBe(true)
    expect(copy.ingredients ?? []).toHaveLength(2)
    expect((copy.ingredients ?? []).map((i) => i.row.ingredient_food_item_id).sort()).toEqual(
      [oil.id, garlic.id].sort(),
    )
    // 50 g oil × 9 + 10 g garlic × 1 = 450 + 10 = 460 kcal, cached on the row.
    expect(copy.derived_nutrients?.values.calories).toBe(460)
    expect((await getFoodItemById(user, copy.item.id))?.calories).toBe(460)

    // The copy's ingredient list is its own — shrinking it leaves the source intact.
    await setIngredients(user, copy.item.id, [
      { ingredient_food_item_id: oil.id, quantity: 50, sort_order: 0, unit: 'g' },
    ])
    const service = createFoodItemsService(stubCentral())
    const sourceDetail = await service.getDetail(user, recipe.id)
    assertDetail(sourceDetail)
    expect(sourceDetail.ingredients ?? []).toHaveLength(2)
  })

  test('recreates portions with fresh ids and remaps the default portion', async () => {
    const user = getTestUser()
    const source = await upsertFoodItem(user, {
      calories: 200,
      default_quantity: 100,
      default_unit: 'g',
      name: 'Bread',
    })
    const portion = await insertFoodItemPortion(user, {
      base_equivalent: 35,
      food_item_id: source.id,
      label_unit: 'slice',
      sort_order: 0,
    })
    await updateFoodItem(user, source.id, { default_log_quantity: 2, default_portion_id: portion.id })

    const copy = await duplicateFoodItem(user, stubCentral(), source.id)
    assertDetail(copy)

    const copyPortions = await listPortionsForFoodItem(user, copy.item.id)
    expect(copyPortions).toHaveLength(1)
    expect(copyPortions[0].label_unit).toBe('slice')
    expect(copyPortions[0].base_equivalent).toBe(35)
    // Fresh id — not the source's portion id.
    expect(copyPortions[0].id).not.toBe(portion.id)
    // Default portion points at the copy's own portion, with the log quantity.
    expect(copy.item.default_portion_id).toBe(copyPortions[0].id)
    expect(copy.item.default_log_quantity).toBe(2)
  })

  test('copies sensitivity flag assignments', async () => {
    const user = getTestUser()
    const dairy = await insertSensitivityFlag(user, { name: 'Dairy' })
    const gluten = await insertSensitivityFlag(user, { name: 'Gluten' })
    const source = await upsertFoodItem(user, {
      calories: 300,
      default_quantity: 100,
      default_unit: 'g',
      name: 'Cheese bread',
    })
    await setFoodItemSensitivities(user, source.id, [dairy.id, gluten.id])

    const copy = await duplicateFoodItem(user, stubCentral(), source.id)
    assertDetail(copy)

    expect((copy.sensitivities ?? []).map((s) => s.id).sort()).toEqual([dairy.id, gluten.id].sort())
  })

  test('copies the reference pointer for atomic items', async () => {
    const user = getTestUser()
    const reference = await upsertFoodItem(user, {
      calories: 250,
      default_quantity: 100,
      default_unit: 'g',
      name: 'Canonical cheese',
      vitamin_c: 12,
    })
    const source = await upsertFoodItem(user, {
      calories: 260,
      default_quantity: 100,
      default_unit: 'g',
      name: 'My cheese',
    })
    await setFoodItemReference(user, source.id, reference.id)

    const copy = await duplicateFoodItem(user, stubCentral(), source.id)
    assertDetail(copy)

    expect(copy.reference?.food.id).toBe(reference.id)
    expect(copy.item.reference_food_item_id).toBe(reference.id)
  })

  test('dedupes the copy name so it never overwrites an existing item', async () => {
    const user = getTestUser()
    const source = await upsertFoodItem(user, {
      calories: 10,
      default_quantity: 100,
      default_unit: 'g',
      name: 'Sauce',
    })

    const first = await duplicateFoodItem(user, stubCentral(), source.id)
    const second = await duplicateFoodItem(user, stubCentral(), source.id)
    assertDetail(first)
    assertDetail(second)

    expect(first.item.name).toBe('Sauce (copy)')
    expect(second.item.name).toBe('Sauce (copy 2)')
    expect(second.item.id).not.toBe(first.item.id)
    // Three distinct rows now exist (source + two copies).
    expect(new Set([source.id, first.item.id, second.item.id]).size).toBe(3)
  })

  test('forks a central shared-library item into an editable per-user copy', async () => {
    const user = getTestUser()
    const central: SharedFoodItemEntity = {
      calories: 89,
      carbs: 23,
      created_at: new Date(),
      default_quantity: 100,
      default_unit: 'g',
      id: '99999999-9999-4999-8999-999999999999',
      name: 'Banana',
      name_lower: 'banana',
      source: 'livsmedelsverket',
      source_id: '123',
      updated_at: new Date(),
    } as unknown as SharedFoodItemEntity

    const copy = await duplicateFoodItem(user, stubCentral(central), central.id)
    assertDetail(copy)

    expect(copy.item.name).toBe('Banana (copy)')
    expect(copy.is_shared).toBe(false)
    expect(copy.item.source).toBe('manual')
    expect(copy.item.calories).toBe(89)
    expect(copy.item.carbs).toBe(23)
    // The fork is a real per-user row, editable directly.
    expect(await getFoodItemById(user, copy.item.id)).not.toBeNull()
  })

  test('returns null for an unknown source id', async () => {
    const user = getTestUser()
    const result = await duplicateFoodItem(user, stubCentral(), '00000000-0000-4000-8000-000000000000')
    expect(result).toBeNull()
  })
})
