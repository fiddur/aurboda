import { describe, expect, test, vi } from 'vitest'

import type { PostUpdateResender } from '../services/activitypub/post-update-resend.ts'
import type { CentralDb } from '../services/central-db.ts'
import type { McpServer } from './helpers.ts'

import { registerAdminFederationTools, registerFederationDeliveryTools } from './admin-federation-tools.ts'

type ToolHandler = () => Promise<{ content: { text: string }[] }>

const setup = (isAdmin: boolean, run: Awaited<ReturnType<PostUpdateResender['start']>>) => {
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _desc: string, _shape: unknown, handler: ToolHandler) => {
      tools.set(name, handler)
    },
  } as unknown as McpServer
  const postUpdates = { start: vi.fn(async () => run) }
  const centralDb = { isAdmin: vi.fn(async () => isAdmin) } as unknown as CentralDb
  registerAdminFederationTools(server, 'fiddur', centralDb, postUpdates)
  const call = () => {
    const handler = tools.get('resend_post_updates')
    if (handler == null) throw new Error('no tool resend_post_updates')
    return handler()
  }
  return { call, postUpdates }
}

describe('resend_post_updates', () => {
  test('starts a re-send and reports how many posts', async () => {
    const { call } = setup(true, { done: Promise.resolve(), posts: 4 })
    const result = await call()
    expect(JSON.parse(result.content[0].text)).toEqual({ posts: 4, success: true })
  })

  test('is an error while one is running', async () => {
    const result = await setup(true, null).call()
    expect(result.content[0].text).toBe('A re-send is already running')
  })

  test('is admin-only', async () => {
    const { call, postUpdates } = setup(false, { done: Promise.resolve(), posts: 4 })
    const result = await call()
    expect(result.content[0].text).toBe('Admin permission required')
    expect(postUpdates.start).not.toHaveBeenCalled()
  })
})

describe('list_federation_delivery_failures', () => {
  const failing = {
    failures: 3,
    first_failed_at: new Date('2026-11-14T10:00:00Z'),
    inbox_host: 'down.example',
    last_error: 'HTTP 503 Service Unavailable',
    last_failed_at: new Date('2026-11-14T12:00:00Z'),
    last_inbox: 'https://down.example/inbox',
    last_status: 503,
    last_succeeded_at: null,
  }

  const setupList = (isAdmin: boolean) => {
    const tools = new Map<string, ToolHandler>()
    const server = {
      tool: (name: string, _desc: string, _shape: unknown, handler: ToolHandler) => {
        tools.set(name, handler)
      },
    } as unknown as McpServer
    const listFailingDeliveryHosts = vi.fn(async () => [failing])
    const centralDb = {
      isAdmin: vi.fn(async () => isAdmin),
      listFailingDeliveryHosts,
    } as unknown as CentralDb
    registerFederationDeliveryTools(server, 'fiddur', centralDb)
    const handler = tools.get('list_federation_delivery_failures')
    if (handler == null) throw new Error('no tool list_federation_delivery_failures')
    return { call: handler, listFailingDeliveryHosts }
  }

  test('lists the failing servers with ISO timestamps', async () => {
    const result = await setupList(true).call()
    expect(JSON.parse(result.content[0].text)).toEqual({
      failures: [
        {
          failures: 3,
          first_failed_at: '2026-11-14T10:00:00.000Z',
          inbox_host: 'down.example',
          last_error: 'HTTP 503 Service Unavailable',
          last_failed_at: '2026-11-14T12:00:00.000Z',
          last_inbox: 'https://down.example/inbox',
          last_status: 503,
          last_succeeded_at: null,
        },
      ],
      success: true,
    })
  })

  test('is admin-only', async () => {
    const { call, listFailingDeliveryHosts } = setupList(false)
    const result = await call()
    expect(result.content[0].text).toBe('Admin permission required')
    expect(listFailingDeliveryHosts).not.toHaveBeenCalled()
  })
})
