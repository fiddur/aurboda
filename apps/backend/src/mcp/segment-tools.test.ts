import { describe, expect, test, vi } from 'vitest'

import type { SegmentOps } from '../services/segments.ts'
import type { SuggestedSegmentOps } from '../services/suggested-segments.ts'
import type { McpServer } from './helpers.ts'

import { registerSegmentTools } from './segment-tools.ts'

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>

const ACTIVITY_ID = '2f1c8a34-1f4e-4a2f-9d7c-6b1e5a0c3d21'

const segment = {
  activity_type: 'running',
  best_elapsed_s: 125,
  created_at: '2026-06-01T07:00:00.000Z',
  effort_count: 3,
  id: 's1',
  last_effort_at: '2026-06-08T07:00:00.000Z',
  length_m: 800,
  name: 'Segment · 0.8 km',
  updated_at: '2026-06-01T07:00:00.000Z',
}

const detail = {
  ...segment,
  created_from_activity_id: ACTIVITY_ID,
  created_from_route_id: null,
  efforts: [],
  near_named_location: { end: null, start: 'Home' },
  points: [],
}

const setup = (
  overrides: Partial<SegmentOps> = {},
  suggestedOverrides: Partial<SuggestedSegmentOps> = {},
) => {
  const ops: SegmentOps = {
    create: vi.fn(async () => ({ ok: true as const, segment: detail })),
    detail: vi.fn(async () => null),
    list: vi.fn(async () => [segment]),
    match: vi.fn(async () => ({ activities: 2, efforts: 3 })),
    remove: vi.fn(async () => true),
    rename: vi.fn(async () => ({ ...segment, name: 'The hill' })),
    ...overrides,
  }
  const suggestedOps: SuggestedSegmentOps = {
    dismiss: vi.fn(async () => true),
    list: vi.fn(async () => []),
    promote: vi.fn(async () => ({ ok: true as const, segment: detail })),
    scan: vi.fn(async () => ({ remaining: 2, scanned: 10, suggested: 1 })),
    ...suggestedOverrides,
  }
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _desc: string, _shape: unknown, handler: ToolHandler) => tools.set(name, handler),
  } as unknown as McpServer
  registerSegmentTools(server, 'alice', ops, suggestedOps)
  const call = async (name: string, params: Record<string, unknown> = {}) =>
    (await tools.get(name)!(params)).content[0]!.text
  return { call, ops, suggestedOps, tools }
}

describe('segment MCP tools', () => {
  test('registers the segment tools', () => {
    expect([...setup().tools.keys()].sort()).toEqual([
      'create_segment',
      'delete_segment',
      'dismiss_suggested_segment',
      'get_segment',
      'list_segments',
      'list_suggested_segments',
      'match_segment',
      'promote_suggested_segment',
      'scan_suggested_segments',
      'update_segment',
    ])
  })

  test('list_segments passes the type filter and sort order', async () => {
    const { call, ops } = setup()
    expect(JSON.parse(await call('list_segments', { sort: 'length', tz: 'UTC' })).data[0].name).toBe(
      'Segment · 0.8 km',
    )
    expect(ops.list).toHaveBeenCalledWith('alice', { activity_type: undefined, sort: 'length' })
  })

  test('get_segment reports an unknown segment and returns a known one', async () => {
    expect(await setup().call('get_segment', { id: 's9', tz: 'UTC' })).toBe('Segment not found')
    const known = setup({ detail: vi.fn(async () => detail) })
    expect(
      JSON.parse(await known.call('get_segment', { id: 's1', tz: 'UTC' })).data.near_named_location,
    ).toEqual({
      end: null,
      start: 'Home',
    })
  })

  test('create_segment validates the body like the REST route and reports a refused cut', async () => {
    const { call, ops } = setup()
    expect(await call('create_segment', { activity_id: ACTIVITY_ID, start_offset_s: 10 })).toBe(
      'activity_id, start_offset_s and end_offset_s must be given together',
    )
    expect(ops.create).not.toHaveBeenCalled()

    const body = { activity_id: ACTIVITY_ID, end_offset_s: 300, start_offset_s: 10 }
    expect(JSON.parse(await call('create_segment', body)).data.id).toBe('s1')
    expect(ops.create).toHaveBeenCalledWith('alice', body)

    const refused = setup({ create: vi.fn(async () => ({ error: 'too short', ok: false as const })) })
    expect(await refused.call('create_segment', body)).toBe('too short')
  })

  test('update_segment, delete_segment and match_segment pass their arguments through', async () => {
    const { call, ops } = setup()
    expect(JSON.parse(await call('update_segment', { id: 's1', name: 'The hill' })).data.name).toBe(
      'The hill',
    )
    expect(ops.rename).toHaveBeenCalledWith('alice', 's1', 'The hill')
    expect(JSON.parse(await call('delete_segment', { id: 's1' }))).toEqual({ success: true })
    expect(JSON.parse(await call('match_segment', { id: 's1' })).data).toEqual({ activities: 2, efforts: 3 })
    expect(ops.match).toHaveBeenCalledWith('alice', 's1')
  })

  test('the id tools report a missing segment', async () => {
    const { call } = setup({
      match: vi.fn(async () => null),
      remove: vi.fn(async () => false),
      rename: vi.fn(async () => null),
    })
    expect(await call('delete_segment', { id: 's1' })).toBe('Segment not found')
    expect(await call('match_segment', { id: 's1' })).toBe('Segment not found')
    expect(await call('update_segment', { id: 's1', name: 'x' })).toBe('Segment not found')
  })

  test('the suggested segment tools pass through, validate the trim and report a missing suggestion', async () => {
    const { call, suggestedOps } = setup()
    expect(JSON.parse(await call('list_suggested_segments', { tz: 'UTC' })).data).toEqual([])
    expect(JSON.parse(await call('scan_suggested_segments')).data).toEqual({
      remaining: 2,
      scanned: 10,
      suggested: 1,
    })

    expect(await call('promote_suggested_segment', { id: 'g1', start_km: 0.2 })).toBe(
      'start_km and end_km must be given together',
    )
    expect(suggestedOps.promote).not.toHaveBeenCalled()
    expect(
      JSON.parse(await call('promote_suggested_segment', { end_km: 1, id: 'g1', start_km: 0.2 })).data.id,
    ).toBe('s1')
    expect(suggestedOps.promote).toHaveBeenCalledWith('alice', 'g1', { end_km: 1, start_km: 0.2 })
    expect(JSON.parse(await call('dismiss_suggested_segment', { id: 'g1' }))).toEqual({ success: true })

    const missing = setup({}, { dismiss: vi.fn(async () => false), promote: vi.fn(async () => null) })
    expect(await missing.call('promote_suggested_segment', { id: 'g1' })).toBe(
      'No pending suggested segment with this ID',
    )
    expect(await missing.call('dismiss_suggested_segment', { id: 'g1' })).toBe(
      'No pending suggested segment with this ID',
    )
    const refused = setup({}, { promote: vi.fn(async () => ({ error: 'too short', ok: false as const })) })
    expect(await refused.call('promote_suggested_segment', { id: 'g1' })).toBe('too short')
  })
})
