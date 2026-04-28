import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import {
  createSharedFoodItemsApi,
  CREATE_SHARED_FOOD_ITEMS_INDEXES,
  CREATE_SHARED_FOOD_ITEMS_TABLE,
} from './central-food-items.ts'
import { getTestDbClient, startTestDb, stopTestDb } from '../test/db-test-helper.ts'

const CONTAINER_TIMEOUT = 120_000

describe('central shared_food_items', () => {
  beforeAll(async () => {
    await startTestDb()
    const client = getTestDbClient()
    await client.query(CREATE_SHARED_FOOD_ITEMS_TABLE)
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

  test('listSharedFoodItems returns rows alphabetically', async () => {
    const a = api()
    await a.upsertSharedFoodItem({ name: 'Cherry', source: 'livsmedelsverket', source_id: 'c' })
    await a.upsertSharedFoodItem({ name: 'Apple', source: 'livsmedelsverket', source_id: 'a' })
    await a.upsertSharedFoodItem({ name: 'Banana', source: 'livsmedelsverket', source_id: 'b' })
    const list = await a.listSharedFoodItems()
    expect(list.map((r) => r.name)).toEqual(['Apple', 'Banana', 'Cherry'])
  })
})
