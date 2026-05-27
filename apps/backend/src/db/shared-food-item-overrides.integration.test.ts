/**
 * Integration tests for per-user overrides on central shared_food_items.
 *
 * Verifies set/get/clear semantics against a real PostgreSQL — including
 * batch lookup (which the food-items service uses to merge overrides into
 * search results in one round-trip) and explicit-null icon (user wants no
 * icon, distinct from "no override applied").
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  clearSharedFoodItemOverride,
  getSharedFoodItemOverride,
  getSharedFoodItemOverridesByIds,
  setSharedFoodItemOverride,
} from './shared-food-item-overrides.ts'

const CONTAINER_TIMEOUT = 120_000

const sharedId1 = '11111111-1111-1111-1111-111111111111'
const sharedId2 = '22222222-2222-2222-2222-222222222222'

describe('shared_food_item_overrides integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('set + get round-trips an icon override', async () => {
    const user = getTestUser()
    const set = await setSharedFoodItemOverride(user, sharedId1, { icon: '🥩' })
    expect(set.icon).toBe('🥩')

    const got = await getSharedFoodItemOverride(user, sharedId1)
    expect(got?.icon).toBe('🥩')
    expect(got?.shared_food_item_id).toBe(sharedId1)
  })

  test('get returns null when no override exists', async () => {
    const user = getTestUser()
    expect(await getSharedFoodItemOverride(user, sharedId1)).toBeNull()
  })

  test('set upserts and bumps updated_at on second write', async () => {
    const user = getTestUser()
    const first = await setSharedFoodItemOverride(user, sharedId1, { icon: '🥩' })

    // Wait a tick so the timestamp comparison is robust.
    await new Promise((r) => setTimeout(r, 5))
    const second = await setSharedFoodItemOverride(user, sharedId1, { icon: '🥕' })

    expect(second.icon).toBe('🥕')
    expect(second.updated_at.getTime()).toBeGreaterThanOrEqual(first.updated_at.getTime())
  })

  test('null icon is a real "no icon" override, distinct from clear', async () => {
    const user = getTestUser()
    await setSharedFoodItemOverride(user, sharedId1, { icon: '🥩' })
    await setSharedFoodItemOverride(user, sharedId1, { icon: null })

    const got = await getSharedFoodItemOverride(user, sharedId1)
    expect(got).not.toBeNull()
    expect(got?.icon).toBeNull()
  })

  test('clear removes the row entirely', async () => {
    const user = getTestUser()
    await setSharedFoodItemOverride(user, sharedId1, { icon: '🥩' })
    expect(await clearSharedFoodItemOverride(user, sharedId1)).toBe(true)
    expect(await getSharedFoodItemOverride(user, sharedId1)).toBeNull()
    // Idempotent — clearing a missing row returns false but doesn't throw.
    expect(await clearSharedFoodItemOverride(user, sharedId1)).toBe(false)
  })

  test('batch lookup returns overrides for the requested ids only', async () => {
    const user = getTestUser()
    const unknownId = '99999999-9999-9999-9999-999999999999'
    await setSharedFoodItemOverride(user, sharedId1, { icon: '🥩' })
    await setSharedFoodItemOverride(user, sharedId2, { icon: '🥕' })

    const map = await getSharedFoodItemOverridesByIds(user, [sharedId1, sharedId2, unknownId])
    expect(map.size).toBe(2)
    expect(map.get(sharedId1)?.icon).toBe('🥩')
    expect(map.get(sharedId2)?.icon).toBe('🥕')
    expect(map.has(unknownId)).toBe(false)
  })

  test('batch lookup returns an empty map for an empty id list', async () => {
    const user = getTestUser()
    const map = await getSharedFoodItemOverridesByIds(user, [])
    expect(map.size).toBe(0)
  })

  test('rejects empty input — would otherwise silently hide central icon', async () => {
    const user = getTestUser()
    // Fresh row case: an empty set used to insert (icon=NULL, shared_food_item_id=...),
    // and the read path read that as "user picked no icon", erasing the central
    // icon. Reject the call instead — clear() is the explicit revert.
    await expect(setSharedFoodItemOverride(user, sharedId1, {})).rejects.toThrow(/at least one/i)
    expect(await getSharedFoodItemOverride(user, sharedId1)).toBeNull()
  })

  test('rejects empty input even when a row already exists', async () => {
    const user = getTestUser()
    await setSharedFoodItemOverride(user, sharedId1, { icon: '🥩' })
    await expect(setSharedFoodItemOverride(user, sharedId1, {})).rejects.toThrow(/at least one/i)
    // The pre-existing row is left untouched.
    const got = await getSharedFoodItemOverride(user, sharedId1)
    expect(got?.icon).toBe('🥩')
  })

  test('default_portion_id override round-trips independently of icon', async () => {
    const user = getTestUser()
    const portionId = '33333333-3333-3333-3333-333333333333'
    const set = await setSharedFoodItemOverride(user, sharedId1, { default_portion_id: portionId })
    expect(set.default_portion_id).toBe(portionId)
    expect(set.icon).toBeNull()
    // Setting an icon later must leave default_portion_id alone.
    const updated = await setSharedFoodItemOverride(user, sharedId1, { icon: '🥩' })
    expect(updated.icon).toBe('🥩')
    expect(updated.default_portion_id).toBe(portionId)
  })

  test('clearing default_portion_id (null) reverts to no override', async () => {
    const user = getTestUser()
    const portionId = '33333333-3333-3333-3333-333333333333'
    await setSharedFoodItemOverride(user, sharedId1, { default_portion_id: portionId })
    const cleared = await setSharedFoodItemOverride(user, sharedId1, { default_portion_id: null })
    expect(cleared.default_portion_id).toBeNull()
  })

  test('icon_overridden tracks whether the user supplied an icon value', async () => {
    const user = getTestUser()
    const portionId = '33333333-3333-3333-3333-333333333333'
    // Only default_portion_id → icon_overridden stays false.
    const a = await setSharedFoodItemOverride(user, sharedId1, { default_portion_id: portionId })
    expect(a.icon_overridden).toBe(false)
    expect(a.icon).toBeNull()
    // Setting icon=null (explicit hide) → icon_overridden flips to true.
    const b = await setSharedFoodItemOverride(user, sharedId1, { icon: null })
    expect(b.icon_overridden).toBe(true)
    expect(b.icon).toBeNull()
    // Setting an icon string → icon_overridden stays true.
    const c = await setSharedFoodItemOverride(user, sharedId1, { icon: '🥩' })
    expect(c.icon_overridden).toBe(true)
    expect(c.icon).toBe('🥩')
  })
})
