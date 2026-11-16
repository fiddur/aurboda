import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { getTestDbClient, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  ALTER_SHARED_FOOD_ITEMS_COLUMNS,
  createSharedFoodItemsApi,
  CREATE_SHARED_FOOD_ITEMS_INDEXES,
  CREATE_SHARED_FOOD_ITEMS_TABLE,
} from './central-food-items.ts'

const CONTAINER_TIMEOUT = 120_000

describe('central shared_food_items', () => {
  beforeAll(async () => {
    await startTestDb()
    const client = getTestDbClient()
    await client.query(CREATE_SHARED_FOOD_ITEMS_TABLE)
    for (const stmt of ALTER_SHARED_FOOD_ITEMS_COLUMNS) await client.query(stmt)
    for (const stmt of CREATE_SHARED_FOOD_ITEMS_INDEXES) await client.query(stmt)
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await getTestDbClient().query('TRUNCATE TABLE shared_food_items')
  })

  const api = () => createSharedFoodItemsApi(async () => getTestDbClient())

  test('upsertSharedFoodItem inserts a new row', async () => {
    const item = await api().upsertSharedFoodItem({
      calories: 656,
      default_quantity: 100,
      default_unit: 'g',
      fat: 70.5,
      name: 'Nöt talg',
      source: 'livsmedelsverket',
      source_id: '1',
    })
    expect(item.id).toBeDefined()
    expect(item.name).toBe('Nöt talg')
    expect(item.source_id).toBe('1')
    expect(item.calories).toBe(656)
  })

  test('upsertSharedFoodItem updates on (source, source_id) conflict', async () => {
    const first = await api().upsertSharedFoodItem({
      calories: 100,
      name: 'Apple',
      source: 'livsmedelsverket',
      source_id: '42',
    })
    // LSV ships a renamed version with new nutrient values — same source_id.
    const second = await api().upsertSharedFoodItem({
      calories: 105,
      name: 'Apple, raw',
      source: 'livsmedelsverket',
      source_id: '42',
    })
    expect(second.id).toBe(first.id) // same row, refreshed
    expect(second.name).toBe('Apple, raw')
    expect(second.calories).toBe(105)
  })

  test('searchSharedFoodItems matches accent-folded substrings + trigram fuzzy', async () => {
    const a = api()
    await a.upsertSharedFoodItem({ name: 'Hushållsost', source: 'livsmedelsverket', source_id: '10' })
    await a.upsertSharedFoodItem({ name: 'Mjölk', source: 'livsmedelsverket', source_id: '11' })
    await a.upsertSharedFoodItem({ name: 'Banana', source: 'livsmedelsverket', source_id: '12' })

    // Diacritic-folded substring.
    const cheese = await a.searchSharedFoodItems('hushallsost')
    expect(cheese.map((r) => r.name)).toContain('Hushållsost')

    // Fuzzy / typo.
    const fuzzy = await a.searchSharedFoodItems('hushalsost')
    expect(fuzzy.map((r) => r.name)).toContain('Hushållsost')
  })

  test('getSharedFoodItemByName is case-insensitive', async () => {
    await api().upsertSharedFoodItem({
      name: 'Banana',
      source: 'livsmedelsverket',
      source_id: '12',
    })
    const found = await api().getSharedFoodItemByName('BANANA')
    expect(found?.name).toBe('Banana')
  })

  test('getSharedFoodItemsBySourceIds finds rows by (source, source_id)', async () => {
    const a = api()
    const apple = await a.upsertSharedFoodItem({ name: 'Apple', source: 'livsmedelsverket', source_id: '1' })
    await a.upsertSharedFoodItem({ name: 'Pear', source: 'livsmedelsverket', source_id: '2' })
    await a.upsertSharedFoodItem({ name: 'Plum', source: 'usda', source_id: '1' })
    const found = await a.getSharedFoodItemsBySourceIds([
      { source: 'livsmedelsverket', source_id: '1' },
      { source: 'livsmedelsverket', source_id: '99' },
    ])
    expect(found.map((item) => item.id)).toEqual([apple.id])
    expect(await a.getSharedFoodItemsBySourceIds([])).toEqual([])
  })

  test('listSharedFoodItems returns rows alphabetically', async () => {
    const a = api()
    await a.upsertSharedFoodItem({ name: 'Cherry', source: 'livsmedelsverket', source_id: 'c' })
    await a.upsertSharedFoodItem({ name: 'Apple', source: 'livsmedelsverket', source_id: 'a' })
    await a.upsertSharedFoodItem({ name: 'Banana', source: 'livsmedelsverket', source_id: 'b' })
    const list = await a.listSharedFoodItems()
    expect(list.map((r) => r.name)).toEqual(['Apple', 'Banana', 'Cherry'])
  })

  test('the added columns apply to a table created before them, idempotently', async () => {
    const client = getTestDbClient()
    for (const column of ['default_log_quantity', 'nutrient_data_incomplete', 'last_fetched_at']) {
      await client.query(`ALTER TABLE shared_food_items DROP COLUMN ${column}`)
    }
    for (const stmt of ALTER_SHARED_FOOD_ITEMS_COLUMNS) await client.query(stmt)
    for (const stmt of ALTER_SHARED_FOOD_ITEMS_COLUMNS) await client.query(stmt)
    const item = await api().upsertSharedFoodItem({
      name: 'Apple',
      source: 'livsmedelsverket',
      source_id: '1',
    })
    expect(item.nutrient_data_incomplete).toBe(false)
    expect(item.last_fetched_at).toBeUndefined()
    expect(item.default_log_quantity).toBeUndefined()
  })

  test('an Open Food Facts row keeps its fetch time, quality flag and serving, and refreshes on re-upsert', async () => {
    const a = api()
    const fetchedAt = new Date('2026-08-01T10:00:00Z')
    const first = await a.upsertSharedFoodItem({
      calories: 120,
      default_log_quantity: 45,
      default_quantity: 100,
      default_unit: 'g',
      last_fetched_at: fetchedAt,
      name: 'Crunchy Bar (Acme)',
      nutrient_data_incomplete: true,
      source: 'openfoodfacts',
      source_id: '3017624010701',
    })
    expect(first.nutrient_data_incomplete).toBe(true)
    expect(first.last_fetched_at?.toISOString()).toBe(fetchedAt.toISOString())
    expect(first.default_log_quantity).toBe(45)

    const refreshedAt = new Date('2026-11-15T10:00:00Z')
    const second = await a.upsertSharedFoodItem({
      calories: 120,
      carbs: 20,
      fat: 3,
      last_fetched_at: refreshedAt,
      name: 'Crunchy Bar (Acme)',
      nutrient_data_incomplete: false,
      protein: 4,
      source: 'openfoodfacts',
      source_id: '3017624010701',
    })
    expect(second.id).toBe(first.id)
    expect(second.nutrient_data_incomplete).toBe(false)
    expect(second.last_fetched_at?.toISOString()).toBe(refreshedAt.toISOString())

    const [byBarcode] = await a.getSharedFoodItemsBySourceIds([
      { source: 'openfoodfacts', source_id: '3017624010701' },
    ])
    expect(byBarcode.id).toBe(first.id)
  })

  test('a cached Open Food Facts product shows up in name search like any shared item', async () => {
    const a = api()
    await a.upsertSharedFoodItem({ name: 'Mjölk', source: 'livsmedelsverket', source_id: '11' })
    await a.upsertSharedFoodItem({
      calories: 539,
      last_fetched_at: new Date(),
      name: 'Nutella (Ferrero)',
      source: 'openfoodfacts',
      source_id: '3017624010701',
    })
    const hits = await a.searchSharedFoodItems('nutella')
    expect(hits.map((r) => [r.name, r.source])).toEqual([['Nutella (Ferrero)', 'openfoodfacts']])
  })
})
