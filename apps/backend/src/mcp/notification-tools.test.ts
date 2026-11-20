import { describe, expect, test } from 'vitest'

import type { NotificationStore } from '../services/notifications.ts'
import type { WebPush } from '../services/web-push.ts'
import type { McpServer } from './helpers.ts'

import { registerNotificationTools } from './notification-tools.ts'

type ToolHandler = (
  params: Record<string, unknown>,
) => Promise<{ content: { text: string }[]; isError?: boolean }>

const ID = '11111111-1111-4111-8111-111111111111'
const SUBSCRIPTION = {
  browser: 'Chrome on Windows',
  created_at: '2026-11-01T10:00:00.000Z',
  current: false,
  id: ID,
  last_success_at: null,
}

const setup = (webPush?: Partial<WebPush>) => {
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _desc: string, _shape: unknown, handler: ToolHandler) => {
      tools.set(name, handler)
    },
  } as unknown as McpServer
  const removed: string[] = []
  const fullWebPush: WebPush = {
    config: async () => ({ enabled: true, public_key: 'pub' }),
    deliverNotification: async () => ({ failed: 0, reached: 0, removed: 0 }),
    enabled: true,
    list: async () => [SUBSCRIPTION],
    remove: async (_user, id) => {
      removed.push(id)
      return id === ID
    },
    sendTest: async () => ({ reached: 2, total: 3 }),
    subscribe: async () => ({ status: 'disabled' }),
    ...webPush,
  }
  registerNotificationTools(server, 'alice', async () => false, {
    store: {} as NotificationStore,
    webPush: webPush === undefined ? undefined : fullWebPush,
  })
  const call = async (name: string, params: Record<string, unknown> = {}) => {
    const handler = tools.get(name)
    if (handler == null) throw new Error(`no tool ${name}`)
    return handler(params)
  }
  return { call, removed, tools }
}

describe('push subscription tools', () => {
  test('are registered only with browser push wired in', () => {
    expect(setup().tools.has('list_push_subscriptions')).toBe(false)
    const names = [...setup({}).tools.keys()]
    expect(names).toEqual(
      expect.arrayContaining(['list_push_subscriptions', 'delete_push_subscription', 'send_test_push']),
    )
  })

  test('list_push_subscriptions lists the browsers', async () => {
    const result = await setup({}).call('list_push_subscriptions')
    expect(JSON.parse(result.content[0]!.text)).toEqual({ subscriptions: [SUBSCRIPTION], success: true })
  })

  test('delete_push_subscription removes one and errors on an unknown or malformed id', async () => {
    const { call, removed } = setup({})
    expect(JSON.parse((await call('delete_push_subscription', { id: ID })).content[0]!.text)).toEqual({
      success: true,
    })
    const unknown = await call('delete_push_subscription', { id: '22222222-2222-4222-8222-222222222222' })
    expect(unknown.isError).toBe(true)
    const malformed = await call('delete_push_subscription', { id: 'nope' })
    expect(malformed.isError).toBe(true)
    expect(removed).toEqual([ID, '22222222-2222-4222-8222-222222222222'])
  })

  test('send_test_push answers the counts, and errors when push is off', async () => {
    expect(JSON.parse((await setup({}).call('send_test_push')).content[0]!.text)).toEqual({
      reached: 2,
      success: true,
      total: 3,
    })
    const off = await setup({ sendTest: async () => null }).call('send_test_push')
    expect(off.isError).toBe(true)
  })
})
