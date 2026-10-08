import { describe, expect, test, vi } from 'vitest'

import type { RouteOps } from '../services/routes.ts'
import type { McpServer } from './helpers.ts'

import { registerRouteTools } from './route-tools.ts'

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>

const route = {
  activity_count: 3,
  activity_type: 'running',
  canonical_activity_id: null,
  created_at: '2026-06-01T07:00:00.000Z',
  end: { lat: 59.31, lon: 18.08 },
  id: 'r1',
  last_activity_at: '2026-06-08T07:00:00.000Z',
  length_m: 2000,
  name: 'Route · 2.0 km',
  start: { lat: 59.3, lon: 18.07 },
  updated_at: '2026-06-01T07:00:00.000Z',
}

const setup = (overrides: Partial<RouteOps> = {}) => {
  const ops: RouteOps = {
    detail: vi.fn(async () => null),
    list: vi.fn(async () => [route]),
    match: vi.fn(async () => ({ created: 1, matched: 2 })),
    merge: vi.fn(async () => ({ moved: 4, route })),
    remove: vi.fn(async () => true),
    rename: vi.fn(async () => ({ ...route, name: 'Hill loop' })),
    ...overrides,
  }
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _desc: string, _shape: unknown, handler: ToolHandler) => tools.set(name, handler),
  } as unknown as McpServer
  registerRouteTools(server, 'alice', ops)
  const call = async (name: string, params: Record<string, unknown> = {}) =>
    (await tools.get(name)!(params)).content[0]!.text
  return { call, ops, tools }
}

describe('route MCP tools', () => {
  test('registers the route tools', () => {
    expect([...setup().tools.keys()].sort()).toEqual([
      'delete_route',
      'get_route',
      'list_routes',
      'match_routes',
      'merge_routes',
      'update_route',
    ])
  })

  test('list_routes and match_routes return the ops results for the user', async () => {
    const { call, ops } = setup()
    expect(JSON.parse(await call('list_routes', { tz: 'UTC' })).data[0].name).toBe('Route · 2.0 km')
    expect(JSON.parse(await call('match_routes'))).toEqual({
      data: { created: 1, matched: 2 },
      success: true,
    })
    expect(ops.list).toHaveBeenCalledWith('alice')
    expect(ops.match).toHaveBeenCalledWith('alice')
  })

  test('get_route reports an unknown route', async () => {
    const { call } = setup()
    expect(await call('get_route', { id: 'r9', tz: 'UTC' })).toBe('Route not found')
  })

  test('update_route, merge_routes and delete_route pass their arguments through', async () => {
    const { call, ops } = setup()
    expect(JSON.parse(await call('update_route', { id: 'r1', name: 'Hill loop' })).data.name).toBe(
      'Hill loop',
    )
    expect(ops.rename).toHaveBeenCalledWith('alice', 'r1', 'Hill loop')

    expect(JSON.parse(await call('merge_routes', { id: 'r1', source_route_id: 'r2' })).data.moved).toBe(4)
    expect(ops.merge).toHaveBeenCalledWith('alice', 'r1', 'r2')

    expect(JSON.parse(await call('delete_route', { id: 'r1' }))).toEqual({ success: true })
  })

  test('delete_route and merge_routes report a missing route', async () => {
    const { call } = setup({ merge: vi.fn(async () => null), remove: vi.fn(async () => false) })
    expect(await call('delete_route', { id: 'r1' })).toBe('Route not found')
    expect(await call('merge_routes', { id: 'r1', source_route_id: 'r2' })).toBe('Route not found')
  })
})
