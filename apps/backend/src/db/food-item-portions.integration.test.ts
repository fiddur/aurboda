import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  deleteFoodItemPortion,
  deletePortionsForFoodItem,
  getFoodItemPortionById,
  getPortionsByFoodItemIds,
  insertFoodItemPortion,
  listPortionsForFoodItem,
  updateFoodItemPortion,
} from './food-item-portions.ts'
import { deleteFoodItem, getFoodItemById, updateFoodItem, upsertFoodItem } from './food-items.ts'

const CONTAINER_TIMEOUT = 120_000

describe('food_item_portions integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('insert + list returns rows ordered by sort_order', async () => {
    const user = getTestUser()
    const food = await upsertFoodItem(user, { name: 'Choklad', default_quantity: 100, default_unit: 'g' })

    const rad = await insertFoodItemPortion(user, {
      food_item_id: food.id,
      label_unit: 'rad',
      base_equivalent: 13.6,
      sort_order: 1,
    })
    const ruta = await insertFoodItemPortion(user, {
      food_item_id: food.id,
      label_unit: 'ruta',
      base_equivalent: 3.4,
      sort_order: 0,
    })

    const list = await listPortionsForFoodItem(user, food.id)
    expect(list.map((p) => p.id)).toEqual([ruta.id, rad.id])
    expect(list[0].base_equivalent).toBe(3.4)
    expect(list[1].label_unit).toBe('rad')
  })

  test('update changes only provided fields', async () => {
    const user = getTestUser()
    const food = await upsertFoodItem(user, { name: 'Lantmjölk', default_quantity: 100, default_unit: 'g' })
    const inserted = await insertFoodItemPortion(user, {
      food_item_id: food.id,
      label_unit: 'glas',
      base_equivalent: 200,
    })

    const updated = await updateFoodItemPortion(user, inserted.id, { base_equivalent: 515 })
    expect(updated?.base_equivalent).toBe(515)
    expect(updated?.label_unit).toBe('glas')
    expect(updated?.updated_at.getTime()).toBeGreaterThanOrEqual(inserted.updated_at.getTime())
  })

  test('delete removes the row and clears default_portion_id pointer', async () => {
    const user = getTestUser()
    const food = await upsertFoodItem(user, { name: 'Wraps', default_quantity: 1, default_unit: 'wrap' })
    const portion = await insertFoodItemPortion(user, {
      food_item_id: food.id,
      label_unit: 'wrap',
      base_equivalent: 2,
    })
    // Set it as the food's default
    await updateFoodItem(user, food.id, { default_portion_id: portion.id })
    const before = await getFoodItemById(user, food.id)
    expect(before?.default_portion_id).toBe(portion.id)

    const deleted = await deleteFoodItemPortion(user, portion.id)
    expect(deleted).toBe(true)
    expect(await getFoodItemPortionById(user, portion.id)).toBeNull()
    const after = await getFoodItemById(user, food.id)
    expect(after?.default_portion_id).toBeUndefined()
  })

  test('getPortionsByFoodItemIds groups by food id', async () => {
    const user = getTestUser()
    const a = await upsertFoodItem(user, { name: 'A' })
    const b = await upsertFoodItem(user, { name: 'B' })
    const c = await upsertFoodItem(user, { name: 'C-no-portions' })
    await insertFoodItemPortion(user, {
      food_item_id: a.id,
      label_unit: 'x',
      base_equivalent: 1,
    })
    await insertFoodItemPortion(user, {
      food_item_id: b.id,
      label_unit: 'y',
      base_equivalent: 1,
    })
    await insertFoodItemPortion(user, {
      food_item_id: b.id,
      label_unit: 'y',
      base_equivalent: 2,
    })

    const map = await getPortionsByFoodItemIds(user, [a.id, b.id, c.id])
    expect(map.get(a.id)?.length).toBe(1)
    expect(map.get(b.id)?.length).toBe(2)
    expect(map.has(c.id)).toBe(false)
  })

  test('deleteFoodItem also cascade-deletes its portions', async () => {
    const user = getTestUser()
    const food = await upsertFoodItem(user, { name: 'Doomed', default_quantity: 1, default_unit: 'unit' })
    await insertFoodItemPortion(user, {
      food_item_id: food.id,
      label_unit: 'big',
      base_equivalent: 2,
    })

    await deleteFoodItem(user, food.id)

    const remaining = await listPortionsForFoodItem(user, food.id)
    expect(remaining).toEqual([])
  })

  test('deletePortionsForFoodItem returns count and removes rows', async () => {
    const user = getTestUser()
    const food = await upsertFoodItem(user, { name: 'Bulk' })
    await insertFoodItemPortion(user, {
      food_item_id: food.id,
      label_unit: 'a',
      base_equivalent: 1,
    })
    await insertFoodItemPortion(user, {
      food_item_id: food.id,
      label_unit: 'b',
      base_equivalent: 2,
    })
    const removed = await deletePortionsForFoodItem(user, food.id)
    expect(removed).toBe(2)
    expect(await listPortionsForFoodItem(user, food.id)).toEqual([])
  })
})
