/**
 * Integration tests for the food-item portions service layer.
 *
 * Covers the food-existence check (per-user OR central), the
 * default-portion-must-belong-to-this-food guard, and the cross-food
 * resilience of update/delete.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { CentralDb } from './central-db.ts'

import { getFoodItemById, upsertFoodItem } from '../db/food-items.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  addPortion,
  deletePortion,
  listPortions,
  setDefaultPortion,
  updatePortion,
} from './food-item-portions.ts'

const CONTAINER_TIMEOUT = 120_000

const stubCentral = (sharedById: Record<string, { id: string; name: string }> = {}): CentralDb =>
  ({
    getSharedFoodItemById: async (id: string) => sharedById[id] ?? null,
    getSharedFoodItemByName: async () => null,
    listSharedFoodItems: async () => [],
    searchSharedFoodItems: async () => [],
    upsertSharedFoodItem: async () => undefined,
  }) as unknown as CentralDb

describe('food-item-portions service integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('addPortion attaches to a per-user food', async () => {
    const user = getTestUser()
    const food = await upsertFoodItem(user, { name: 'Choklad', default_quantity: 100, default_unit: 'g' })
    const portion = await addPortion(
      user,
      food.id,
      { label_quantity: 1, label_unit: 'ruta', base_equivalent: 3.4 },
      stubCentral(),
    )
    expect(portion.food_item_id).toBe(food.id)
    expect(portion.base_equivalent).toBe(3.4)

    const list = await listPortions(user, food.id)
    expect(list.map((p) => p.id)).toEqual([portion.id])
  })

  test('addPortion accepts a central food id (soft pointer)', async () => {
    const user = getTestUser()
    const central = { id: '11111111-2222-3333-4444-555555555555', name: 'LSV Mjölk' }
    const portion = await addPortion(
      user,
      central.id,
      { label_quantity: 1, label_unit: 'cup', base_equivalent: 240 },
      stubCentral({ [central.id]: central }),
    )
    expect(portion.food_item_id).toBe(central.id)
  })

  test('addPortion rejects unknown food id', async () => {
    const user = getTestUser()
    const ghostId = '99999999-0000-0000-0000-000000000000'
    await expect(
      addPortion(user, ghostId, { label_quantity: 1, label_unit: 'x', base_equivalent: 1 }, stubCentral()),
    ).rejects.toThrow(/not found/i)
  })

  test('updatePortion / deletePortion work end-to-end', async () => {
    const user = getTestUser()
    const food = await upsertFoodItem(user, { name: 'Wraps', default_quantity: 1, default_unit: 'wrap' })
    const portion = await addPortion(
      user,
      food.id,
      { label_quantity: 2, label_unit: 'wrap', base_equivalent: 2 },
      stubCentral(),
    )

    const updated = await updatePortion(user, portion.id, { label_quantity: 3, base_equivalent: 3 })
    expect(updated.label_quantity).toBe(3)
    expect(updated.base_equivalent).toBe(3)

    expect(await deletePortion(user, portion.id)).toBe(true)
    expect(await listPortions(user, food.id)).toEqual([])
  })

  test('setDefaultPortion: rejects portion belonging to a different food', async () => {
    const user = getTestUser()
    const foodA = await upsertFoodItem(user, { name: 'Food A', default_quantity: 100, default_unit: 'g' })
    const foodB = await upsertFoodItem(user, { name: 'Food B', default_quantity: 100, default_unit: 'g' })
    const portionA = await addPortion(
      user,
      foodA.id,
      { label_quantity: 1, label_unit: 'piece', base_equivalent: 50 },
      stubCentral(),
    )
    await expect(setDefaultPortion(user, foodB.id, portionA.id)).rejects.toThrow(/does not belong/i)
  })

  test('setDefaultPortion: sets and clears via null', async () => {
    const user = getTestUser()
    const food = await upsertFoodItem(user, { name: 'Choklad', default_quantity: 100, default_unit: 'g' })
    const portion = await addPortion(
      user,
      food.id,
      { label_quantity: 1, label_unit: 'rad', base_equivalent: 13.6 },
      stubCentral(),
    )

    await setDefaultPortion(user, food.id, portion.id)
    expect((await getFoodItemById(user, food.id))?.default_portion_id).toBe(portion.id)

    await setDefaultPortion(user, food.id, null)
    expect((await getFoodItemById(user, food.id))?.default_portion_id).toBeUndefined()
  })

  test('setDefaultPortion: central food id is rejected as not-editable', async () => {
    const user = getTestUser()
    const central = { id: '22222222-3333-4444-5555-666666666666', name: 'LSV Choklad' }
    const portion = await addPortion(
      user,
      central.id,
      { label_quantity: 1, label_unit: 'ruta', base_equivalent: 3.4 },
      stubCentral({ [central.id]: central }),
    )
    // updateFoodItem only touches the per-user table, so the central id won't
    // match any row and the service surfaces "not found or not editable".
    await expect(setDefaultPortion(user, central.id, portion.id)).rejects.toThrow(/not found|not editable/i)
  })
})
