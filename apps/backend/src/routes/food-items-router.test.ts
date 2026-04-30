import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { FoodItemEntity } from '../db/types.ts'
import type { CentralDb } from '../services/central-db.ts'
import type { SharedFoodItemEntity } from '../services/central-food-items.ts'

import { createFoodItemsRouter } from './food-items-router.ts'

// The route imports from the barrel `../db/index.ts`; the food-items service
// imports directly from `../db/food-items.ts`. Both have to be mocked, and the
// `getFoodItemById` mocks in both paths must be kept in sync (the test helper
// `setSelf()` does that).
vi.mock('../db/index.ts', () => ({
  clearIngredients: vi.fn(),
  deleteFoodItem: vi.fn(),
  findCompositeParentsOfIngredient: vi.fn().mockResolvedValue([]),
  getFoodItemById: vi.fn(),
  getFoodItemSensitivities: vi.fn().mockResolvedValue([]),
  getFoodItemSensitivityNamesBatch: vi.fn().mockResolvedValue(new Map()),
  listFoodItems: vi.fn(),
  setFoodItemReference: vi.fn(),
  setFoodItemSensitivities: vi.fn(),
  setIngredients: vi.fn(),
  updateFoodItem: vi.fn(),
  upsertFoodItem: vi.fn(),
}))

vi.mock('../db/food-item-ingredients.ts', () => ({
  findCompositeParentsOfIngredient: vi.fn().mockResolvedValue([]),
  getIngredients: vi.fn().mockResolvedValue([]),
}))

vi.mock('../db/sensitivities.ts', () => ({
  getFoodItemSensitivities: vi.fn().mockResolvedValue([]),
  getFoodItemSensitivityNamesBatch: vi.fn().mockResolvedValue(new Map()),
  setFoodItemSensitivities: vi.fn(),
}))

vi.mock('../db/food-items.ts', () => ({
  findOrCreateFoodItem: vi.fn(),
  getFoodItemById: vi.fn(),
  getFoodItemByName: vi.fn(),
  mergeFoodItems: vi.fn(),
  searchFoodItems: vi.fn(),
}))

vi.mock('../services/meals.ts', () => ({
  resnapshotMealsForFoodItem: vi.fn(),
}))

const dbBarrel = await import('../db/index.ts')
const dbFoodItems = await import('../db/food-items.ts')

/** Set the mock return for both barrel and direct getFoodItemById lookups. */
const setUserFoodItem = (impl: (user: string, id: string) => Promise<FoodItemEntity | null>) => {
  vi.mocked(dbBarrel.getFoodItemById).mockImplementation(impl)
  vi.mocked(dbFoodItems.getFoodItemById).mockImplementation(impl)
}

const userItem = (id: string, overrides: Partial<FoodItemEntity> = {}): FoodItemEntity =>
  ({
    created_at: new Date(),
    id,
    name: id,
    name_lower: id.toLowerCase(),
    source: 'manual',
    updated_at: new Date(),
    ...overrides,
  }) as unknown as FoodItemEntity

const sharedItem = (id: string, overrides: Partial<SharedFoodItemEntity> = {}): SharedFoodItemEntity =>
  ({
    created_at: new Date(),
    id,
    name: id,
    name_lower: id.toLowerCase(),
    source: 'livsmedelsverket',
    source_id: '1',
    updated_at: new Date(),
    ...overrides,
  }) as unknown as SharedFoodItemEntity

const fakeCentral = (): CentralDb =>
  ({
    getSharedFoodItemById: vi.fn().mockResolvedValue(null),
    getSharedFoodItemByName: vi.fn().mockResolvedValue(null),
    listSharedFoodItems: vi.fn().mockResolvedValue([]),
    searchSharedFoodItems: vi.fn().mockResolvedValue([]),
    upsertSharedFoodItem: vi.fn(),
  }) as unknown as CentralDb

const buildApp = (centralDb: CentralDb) => {
  const app = express()
  app.use(express.json())
  // Stub auth middleware: always authenticate as 'tester'.
  const auth = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = 'tester'
    next()
  }
  app.use('/food-items', createFoodItemsRouter(auth, centralDb) as unknown as express.RequestHandler)
  return app
}

describe('PUT /food-items/:id/reference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('404 when self item is not found in user or central DB', async () => {
    setUserFoodItem(async () => null)
    const central = fakeCentral()
    vi.mocked(central.getSharedFoodItemById).mockResolvedValue(null)
    const res = await supertest(buildApp(central))
      .put('/food-items/11111111-1111-4111-8111-111111111111/reference')
      .send({ reference_food_item_id: '22222222-2222-4222-8222-222222222222' })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/i)
  })

  test('403 when self resolves to a central shared library row', async () => {
    setUserFoodItem(async () => null)
    const central = fakeCentral()
    vi.mocked(central.getSharedFoodItemById).mockResolvedValue(sharedItem('shared-1'))
    const res = await supertest(buildApp(central))
      .put('/food-items/11111111-1111-4111-8111-111111111111/reference')
      .send({ reference_food_item_id: '22222222-2222-4222-8222-222222222222' })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/shared library/i)
  })

  test('400 on self-reference', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    setUserFoodItem(async (_u, fid) => (fid === id ? userItem(id) : null))
    const res = await supertest(buildApp(fakeCentral()))
      .put(`/food-items/${id}/reference`)
      .send({ reference_food_item_id: id })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/cannot reference itself/i)
  })

  test('400 when self item is composite', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    setUserFoodItem(async (_u, fid) => (fid === id ? userItem(id, { is_composite: true }) : null))
    const res = await supertest(buildApp(fakeCentral()))
      .put(`/food-items/${id}/reference`)
      .send({ reference_food_item_id: '22222222-2222-4222-8222-222222222222' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/composite/i)
  })

  test('400 when reference target does not exist', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const refId = '22222222-2222-4222-8222-222222222222'
    setUserFoodItem(async (_u, fid) => (fid === id ? userItem(id) : null))
    const central = fakeCentral()
    vi.mocked(central.getSharedFoodItemById).mockResolvedValue(null)
    const res = await supertest(buildApp(central))
      .put(`/food-items/${id}/reference`)
      .send({ reference_food_item_id: refId })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/reference food item not found/i)
  })

  test('400 when reference target is itself a composite', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const refId = '22222222-2222-4222-8222-222222222222'
    setUserFoodItem(async (_u, fid) => {
      if (fid === id) return userItem(id)
      if (fid === refId) return userItem(refId, { is_composite: true })
      return null
    })
    const res = await supertest(buildApp(fakeCentral()))
      .put(`/food-items/${id}/reference`)
      .send({ reference_food_item_id: refId })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/composite recipe/i)
  })

  test('200 sets reference and returns enriched detail', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const refId = '22222222-2222-4222-8222-222222222222'
    const self = userItem(id, { reference_food_item_id: refId })
    const ref = sharedItem(refId, { name: 'Ref' })
    setUserFoodItem(async (_u, fid) => (fid === id ? self : null))
    vi.mocked(dbBarrel.setFoodItemReference).mockResolvedValue(self)
    const central = fakeCentral()
    vi.mocked(central.getSharedFoodItemById).mockResolvedValue(ref)

    const res = await supertest(buildApp(central))
      .put(`/food-items/${id}/reference`)
      .send({ reference_food_item_id: refId })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.reference?.food.id).toBe(refId)
    expect(dbBarrel.setFoodItemReference).toHaveBeenCalledWith('tester', id, refId)
  })

  test('400 on validation: malformed body (non-uuid)', async () => {
    const res = await supertest(buildApp(fakeCentral()))
      .put('/food-items/11111111-1111-4111-8111-111111111111/reference')
      .send({ reference_food_item_id: 'not-a-uuid' })
    expect(res.status).toBe(400)
  })
})

describe('DELETE /food-items/:id/reference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('404 when self item is not found', async () => {
    setUserFoodItem(async () => null)
    const central = fakeCentral()
    vi.mocked(central.getSharedFoodItemById).mockResolvedValue(null)
    const res = await supertest(buildApp(central)).delete(
      '/food-items/11111111-1111-4111-8111-111111111111/reference',
    )
    expect(res.status).toBe(404)
  })

  test('403 when self is a shared library item', async () => {
    setUserFoodItem(async () => null)
    const central = fakeCentral()
    vi.mocked(central.getSharedFoodItemById).mockResolvedValue(sharedItem('s1'))
    const res = await supertest(buildApp(central)).delete(
      '/food-items/11111111-1111-4111-8111-111111111111/reference',
    )
    expect(res.status).toBe(403)
  })

  test('200 clears the pointer', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const self = userItem(id)
    setUserFoodItem(async (_u, fid) => (fid === id ? self : null))
    vi.mocked(dbBarrel.setFoodItemReference).mockResolvedValue(self)
    const res = await supertest(buildApp(fakeCentral())).delete(`/food-items/${id}/reference`)
    expect(res.status).toBe(200)
    expect(dbBarrel.setFoodItemReference).toHaveBeenCalledWith('tester', id, null)
  })
})

describe('POST /food-items/:id/resnapshot-meals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('200 returns the meals/rows updated counts', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const meals = await import('../services/meals.ts')
    vi.mocked(meals.resnapshotMealsForFoodItem).mockResolvedValue({ meals_updated: 3, rows_updated: 5 })

    const res = await supertest(buildApp(fakeCentral())).post(`/food-items/${id}/resnapshot-meals`)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ meals_updated: 3, rows_updated: 5 })
    expect(meals.resnapshotMealsForFoodItem).toHaveBeenCalledWith('tester', id)
  })

  test('404 when the service throws "Food item not found"', async () => {
    const meals = await import('../services/meals.ts')
    vi.mocked(meals.resnapshotMealsForFoodItem).mockRejectedValue(new Error('Food item not found'))

    const res = await supertest(buildApp(fakeCentral())).post(
      '/food-items/11111111-1111-4111-8111-111111111111/resnapshot-meals',
    )
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/i)
  })

  test('500 on unexpected service errors', async () => {
    const meals = await import('../services/meals.ts')
    vi.mocked(meals.resnapshotMealsForFoodItem).mockRejectedValue(new Error('boom'))

    const res = await supertest(buildApp(fakeCentral())).post(
      '/food-items/11111111-1111-4111-8111-111111111111/resnapshot-meals',
    )
    expect(res.status).toBe(500)
  })
})

describe('PATCH /food-items/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns the full detail (not just the entity) so the UI cache keeps ingredients on rename', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const updated = userItem(id, { is_composite: true, name: 'Renamed Recipe' })
    setUserFoodItem(async (_u, fid) => (fid === id ? updated : null))
    vi.mocked(dbBarrel.updateFoodItem).mockResolvedValue(updated)
    // The composite branch of getDetail loads ingredients via getIngredients,
    // which we mock to return one row.
    const ingredientsModule = await import('../db/food-item-ingredients.ts')
    vi.mocked(ingredientsModule.getIngredients).mockResolvedValue([
      {
        created_at: new Date(),
        id: 'i1',
        ingredient_food_item_id: '22222222-2222-4222-8222-222222222222',
        parent_food_item_id: id,
        quantity: 50,
        sort_order: 0,
        unit: 'g',
        updated_at: new Date(),
      },
    ])

    const res = await supertest(buildApp(fakeCentral()))
      .patch(`/food-items/${id}`)
      .send({ name: 'Renamed Recipe' })

    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('Renamed Recipe')
    // Crucially: ingredients + derived_nutrients are present so the frontend
    // cache update doesn't strip them.
    expect(Array.isArray(res.body.data.ingredients)).toBe(true)
    expect(res.body.data.ingredients).toHaveLength(1)
    expect(res.body.data.derived_nutrients).toBeDefined()
  })
})
