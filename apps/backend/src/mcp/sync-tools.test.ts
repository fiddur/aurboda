import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { McpServer } from './helpers.ts'

vi.mock('../services/central-db.ts', () => ({
  getCentralDb: () => ({ getLastFmApiKey: vi.fn().mockResolvedValue('api-key') }),
}))

vi.mock('../services/settings.ts', () => ({
  getSettings: vi.fn().mockResolvedValue({ lastfm_username: 'bob' }),
}))

vi.mock('../integrations/lastfm/sync.ts', () => ({
  DEFAULT_SYNC_HISTORY_DAYS: 30,
  syncLastFmData: vi.fn(),
}))

import { syncLastFmData } from '../integrations/lastfm/sync.ts'
import { registerSyncTools } from './sync-tools.ts'

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

describe('MCP sync_lastfm tool', () => {
  beforeEach(() => vi.clearAllMocks())

  test('triggers deduction evaluation after a successful sync with new scrobbles', async () => {
    vi.mocked(syncLastFmData).mockResolvedValue({ scrobbles_processed: 2, status: 'success' })
    const notifier = vi.fn()
    const { server, tools } = buildFakeServer()
    registerSyncTools(server, 'alice', undefined, undefined, undefined, notifier)

    await tools.get('sync_lastfm')!({})

    expect(notifier).toHaveBeenCalledTimes(1)
    const [user, activityType] = notifier.mock.calls[0]
    expect(user).toBe('alice')
    expect(activityType).toBe('*')
  })

  test('does not trigger deduction when no new scrobbles were processed', async () => {
    vi.mocked(syncLastFmData).mockResolvedValue({ scrobbles_processed: 0, status: 'success' })
    const notifier = vi.fn()
    const { server, tools } = buildFakeServer()
    registerSyncTools(server, 'alice', undefined, undefined, undefined, notifier)

    await tools.get('sync_lastfm')!({})

    expect(notifier).not.toHaveBeenCalled()
  })
})

describe('MCP reprocess_garmin_pushes tool', () => {
  const register = (reprocess?: (user: string, since?: Date) => Promise<number>) => {
    const { server, tools } = buildFakeServer()
    registerSyncTools(
      server,
      'alice',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      reprocess,
    )
    return tools.get('reprocess_garmin_pushes')!
  }

  test('queues the pushes since the given time and answers the count', async () => {
    const reprocess = vi.fn(async () => 12)
    const result = await register(reprocess)({ since: '2026-11-10T00:00:00Z' })
    expect(reprocess).toHaveBeenCalledWith('alice', new Date('2026-11-10T00:00:00Z'))
    expect(JSON.parse(result.content[0]!.text)).toEqual({ queued: 12, success: true })
  })

  test('leaves the default start to the service', async () => {
    const reprocess = vi.fn(async () => 0)
    await register(reprocess)({})
    expect(reprocess).toHaveBeenCalledWith('alice', undefined)
  })

  test('says so when push processing is not wired', async () => {
    const result = await register()({})
    expect(result.content[0]!.text).toContain('not available')
  })
})
