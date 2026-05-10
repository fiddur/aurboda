/**
 * Integration tests for the per-user nutrient recommendation override table.
 *
 * Verifies upsert / list / get / clear roundtrips and the explicit-NULL
 * suppression semantics that distinguish "user wants no range" from "no
 * override applied".
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  clearUserNutrientRecommendation,
  getUserNutrientRecommendation,
  listUserNutrientRecommendations,
  upsertUserNutrientRecommendation,
} from './user-nutrient-recommendations.ts'

const CONTAINER_TIMEOUT = 120_000

describe('user_nutrient_recommendations integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('upsert + get round-trips both bounds', async () => {
    const user = getTestUser()
    const set = await upsertUserNutrientRecommendation(user, 'protein', {
      recommended_low: 80,
      recommended_high: 200,
    })
    expect(set.recommended_low).toBe(80)
    expect(set.recommended_high).toBe(200)

    const got = await getUserNutrientRecommendation(user, 'protein')
    expect(got?.recommended_low).toBe(80)
    expect(got?.recommended_high).toBe(200)
  })

  test('upsert with one bound preserves the other on update', async () => {
    const user = getTestUser()
    await upsertUserNutrientRecommendation(user, 'protein', {
      recommended_low: 80,
      recommended_high: 200,
    })
    // Only update the upper bound; lower stays at 80.
    const updated = await upsertUserNutrientRecommendation(user, 'protein', { recommended_high: 220 })
    expect(updated.recommended_low).toBe(80)
    expect(updated.recommended_high).toBe(220)
  })

  test('upsert with explicit null suppresses a bound', async () => {
    const user = getTestUser()
    await upsertUserNutrientRecommendation(user, 'salt', { recommended_high: 6 })
    const suppressed = await upsertUserNutrientRecommendation(user, 'salt', { recommended_high: null })
    expect(suppressed.recommended_high).toBeNull()
  })

  test('throws when neither bound is supplied', async () => {
    const user = getTestUser()
    await expect(upsertUserNutrientRecommendation(user, 'protein', {})).rejects.toThrow(/at least one bound/i)
  })

  test('clear removes the row, get returns null', async () => {
    const user = getTestUser()
    await upsertUserNutrientRecommendation(user, 'iron', { recommended_low: 8, recommended_high: 18 })

    const cleared = await clearUserNutrientRecommendation(user, 'iron')
    expect(cleared).toBe(true)
    expect(await getUserNutrientRecommendation(user, 'iron')).toBeNull()

    const clearedAgain = await clearUserNutrientRecommendation(user, 'iron')
    expect(clearedAgain).toBe(false)
  })

  test('list returns every override row', async () => {
    const user = getTestUser()
    await upsertUserNutrientRecommendation(user, 'protein', { recommended_low: 80 })
    await upsertUserNutrientRecommendation(user, 'iron', { recommended_high: 18 })

    const rows = await listUserNutrientRecommendations(user)
    expect(rows.map((r) => r.nutrient_name).sort()).toEqual(['iron', 'protein'])
  })
})
