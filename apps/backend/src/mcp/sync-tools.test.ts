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
