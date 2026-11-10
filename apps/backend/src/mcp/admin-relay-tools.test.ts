import { describe, expect, test, vi } from 'vitest'

import type { CentralDb } from '../services/central-db.ts'
import type { RelayActions } from '../services/relays.ts'
import type { McpServer } from './helpers.ts'

import { registerAdminRelayTools } from './admin-relay-tools.ts'

type ToolHandler = (
  params: Record<string, unknown>,
) => Promise<{ content: { text: string }[]; isError?: boolean }>

const RELAY_URL = 'https://tags.pub/user/_____relay_____/inbox'
const record = {
  actor_uri: null,
  created_at: new Date('2026-11-10T00:00:00Z'),
  follow_activity_id: 'https://aurboda.example/actor/follows/11111111-1111-4111-8111-111111111111',
  id: '11111111-1111-4111-8111-111111111111',
  inbox_uri: RELAY_URL,
  last_error: null,
  state: 'pending' as const,
  style: 'mastodon' as const,
  updated_at: new Date('2026-11-10T00:00:00Z'),
  url: RELAY_URL,
}

const setup = (isAdmin: boolean) => {
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _desc: string, _shape: unknown, handler: ToolHandler) => {
      tools.set(name, handler)
    },
  } as unknown as McpServer
  const relays: RelayActions = {
    add: vi.fn(async () => ({ ok: true as const, record })),
    list: vi.fn(async () => []),
    remove: vi.fn(async () => true),
  }
  const centralDb = { isAdmin: vi.fn(async () => isAdmin) } as unknown as CentralDb
  registerAdminRelayTools(server, 'fiddur', centralDb, relays)
  const call = async (name: string, params: Record<string, unknown> = {}) => {
    const handler = tools.get(name)
    if (handler == null) throw new Error(`no tool ${name}`)
    return handler(params)
  }
  return { call, relays, tools }
}

describe('admin relay tools', () => {
  test('registers list_relays, add_relay and remove_relay', () => {
    expect([...setup(true).tools.keys()].sort()).toEqual(['add_relay', 'list_relays', 'remove_relay'])
  })

  test('refuses every tool to a non-admin without touching the relays', async () => {
    const { call, relays } = setup(false)
    for (const [name, params] of [
      ['list_relays', {}],
      ['add_relay', { style: 'mastodon', url: RELAY_URL }],
      ['remove_relay', { id: record.id }],
    ] as const) {
      const result = await call(name, params)
      expect(result.content[0].text).toContain('Admin permission required')
    }
    expect(relays.list).not.toHaveBeenCalled()
    expect(relays.add).not.toHaveBeenCalled()
    expect(relays.remove).not.toHaveBeenCalled()
  })

  test('add_relay adds a relay and returns it serialised', async () => {
    const { call, relays } = setup(true)
    const result = await call('add_relay', { style: 'mastodon', url: RELAY_URL })
    expect(relays.add).toHaveBeenCalledWith({ style: 'mastodon', url: RELAY_URL })
    const body = JSON.parse(result.content[0].text) as { success: boolean; relay: Record<string, unknown> }
    expect(body.success).toBe(true)
    expect(body.relay).toMatchObject({
      created_at: '2026-11-10T00:00:00.000Z',
      id: record.id,
      state: 'pending',
    })
    expect(body.relay.follow_activity_id).toBeUndefined()
  })
})
