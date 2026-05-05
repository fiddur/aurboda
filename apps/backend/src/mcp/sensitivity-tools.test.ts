import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { FoodItemEntity } from '../db/types.ts'
import type { CentralDb } from '../services/central-db.ts'
import type { SharedFoodItemEntity } from '../services/central-food-items.ts'
import type { McpServer } from './helpers.ts'

import { registerSensitivityTools } from './sensitivity-tools.ts'

vi.mock('../db/index.ts', () => ({
  deleteSensitivityFlag: vi.fn(),
  getFoodItemById: vi.fn(),
  insertSensitivityFlag: vi.fn(),
  listSensitivityFlags: vi.fn(),
  setFoodItemSensitivities: vi.fn(),
  updateSensitivityFlag: vi.fn(),
}))

const dbBarrel = await import('../db/index.ts')

const userItem = (id: string): FoodItemEntity =>
  ({ id, name: 'x', name_lower: 'x', source: 'manual' }) as unknown as FoodItemEntity
const sharedItem = (id: string): SharedFoodItemEntity =>
  ({
    id,
    name: 'x',
    name_lower: 'x',
    source: 'livsmedelsverket',
    source_id: '1',
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

describe('MCP sensitivity-flag CRUD tools', () => {
  beforeEach(() => vi.clearAllMocks())

  test('list_sensitivity_flags returns the rows', async () => {
    vi.mocked(dbBarrel.listSensitivityFlags).mockResolvedValue([
      {
        id: 'a',
        name: 'dairy',
        color: undefined,
        icon: undefined,
        sort_order: 0,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ])
    const { server, tools } = buildFakeServer()
    registerSensitivityTools(server, 'tester', fakeCentral())
    const text = await callTool(tools.get('list_sensitivity_flags')!, {})
    expect(text).toMatch(/dairy/)
  })

  test('add_sensitivity_flag surfaces unique-name conflicts as an error', async () => {
    vi.mocked(dbBarrel.insertSensitivityFlag).mockRejectedValue(
      Object.assign(new Error('duplicate key'), { code: '23505' }),
    )
    const { server, tools } = buildFakeServer()
    registerSensitivityTools(server, 'tester', fakeCentral())
    const text = await callTool(tools.get('add_sensitivity_flag')!, { name: 'dairy' })
    expect(text).toMatch(/duplicate/i)
  })

  test('update_sensitivity_flag returns "not found" when the row is missing', async () => {
    vi.mocked(dbBarrel.updateSensitivityFlag).mockResolvedValue(null)
    const { server, tools } = buildFakeServer()
    registerSensitivityTools(server, 'tester', fakeCentral())
    const text = await callTool(tools.get('update_sensitivity_flag')!, {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'renamed',
    })
    expect(text).toMatch(/not found/i)
  })

  test('delete_sensitivity_flag returns "not found" when delete affects nothing', async () => {
    vi.mocked(dbBarrel.deleteSensitivityFlag).mockResolvedValue(false)
    const { server, tools } = buildFakeServer()
    registerSensitivityTools(server, 'tester', fakeCentral())
    const text = await callTool(tools.get('delete_sensitivity_flag')!, {
      id: '11111111-1111-4111-8111-111111111111',
    })
    expect(text).toMatch(/not found/i)
  })
})

describe('MCP set_food_item_sensitivities', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const flagId = '22222222-2222-4222-8222-222222222222'

  beforeEach(() => vi.clearAllMocks())

  test('rejects when the food item is in neither the user nor central library', async () => {
    vi.mocked(dbBarrel.getFoodItemById).mockResolvedValue(null)
    const central = fakeCentral()
    vi.mocked(central.getSharedFoodItemById).mockResolvedValue(null)
    const { server, tools } = buildFakeServer()
    registerSensitivityTools(server, 'tester', central)

    const text = await callTool(tools.get('set_food_item_sensitivities')!, {
      id,
      sensitivity_flag_ids: [flagId],
    })
    expect(text).toMatch(/not found/i)
  })

  test('per-user food item — succeeds and returns the new assignment', async () => {
    vi.mocked(dbBarrel.getFoodItemById).mockResolvedValue(userItem(id))
    const { server, tools } = buildFakeServer()
    registerSensitivityTools(server, 'tester', fakeCentral())

    const text = await callTool(tools.get('set_food_item_sensitivities')!, {
      id,
      sensitivity_flag_ids: [flagId],
    })
    const json = JSON.parse(text) as { success: boolean; data: { food_item_id: string } }
    expect(json.success).toBe(true)
    expect(json.data.food_item_id).toBe(id)
    expect(dbBarrel.setFoodItemSensitivities).toHaveBeenCalledWith('tester', id, [flagId])
  })

  test('central food item — also succeeds (the soft pointer makes this work)', async () => {
    vi.mocked(dbBarrel.getFoodItemById).mockResolvedValue(null)
    const central = fakeCentral()
    vi.mocked(central.getSharedFoodItemById).mockResolvedValue(sharedItem(id))
    const { server, tools } = buildFakeServer()
    registerSensitivityTools(server, 'tester', central)

    const text = await callTool(tools.get('set_food_item_sensitivities')!, {
      id,
      sensitivity_flag_ids: [flagId],
    })
    expect(text).toMatch(/"success": true/)
    expect(dbBarrel.setFoodItemSensitivities).toHaveBeenCalledWith('tester', id, [flagId])
  })

  test('clearing flags (empty array) is supported', async () => {
    vi.mocked(dbBarrel.getFoodItemById).mockResolvedValue(userItem(id))
    const { server, tools } = buildFakeServer()
    registerSensitivityTools(server, 'tester', fakeCentral())

    const text = await callTool(tools.get('set_food_item_sensitivities')!, {
      id,
      sensitivity_flag_ids: [],
    })
    expect(text).toMatch(/"success": true/)
    expect(dbBarrel.setFoodItemSensitivities).toHaveBeenCalledWith('tester', id, [])
  })
})
