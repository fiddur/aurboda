/**
 * Integration tests for the sensitivity flags + food-item junction.
 *
 * Covers CRUD on flags, soft-pointer assignment behaviour, batch lookup
 * (used at meal-snapshot time), and the cascade flows that food-item
 * delete + merge depend on.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { upsertFoodItem } from './food-items.ts'
import {
  deleteFoodItemSensitivities,
  deleteSensitivityFlag,
  getFoodItemSensitivities,
  getFoodItemSensitivityFlagIds,
  getFoodItemSensitivityNamesBatch,
  getSensitivityFlagByName,
  insertSensitivityFlag,
  listSensitivityFlags,
  mergeFoodItemSensitivities,
  setFoodItemSensitivities,
  updateSensitivityFlag,
} from './sensitivities.ts'

const CONTAINER_TIMEOUT = 120_000

describe('Sensitivity flags integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('flag CRUD', () => {
    test('inserts, lists in sort order then name, and looks up by name', async () => {
      const user = getTestUser()
      const dairy = await insertSensitivityFlag(user, { name: 'dairy', sort_order: 2 })
      const gluten = await insertSensitivityFlag(user, { name: 'gluten', sort_order: 1 })
      await insertSensitivityFlag(user, { name: 'alcohol', sort_order: 0 })

      const flags = await listSensitivityFlags(user)
      expect(flags.map((f) => f.name)).toEqual(['alcohol', 'gluten', 'dairy'])

      expect((await getSensitivityFlagByName(user, 'dairy'))?.id).toBe(dairy.id)
      expect((await getSensitivityFlagByName(user, 'gluten'))?.id).toBe(gluten.id)
      expect(await getSensitivityFlagByName(user, 'missing')).toBeNull()
    })

    test('rejects duplicate names with the unique_violation code', async () => {
      const user = getTestUser()
      await insertSensitivityFlag(user, { name: 'dairy' })
      await expect(insertSensitivityFlag(user, { name: 'dairy' })).rejects.toMatchObject({ code: '23505' })
    })

    test('updateSensitivityFlag patches fields, returns null for missing id', async () => {
      const user = getTestUser()
      const flag = await insertSensitivityFlag(user, { name: 'dairy' })
      const updated = await updateSensitivityFlag(user, flag.id, { color: '#ff0000' })
      expect(updated?.color).toBe('#ff0000')
      // Patching with empty body returns the unchanged row.
      const same = await updateSensitivityFlag(user, flag.id, {})
      expect(same?.id).toBe(flag.id)
      // Missing id surfaces as null (404 territory at the route).
      const missing = await updateSensitivityFlag(user, '00000000-0000-4000-8000-000000000000', {
        color: 'x',
      })
      expect(missing).toBeNull()
    })

    test('deleteSensitivityFlag cascades junction rows on the flag side', async () => {
      const user = getTestUser()
      const flag = await insertSensitivityFlag(user, { name: 'dairy' })
      const food = await upsertFoodItem(user, { name: 'Cheese' })
      await setFoodItemSensitivities(user, food.id, [flag.id])
      expect(await getFoodItemSensitivityFlagIds(user, food.id)).toEqual([flag.id])

      await deleteSensitivityFlag(user, flag.id)
      // ON DELETE CASCADE on the FK side: assignments are gone.
      expect(await getFoodItemSensitivityFlagIds(user, food.id)).toEqual([])
    })
  })

  describe('food-item assignment (junction)', () => {
    test('setFoodItemSensitivities replaces the full list each call', async () => {
      const user = getTestUser()
      const dairy = await insertSensitivityFlag(user, { name: 'dairy' })
      const gluten = await insertSensitivityFlag(user, { name: 'gluten' })
      const food = await upsertFoodItem(user, { name: 'Pizza' })

      await setFoodItemSensitivities(user, food.id, [dairy.id, gluten.id])
      const ids1 = await getFoodItemSensitivityFlagIds(user, food.id)
      expect(new Set(ids1)).toEqual(new Set([dairy.id, gluten.id]))

      // Replace with a single flag — gluten goes away.
      await setFoodItemSensitivities(user, food.id, [dairy.id])
      const ids2 = await getFoodItemSensitivityFlagIds(user, food.id)
      expect(ids2).toEqual([dairy.id])

      // Empty list clears all.
      await setFoodItemSensitivities(user, food.id, [])
      expect(await getFoodItemSensitivityFlagIds(user, food.id)).toEqual([])
    })

    test('getFoodItemSensitivities resolves full flag rows in sort order', async () => {
      const user = getTestUser()
      const dairy = await insertSensitivityFlag(user, { name: 'dairy', sort_order: 1 })
      const gluten = await insertSensitivityFlag(user, { name: 'gluten', sort_order: 0 })
      const food = await upsertFoodItem(user, { name: 'Bread' })
      await setFoodItemSensitivities(user, food.id, [dairy.id, gluten.id])

      const resolved = await getFoodItemSensitivities(user, food.id)
      expect(resolved.map((f) => f.name)).toEqual(['gluten', 'dairy'])
    })

    test('getFoodItemSensitivityNamesBatch keys by food id', async () => {
      const user = getTestUser()
      const dairy = await insertSensitivityFlag(user, { name: 'dairy' })
      const gluten = await insertSensitivityFlag(user, { name: 'gluten' })
      const a = await upsertFoodItem(user, { name: 'Cheese' })
      const b = await upsertFoodItem(user, { name: 'Bread' })
      await setFoodItemSensitivities(user, a.id, [dairy.id])
      await setFoodItemSensitivities(user, b.id, [dairy.id, gluten.id])

      const unrelatedId = '99999999-9999-4999-8999-999999999999'
      const map = await getFoodItemSensitivityNamesBatch(user, [a.id, b.id, unrelatedId])
      expect(map.get(a.id)).toEqual(['dairy'])
      expect(new Set(map.get(b.id))).toEqual(new Set(['dairy', 'gluten']))
      expect(map.has(unrelatedId)).toBe(false)
    })

    test('deleteFoodItemSensitivities drops every junction row for the food item', async () => {
      const user = getTestUser()
      const dairy = await insertSensitivityFlag(user, { name: 'dairy' })
      const food = await upsertFoodItem(user, { name: 'Cheese' })
      await setFoodItemSensitivities(user, food.id, [dairy.id])
      await deleteFoodItemSensitivities(user, food.id)
      expect(await getFoodItemSensitivityFlagIds(user, food.id)).toEqual([])
    })

    test('mergeFoodItemSensitivities unions source into target then drops source rows', async () => {
      const user = getTestUser()
      const dairy = await insertSensitivityFlag(user, { name: 'dairy' })
      const gluten = await insertSensitivityFlag(user, { name: 'gluten' })
      const alcohol = await insertSensitivityFlag(user, { name: 'alcohol' })
      const source = await upsertFoodItem(user, { name: 'Source' })
      const target = await upsertFoodItem(user, { name: 'Target' })

      // Source has dairy + gluten; target has gluten + alcohol. Expect the
      // union (dairy, gluten, alcohol) on target after merge — no dup rows.
      await setFoodItemSensitivities(user, source.id, [dairy.id, gluten.id])
      await setFoodItemSensitivities(user, target.id, [gluten.id, alcohol.id])

      await mergeFoodItemSensitivities(user, source.id, target.id)

      expect(await getFoodItemSensitivityFlagIds(user, source.id)).toEqual([])
      const targetIds = new Set(await getFoodItemSensitivityFlagIds(user, target.id))
      expect(targetIds).toEqual(new Set([dairy.id, gluten.id, alcohol.id]))
    })

    test('soft pointer accepts food-item ids that do not exist in food_items (central-row case)', async () => {
      const user = getTestUser()
      const dairy = await insertSensitivityFlag(user, { name: 'dairy' })
      // No FK on food_item_id, so an id that lives in the central library
      // (or simply doesn't exist locally) is allowed. This is the whole
      // point of the soft-pointer pattern.
      const fakeCentralId = '11111111-1111-4111-8111-111111111111'
      await setFoodItemSensitivities(user, fakeCentralId, [dairy.id])
      expect(await getFoodItemSensitivityFlagIds(user, fakeCentralId)).toEqual([dairy.id])
    })
  })
})
