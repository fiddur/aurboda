/**
 * Integration tests for the legacy → junction backfill that runs at startup.
 *
 * Drives `_backfillSensitivityFlags` (a re-export of the otherwise-private
 * helper in connection.ts) and asserts the two paths most likely to break:
 *   1. Idempotency — already-seeded tables are not clobbered on re-run.
 *   2. Per-user name resolution — entries that match `food_items.name_lower`
 *      become junction rows; entries that don't are skipped (typically
 *      central-library items, which need re-tagging via the new MCP tool).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestDbClient, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { _backfillSensitivityFlags, query } from './connection.ts'
import { upsertFoodItem } from './food-items.ts'
import { getFoodItemSensitivities, insertSensitivityFlag, listSensitivityFlags } from './sensitivities.ts'

const CONTAINER_TIMEOUT = 120_000

const seedSettings = async (settings: Record<string, unknown>): Promise<void> => {
  const db = getTestDbClient()
  await db.query(`DELETE FROM user_settings`)
  await db.query(`INSERT INTO user_settings (settings) VALUES ($1)`, [settings])
}

describe('backfillSensitivityFlags integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('skips when sensitivity_flags already has rows', async () => {
    const user = getTestUser()
    // Pre-seed the new table with one flag the user has been managing.
    await insertSensitivityFlag(user, { name: 'dairy' })
    // Legacy settings imply a different flag list — must be ignored.
    await seedSettings({
      sensitivity_areas: ['gluten', 'alcohol'],
      food_sensitivity_map: { Cheese: ['gluten'] },
    })

    await _backfillSensitivityFlags(getTestDbClient())

    const flags = await listSensitivityFlags(user)
    expect(flags.map((f) => f.name)).toEqual(['dairy'])
  })

  test('seeds flags from sensitivity_areas + food_sensitivity_map (union)', async () => {
    await seedSettings({
      sensitivity_areas: ['dairy', 'gluten'],
      food_sensitivity_map: { Cheese: ['dairy', 'red_meat'] },
    })

    await _backfillSensitivityFlags(getTestDbClient())

    const flags = await listSensitivityFlags(getTestUser())
    // `red_meat` only ever appears in the food map but still becomes a flag.
    expect(new Set(flags.map((f) => f.name))).toEqual(new Set(['dairy', 'gluten', 'red_meat']))
  })

  test('resolves food_sensitivity_map entries by case-insensitive name and creates junction rows', async () => {
    const user = getTestUser()
    const cheese = await upsertFoodItem(user, { name: 'Cheese' })
    await seedSettings({
      sensitivity_areas: ['dairy'],
      // Note the differing case — must match against name_lower.
      food_sensitivity_map: { CHEESE: ['dairy'] },
    })

    await _backfillSensitivityFlags(getTestDbClient())

    const flagsOnCheese = await getFoodItemSensitivities(user, cheese.id)
    expect(flagsOnCheese.map((f) => f.name)).toEqual(['dairy'])
  })

  test('skips food_sensitivity_map entries that do not resolve (central-library names)', async () => {
    const user = getTestUser()
    const cheese = await upsertFoodItem(user, { name: 'Cheese' })
    await seedSettings({
      sensitivity_areas: ['dairy'],
      food_sensitivity_map: {
        Cheese: ['dairy'], // resolves
        'Arla, Hushållsost': ['dairy'], // central-style name — no per-user row
      },
    })

    await _backfillSensitivityFlags(getTestDbClient())

    // Cheese got the assignment.
    expect((await getFoodItemSensitivities(user, cheese.id)).length).toBe(1)
    // Arla item was never resolved, so no orphan junction rows pointing at
    // ghost ids. Total junction rows = 1 (cheese only).
    const counts = await query(getTestDbClient(), `SELECT COUNT(*)::int AS c FROM food_item_sensitivities`)
    expect(counts.rows[0].c).toBe(1)
  })

  test('no-op when there is no user_settings row at all', async () => {
    const db = getTestDbClient()
    await db.query(`DELETE FROM user_settings`)
    await expect(_backfillSensitivityFlags(db)).resolves.toBeUndefined()
    expect((await listSensitivityFlags(getTestUser())).length).toBe(0)
  })

  test('no-op when settings has neither legacy key', async () => {
    await seedSettings({ unrelated: 'x' })
    await _backfillSensitivityFlags(getTestDbClient())
    expect((await listSensitivityFlags(getTestUser())).length).toBe(0)
  })
})
