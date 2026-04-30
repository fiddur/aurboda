import { describe, expect, test, vi } from 'vitest'

import type { FoodItemEntity } from '../db/types.ts'
import type { CentralDb } from './central-db.ts'
import type { SharedFoodItemEntity } from './central-food-items.ts'

import { aggregateNutrientsFromIngredients, createFoodItemsService } from './food-items.ts'

vi.mock('../db/food-items.ts', () => ({
  findOrCreateFoodItem: vi.fn(),
  getFoodItemById: vi.fn(),
  getFoodItemByName: vi.fn(),
  searchFoodItems: vi.fn(),
}))

vi.mock('../db/food-item-ingredients.ts', () => ({
  getIngredients: vi.fn().mockResolvedValue([]),
}))

const dbModule = await import('../db/food-items.ts')
const ingredientsModule = await import('../db/food-item-ingredients.ts')

const userItem = (id: string, name: string): FoodItemEntity =>
  ({
    created_at: new Date(),
    id,
    name,
    name_lower: name.toLowerCase(),
    source: 'manual',
    updated_at: new Date(),
  }) as unknown as FoodItemEntity

const sharedItem = (id: string, name: string): SharedFoodItemEntity =>
  ({
    created_at: new Date(),
    id,
    name,
    name_lower: name.toLowerCase(),
    source: 'livsmedelsverket',
    source_id: '1',
    updated_at: new Date(),
  }) as unknown as SharedFoodItemEntity

const fakeCentral = (): CentralDb =>
  ({
    getSharedFoodItemById: vi.fn().mockResolvedValue(null),
    getSharedFoodItemByName: vi.fn().mockResolvedValue(null),
    listSharedFoodItems: vi.fn().mockResolvedValue([]),
    searchSharedFoodItems: vi.fn().mockResolvedValue([]),
    upsertSharedFoodItem: vi.fn(),
  }) as unknown as CentralDb

describe('createFoodItemsService.search', () => {
  test('user items rank first, then central, capped at limit', async () => {
    vi.mocked(dbModule.searchFoodItems).mockResolvedValue([
      userItem('u1', "Mom's Hushållsost"),
      userItem('u2', 'Hushållsost (homemade)'),
    ])
    const central = fakeCentral()
    vi.mocked(central.searchSharedFoodItems).mockResolvedValue([
      sharedItem('c1', 'Hushållsost'),
      sharedItem('c2', 'Hushållsost, lättversion'),
    ])
    const service = createFoodItemsService(central)

    const results = await service.search('user', 'hushallsost', 3)
    expect(results.map((r) => r.id)).toEqual(['u1', 'u2', 'c1'])
  })

  test('returns just central when user has no matches', async () => {
    vi.mocked(dbModule.searchFoodItems).mockResolvedValue([])
    const central = fakeCentral()
    vi.mocked(central.searchSharedFoodItems).mockResolvedValue([sharedItem('c1', 'Banana')])
    const service = createFoodItemsService(central)

    const results = await service.search('user', 'banana')
    expect(results.map((r) => r.id)).toEqual(['c1'])
  })
})

describe('createFoodItemsService.getById', () => {
  test('returns user item when found', async () => {
    vi.mocked(dbModule.getFoodItemById).mockResolvedValue(userItem('u1', 'Apple'))
    const central = fakeCentral()
    const service = createFoodItemsService(central)

    const result = await service.getById('user', 'u1')
    expect(result?.id).toBe('u1')
    expect(central.getSharedFoodItemById).not.toHaveBeenCalled()
  })

  test('falls back to central when not in user DB', async () => {
    vi.mocked(dbModule.getFoodItemById).mockResolvedValue(null)
    const central = fakeCentral()
    vi.mocked(central.getSharedFoodItemById).mockResolvedValue(sharedItem('c1', 'Hushållsost'))
    const service = createFoodItemsService(central)

    const result = await service.getById('user', 'c1')
    expect(result?.id).toBe('c1')
    expect(result?.source).toBe('livsmedelsverket')
  })

  test('returns null when neither store has the id', async () => {
    vi.mocked(dbModule.getFoodItemById).mockResolvedValue(null)
    const central = fakeCentral()
    const service = createFoodItemsService(central)

    expect(await service.getById('user', 'missing')).toBeNull()
  })
})

describe('createFoodItemsService.findOrCreate', () => {
  test('prefers central canonical entry over creating a per-user duplicate', async () => {
    const central = fakeCentral()
    vi.mocked(central.getSharedFoodItemByName).mockResolvedValue(sharedItem('c1', 'Apple'))
    const service = createFoodItemsService(central)

    const result = await service.findOrCreate('user', 'Apple')
    expect(result.id).toBe('c1')
    expect(dbModule.findOrCreateFoodItem).not.toHaveBeenCalled()
  })

  test('falls back to existing user item when central has no match', async () => {
    const central = fakeCentral()
    vi.mocked(central.getSharedFoodItemByName).mockResolvedValue(null)
    vi.mocked(dbModule.getFoodItemByName).mockResolvedValue(userItem('u1', "Mom's pancakes"))
    const service = createFoodItemsService(central)

    const result = await service.findOrCreate('user', "Mom's pancakes")
    expect(result.id).toBe('u1')
    expect(dbModule.findOrCreateFoodItem).not.toHaveBeenCalled()
  })

  test('creates a new per-user item when neither store has it', async () => {
    const central = fakeCentral()
    vi.mocked(central.getSharedFoodItemByName).mockResolvedValue(null)
    vi.mocked(dbModule.getFoodItemByName).mockResolvedValue(null)
    vi.mocked(dbModule.findOrCreateFoodItem).mockResolvedValue(userItem('u-new', 'Brand new food'))
    const service = createFoodItemsService(central)

    const result = await service.findOrCreate('user', 'Brand new food', { default_quantity: 50 })
    expect(result.id).toBe('u-new')
    expect(dbModule.findOrCreateFoodItem).toHaveBeenCalledWith('user', 'Brand new food', {
      default_quantity: 50,
    })
  })
})

describe('createFoodItemsService.getByName', () => {
  test('user wins over central when both have the name', async () => {
    vi.mocked(dbModule.getFoodItemByName).mockResolvedValue(userItem('u1', 'Apple'))
    const central = fakeCentral()
    const service = createFoodItemsService(central)

    const result = await service.getByName('user', 'Apple')
    expect(result?.id).toBe('u1')
    expect(central.getSharedFoodItemByName).not.toHaveBeenCalled()
  })

  test('falls back to central', async () => {
    vi.mocked(dbModule.getFoodItemByName).mockResolvedValue(null)
    const central = fakeCentral()
    vi.mocked(central.getSharedFoodItemByName).mockResolvedValue(sharedItem('c1', 'Hushållsost'))
    const service = createFoodItemsService(central)

    const result = await service.getByName('user', 'Hushållsost')
    expect(result?.id).toBe('c1')
  })
})

describe('aggregateNutrientsFromIngredients', () => {
  test('sums each nutrient field across ingredients × per-ingredient scale', () => {
    const coffee = userItem('coffee', 'Coffee')
    const oil = userItem('oil', 'Coconut oil')
    // Coffee: 100 ml default, 2 kcal/100ml
    coffee.default_quantity = 100
    coffee.default_unit = 'ml'
    coffee.calories = 2
    // Oil: 100 g default, 900 kcal/100 g
    oil.default_quantity = 100
    oil.default_unit = 'g'
    oil.calories = 900
    oil.fat = 100

    const { values, nutrient_data_incomplete } = aggregateNutrientsFromIngredients([
      {
        food: coffee,
        row: {
          created_at: new Date(),
          id: 'r1',
          ingredient_food_item_id: 'coffee',
          parent_food_item_id: 'p',
          quantity: 500,
          sort_order: 0,
          unit: 'ml',
          updated_at: new Date(),
        },
      },
      {
        food: oil,
        row: {
          created_at: new Date(),
          id: 'r2',
          ingredient_food_item_id: 'oil',
          parent_food_item_id: 'p',
          quantity: 15,
          sort_order: 1,
          unit: 'g',
          updated_at: new Date(),
        },
      },
    ])

    // 500ml × 2 kcal/100ml + 15 g × 900 kcal/100 g = 10 + 135 = 145 kcal
    expect(values.calories).toBe(145)
    // 15 g × 100 g fat / 100 g = 15 g fat
    expect(values.fat).toBe(15)
    expect(nutrient_data_incomplete).toBe(false)
  })

  test('flags nutrient_data_incomplete when an ingredient lacks calories', () => {
    const incomplete = userItem('x', 'X')
    incomplete.default_quantity = 1
    incomplete.default_unit = 'g'
    // no calories field set

    const { nutrient_data_incomplete } = aggregateNutrientsFromIngredients([
      {
        food: incomplete,
        row: {
          created_at: new Date(),
          id: 'r1',
          ingredient_food_item_id: 'x',
          parent_food_item_id: 'p',
          quantity: 1,
          sort_order: 0,
          unit: 'g',
          updated_at: new Date(),
        },
      },
    ])
    expect(nutrient_data_incomplete).toBe(true)
  })

  test('flags incomplete when an ingredient could not be resolved', () => {
    const { nutrient_data_incomplete, values } = aggregateNutrientsFromIngredients([
      {
        food: null,
        row: {
          created_at: new Date(),
          id: 'r1',
          ingredient_food_item_id: 'missing',
          parent_food_item_id: 'p',
          quantity: 1,
          sort_order: 0,
          unit: 'g',
          updated_at: new Date(),
        },
      },
    ])
    expect(nutrient_data_incomplete).toBe(true)
    expect(values).toEqual({})
  })
})

describe('wouldCreateCycle', () => {
  test('rejects direct self-reference', async () => {
    const central = fakeCentral()
    const service = createFoodItemsService(central)
    expect(await service.wouldCreateCycle('user', 'A', ['A', 'B'])).toBe(true)
  })

  test('rejects transitive cycle A → B → A', async () => {
    // B has A as one of its ingredients; trying to add B as ingredient of A.
    vi.mocked(ingredientsModule.getIngredients).mockImplementation(async (_user, parent) => {
      if (parent === 'B') {
        return [
          {
            created_at: new Date(),
            id: 'i1',
            ingredient_food_item_id: 'A',
            parent_food_item_id: 'B',
            quantity: 1,
            sort_order: 0,
            unit: undefined,
            updated_at: new Date(),
          },
        ]
      }
      return []
    })

    const service = createFoodItemsService(fakeCentral())
    expect(await service.wouldCreateCycle('user', 'A', ['B'])).toBe(true)
  })

  test('passes for an acyclic graph', async () => {
    vi.mocked(ingredientsModule.getIngredients).mockResolvedValue([])
    const service = createFoodItemsService(fakeCentral())
    expect(await service.wouldCreateCycle('user', 'A', ['B', 'C'])).toBe(false)
  })
})

describe('aggregateNutrientsFromIngredients — scaling edge cases', () => {
  const buildRow = (qty: number, unit: string | undefined) => ({
    created_at: new Date(),
    id: 'r',
    ingredient_food_item_id: 'x',
    parent_food_item_id: 'p',
    quantity: qty,
    sort_order: 0,
    unit,
    updated_at: new Date(),
  })

  test('converts dimensionally-compatible units (dl ↔ ml) instead of falling back', () => {
    const coffee = userItem('coffee', 'Coffee')
    coffee.default_quantity = 100
    coffee.default_unit = 'ml'
    coffee.calories = 2

    // 5 dl = 500 ml → 5 × (2 kcal / 100 ml) × 100 ml = 10 kcal
    const { values, nutrient_data_incomplete } = aggregateNutrientsFromIngredients([
      { food: coffee, row: buildRow(5, 'dl') },
    ])
    expect(values.calories).toBe(10)
    expect(nutrient_data_incomplete).toBe(false)
  })

  test('flags incomplete when ingredient unit is dimensionally incompatible with default_unit', () => {
    const oil = userItem('oil', 'Oil')
    oil.default_quantity = 100
    oil.default_unit = 'g'
    oil.calories = 900

    // "1 ml" against "100 g default" — different dimensions, no conversion possible.
    const { nutrient_data_incomplete } = aggregateNutrientsFromIngredients([
      { food: oil, row: buildRow(1, 'ml') },
    ])
    expect(nutrient_data_incomplete).toBe(true)
  })

  test('flags incomplete when default_quantity is missing or zero', () => {
    const food = userItem('x', 'X')
    food.default_unit = 'g'
    food.calories = 100
    // default_quantity left undefined

    const { nutrient_data_incomplete } = aggregateNutrientsFromIngredients([{ food, row: buildRow(50, 'g') }])
    expect(nutrient_data_incomplete).toBe(true)
  })

  test('mass conversion (kg → g)', () => {
    const flour = userItem('flour', 'Flour')
    flour.default_quantity = 100
    flour.default_unit = 'g'
    flour.calories = 360

    // 0.5 kg = 500 g → 5 × 360 = 1800 kcal
    const { values, nutrient_data_incomplete } = aggregateNutrientsFromIngredients([
      { food: flour, row: buildRow(0.5, 'kg') },
    ])
    expect(values.calories).toBe(1800)
    expect(nutrient_data_incomplete).toBe(false)
  })
})

describe('createFoodItemsService.getDetail — reference enrichment', () => {
  test('returns plain detail when no reference is set', async () => {
    const item = userItem('u1', 'Plain')
    item.calories = 50
    vi.mocked(dbModule.getFoodItemById).mockResolvedValue(item)
    vi.mocked(ingredientsModule.getIngredients).mockResolvedValue([])
    const service = createFoodItemsService(fakeCentral())

    const detail = await service.getDetail('user', 'u1')
    expect(detail?.item.id).toBe('u1')
    expect(detail?.reference).toBeUndefined()
    expect(detail?.reference_enriched).toBeUndefined()
  })

  test('emits per-field origin info: self wins, reference fills empty (scaled by serving)', async () => {
    // Self: 30 g serving, has its own calories + protein, missing iron + vitamin_c.
    const self = userItem('u1', 'Arla Hushållsost')
    self.default_quantity = 30
    self.default_unit = 'g'
    self.calories = 90
    self.protein = 8
    // Reference (LSV): 100 g serving, full micros.
    const reference = sharedItem('c1', 'Hushållsost')
    reference.default_quantity = 100
    reference.default_unit = 'g'
    reference.calories = 350
    reference.iron = 0.4 // mg/100 g
    reference.vitamin_c = 1.5
    self.reference_food_item_id = 'c1'

    vi.mocked(dbModule.getFoodItemById).mockImplementation(async (_user, id) => {
      if (id === 'u1') return self
      return null
    })
    const central = fakeCentral()
    vi.mocked(central.getSharedFoodItemById).mockImplementation(async (id) => {
      return id === 'c1' ? reference : null
    })
    vi.mocked(ingredientsModule.getIngredients).mockResolvedValue([])

    const detail = await createFoodItemsService(central).getDetail('user', 'u1')
    expect(detail?.reference?.food.id).toBe('c1')
    expect(detail?.reference?.unit_mismatch).toBe(false)
    const fields = detail?.reference_enriched?.fields ?? {}
    // Self values stay self.
    expect(fields.calories).toEqual({ origin: 'self', value: 90 })
    expect(fields.protein).toEqual({ origin: 'self', value: 8 })
    // Empty self fields filled from reference, scaled by 30/100 = 0.3.
    expect(fields.iron).toEqual({ origin: 'reference', value: 0.12 })
    expect(fields.vitamin_c).toEqual({ origin: 'reference', value: 0.45 })
  })

  test('flags unit_mismatch and emits unscaled values when units differ dimensionally', async () => {
    const self = userItem('u1', 'Slice')
    self.default_quantity = 1
    self.default_unit = 'slice' // not in conversion table
    const reference = sharedItem('c1', 'Bread')
    reference.default_quantity = 100
    reference.default_unit = 'g'
    reference.calories = 250
    self.reference_food_item_id = 'c1'

    vi.mocked(dbModule.getFoodItemById).mockImplementation(async (_user, id) => (id === 'u1' ? self : null))
    const central = fakeCentral()
    vi.mocked(central.getSharedFoodItemById).mockResolvedValue(reference)
    vi.mocked(ingredientsModule.getIngredients).mockResolvedValue([])

    const detail = await createFoodItemsService(central).getDetail('user', 'u1')
    expect(detail?.reference?.unit_mismatch).toBe(true)
    // Unscaled: 250 stays 250 (× 1).
    expect(detail?.reference_enriched?.fields.calories).toEqual({ origin: 'reference', value: 250 })
  })

  test('composite items take precedence over reference enrichment', async () => {
    const self = userItem('u1', 'Recipe')
    self.is_composite = true
    self.reference_food_item_id = 'c1'
    vi.mocked(dbModule.getFoodItemById).mockResolvedValue(self)
    vi.mocked(ingredientsModule.getIngredients).mockResolvedValue([])

    const detail = await createFoodItemsService(fakeCentral()).getDetail('user', 'u1')
    expect(detail?.reference).toBeUndefined()
    expect(detail?.reference_enriched).toBeUndefined()
  })
})
