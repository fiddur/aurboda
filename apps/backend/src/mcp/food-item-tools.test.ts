import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { FoodItemEntity } from '../db/types.ts'
import type { CentralDb } from '../services/central-db.ts'
import type { SharedFoodItemEntity } from '../services/central-food-items.ts'
import type { McpServer } from './helpers.ts'

import { registerFoodItemTools } from './food-item-tools.ts'

vi.mock('../db/index.ts', () => ({
  clearIngredients: vi.fn(),
  deleteFoodItem: vi.fn(),
  getFoodItemById: vi.fn(),
  listFoodItems: vi.fn(),
  setFoodItemReference: vi.fn(),
  setIngredients: vi.fn(),
  updateFoodItem: vi.fn(),
  upsertFoodItem: vi.fn(),
}))

vi.mock('../db/food-items.ts', () => ({
  findOrCreateFoodItem: vi.fn(),
  getFoodItemById: vi.fn(),
  getFoodItemByName: vi.fn(),
  mergeFoodItems: vi.fn(),
  searchFoodItems: vi.fn(),
}))

vi.mock('../db/food-item-ingredients.ts', () => ({
  getIngredients: vi.fn().mockResolvedValue([]),
}))

vi.mock('../services/meals.ts', () => ({
  resnapshotMealsForFoodItem: vi.fn(),
}))

const dbBarrel = await import('../db/index.ts')
const dbFoodItems = await import('../db/food-items.ts')

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

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>

/** Build a fake MCP server that captures registered tools by name so tests can invoke them directly. */
const buildFakeServer = (): { server: McpServer; tools: Map<string, ToolHandler> } => {
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _desc: string, _shape: unknown, handler: ToolHandler) => {
      tools.set(name, handler)
    },
  } as unknown as McpServer
  return { server, tools }
}

const callTool = async (handler: ToolHandler, params: Record<string, unknown>) => {
  const result = await handler(params)
  return result.content[0].text
}

describe('MCP set_food_item_reference', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const refId = '22222222-2222-4222-8222-222222222222'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('rejects when self item is not found', async () => {
    setUserFoodItem(async () => null)
    const central = fakeCentral()
    vi.mocked(central.getSharedFoodItemById).mockResolvedValue(null)
    const { server, tools } = buildFakeServer()
    registerFoodItemTools(server, 'tester', central)

    const text = await callTool(tools.get('set_food_item_reference')!, {
      id,
      reference_food_item_id: refId,
    })
    expect(text).toMatch(/not found/i)
  })

  test('rejects when self resolves to a central shared library row', async () => {
    setUserFoodItem(async () => null)
    const central = fakeCentral()
    vi.mocked(central.getSharedFoodItemById).mockResolvedValue(sharedItem('shared'))
    const { server, tools } = buildFakeServer()
    registerFoodItemTools(server, 'tester', central)

    const text = await callTool(tools.get('set_food_item_reference')!, {
      id,
      reference_food_item_id: refId,
    })
    expect(text).toMatch(/shared library/i)
  })

  test('rejects self-reference', async () => {
    setUserFoodItem(async (_u, fid) => (fid === id ? userItem(id) : null))
    const { server, tools } = buildFakeServer()
    registerFoodItemTools(server, 'tester', fakeCentral())

    const text = await callTool(tools.get('set_food_item_reference')!, {
      id,
      reference_food_item_id: id,
    })
    expect(text).toMatch(/cannot reference itself/i)
  })

  test('rejects when self is composite', async () => {
    setUserFoodItem(async (_u, fid) => (fid === id ? userItem(id, { is_composite: true }) : null))
    const { server, tools } = buildFakeServer()
    registerFoodItemTools(server, 'tester', fakeCentral())

    const text = await callTool(tools.get('set_food_item_reference')!, {
      id,
      reference_food_item_id: refId,
    })
    expect(text).toMatch(/composite/i)
  })

  test('rejects when reference target does not exist', async () => {
    setUserFoodItem(async (_u, fid) => (fid === id ? userItem(id) : null))
    const central = fakeCentral()
    vi.mocked(central.getSharedFoodItemById).mockResolvedValue(null)
    const { server, tools } = buildFakeServer()
    registerFoodItemTools(server, 'tester', central)

    const text = await callTool(tools.get('set_food_item_reference')!, {
      id,
      reference_food_item_id: refId,
    })
    expect(text).toMatch(/reference food item not found/i)
  })

  test('rejects when reference target is itself a composite', async () => {
    setUserFoodItem(async (_u, fid) => {
      if (fid === id) return userItem(id)
      if (fid === refId) return userItem(refId, { is_composite: true })
      return null
    })
    const { server, tools } = buildFakeServer()
    registerFoodItemTools(server, 'tester', fakeCentral())

    const text = await callTool(tools.get('set_food_item_reference')!, {
      id,
      reference_food_item_id: refId,
    })
    expect(text).toMatch(/composite recipe/i)
  })

  test('sets reference on success and returns enriched detail', async () => {
    const self = userItem(id, { reference_food_item_id: refId })
    const ref = sharedItem(refId, { name: 'Ref' })
    setUserFoodItem(async (_u, fid) => (fid === id ? self : null))
    vi.mocked(dbBarrel.setFoodItemReference).mockResolvedValue(self)
    const central = fakeCentral()
    vi.mocked(central.getSharedFoodItemById).mockResolvedValue(ref)
    const { server, tools } = buildFakeServer()
    registerFoodItemTools(server, 'tester', central)

    const text = await callTool(tools.get('set_food_item_reference')!, {
      id,
      reference_food_item_id: refId,
    })
    const json = JSON.parse(text) as { success: boolean; data?: { reference?: { food: { id: string } } } }
    expect(json.success).toBe(true)
    expect(json.data?.reference?.food.id).toBe(refId)
    expect(dbBarrel.setFoodItemReference).toHaveBeenCalledWith('tester', id, refId)
  })

  test('clears reference when reference_food_item_id is null', async () => {
    const self = userItem(id)
    setUserFoodItem(async (_u, fid) => (fid === id ? self : null))
    vi.mocked(dbBarrel.setFoodItemReference).mockResolvedValue(self)
    const { server, tools } = buildFakeServer()
    registerFoodItemTools(server, 'tester', fakeCentral())

    const text = await callTool(tools.get('set_food_item_reference')!, {
      id,
      reference_food_item_id: null,
    })
    const json = JSON.parse(text) as { success: boolean }
    expect(json.success).toBe(true)
    expect(dbBarrel.setFoodItemReference).toHaveBeenCalledWith('tester', id, null)
  })
})

describe('MCP resnapshot_meals_for_food_item', () => {
  const id = '11111111-1111-4111-8111-111111111111'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns the counts on success', async () => {
    const meals = await import('../services/meals.ts')
    vi.mocked(meals.resnapshotMealsForFoodItem).mockResolvedValue({ meals_updated: 2, rows_updated: 4 })

    const { server, tools } = buildFakeServer()
    registerFoodItemTools(server, 'tester', fakeCentral())
    const text = await callTool(tools.get('resnapshot_meals_for_food_item')!, { id })
    const json = JSON.parse(text) as {
      success: boolean
      data: { meals_updated: number; rows_updated: number }
    }
    expect(json.success).toBe(true)
    expect(json.data).toEqual({ meals_updated: 2, rows_updated: 4 })
    expect(meals.resnapshotMealsForFoodItem).toHaveBeenCalledWith('tester', id)
  })

  test('surfaces "Food item not found" as an error response', async () => {
    const meals = await import('../services/meals.ts')
    vi.mocked(meals.resnapshotMealsForFoodItem).mockRejectedValue(new Error('Food item not found'))

    const { server, tools } = buildFakeServer()
    registerFoodItemTools(server, 'tester', fakeCentral())
    const text = await callTool(tools.get('resnapshot_meals_for_food_item')!, { id })
    expect(text).toMatch(/not found/i)
  })
})
