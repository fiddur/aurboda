import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { NamedLocation } from '../services/locations.ts'
import type { McpServer } from './helpers.ts'

import { registerLocationTools } from './location-tools.ts'

vi.mock('../services/locations.ts', () => ({
  deleteNamedLocation: vi.fn(),
  getDetectedLocations: vi.fn(),
  getNamedLocations: vi.fn(),
  insertNamedLocation: vi.fn(),
  updateNamedLocation: vi.fn(),
}))

vi.mock('../db/index.ts', () => ({ getDetectedLocations: vi.fn() }))

const service = await import('../services/locations.ts')

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>

const buildTools = (onNamedLocationsChanged?: (user: string) => void): Map<string, ToolHandler> => {
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _desc: string, _shape: unknown, handler: ToolHandler) => {
      tools.set(name, handler)
    },
  } as unknown as McpServer
  registerLocationTools(server, 'tester', onNamedLocationsChanged)
  return tools
}

const home = { id: 'loc-1', lat: 59.33, lon: 18.07, name: 'Home', radius: 100 } as unknown as NamedLocation

describe('MCP location tools named-location change notification', () => {
  const onChanged = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(service.insertNamedLocation).mockResolvedValue(home)
  })

  test('add_named_location notifies once with the user', async () => {
    await buildTools(onChanged).get('add_named_location')!({
      lat: 59.33,
      lon: 18.07,
      name: 'Home',
      radius: 100,
    })

    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledWith('tester')
  })

  test('delete_named_location notifies once with the user', async () => {
    vi.mocked(service.deleteNamedLocation).mockResolvedValue(true)

    await buildTools(onChanged).get('delete_named_location')!({ id: 'loc-1' })

    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledWith('tester')
  })

  test('delete_named_location for a missing id does not notify', async () => {
    vi.mocked(service.deleteNamedLocation).mockResolvedValue(false)

    const result = await buildTools(onChanged).get('delete_named_location')!({ id: 'missing' })

    expect(JSON.parse(result.content[0].text).success).toBe(false)
    expect(onChanged).not.toHaveBeenCalled()
  })

  test('get_named_locations does not notify', async () => {
    vi.mocked(service.getNamedLocations).mockResolvedValue([home])

    await buildTools(onChanged).get('get_named_locations')!({})

    expect(onChanged).not.toHaveBeenCalled()
  })
})
