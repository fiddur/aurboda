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

vi.mock('../services/garmin-resync-detail.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof GarminResync>()),
  resyncGarminActivityDetail: vi.fn(),
}))

vi.mock('../integrations/garmin/sync.ts', () => ({
  garminDetailResync: vi.fn(() => 'resync-fn'),
  hasGarminConnection: vi.fn(),
  syncAllGarminData: vi.fn(),
}))

import type * as GarminResync from '../services/garmin-resync-detail.ts'

import { garminDetailResync } from '../integrations/garmin/sync.ts'
import { syncLastFmData } from '../integrations/lastfm/sync.ts'
import { resyncGarminActivityDetail } from '../services/garmin-resync-detail.ts'
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
    registerSyncTools(server, 'alice', { notifier })

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
    registerSyncTools(server, 'alice', { notifier })

    await tools.get('sync_lastfm')!({})

    expect(notifier).not.toHaveBeenCalled()
  })
})

describe('MCP reprocess_garmin_pushes tool', () => {
  const register = (reprocess?: (user: string, since?: Date) => Promise<number>) => {
    const { server, tools } = buildFakeServer()
    registerSyncTools(server, 'alice', { reprocessGarminPushes: reprocess })
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

describe('MCP resync_garmin_activity_detail tool', () => {
  beforeEach(() => vi.clearAllMocks())

  const register = (garmin?: object) => {
    const { server, tools } = buildFakeServer()
    registerSyncTools(server, 'alice', { garmin: garmin as never })
    return tools.get('resync_garmin_activity_detail')!
  }

  test('re-syncs through the shared service and answers the points', async () => {
    vi.mocked(resyncGarminActivityDetail).mockResolvedValue({ points: 42, status: 'synced' })
    const garmin = {}

    const result = await register(garmin)({ id: 'merged:a1' })

    expect(garminDetailResync).toHaveBeenCalledWith(garmin, expect.any(Object))
    expect(resyncGarminActivityDetail).toHaveBeenCalledWith('alice', 'a1', 'resync-fn')
    expect(JSON.parse(result.content[0]!.text)).toEqual({ points: 42, success: true })
  })

  test('answers why it could not, as the REST route does', async () => {
    vi.mocked(resyncGarminActivityDetail).mockResolvedValue({ status: 'no_file' })

    const result = (await register({})({ id: 'a1' })) as {
      content: Array<{ text: string }>
      isError?: boolean
    }

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toBe('Garmin has no activity file for this activity.')
  })

  test('passes no re-sync without a Garmin client', async () => {
    vi.mocked(resyncGarminActivityDetail).mockResolvedValue({ status: 'not_configured' })

    await register()({ id: 'a1' })

    expect(resyncGarminActivityDetail).toHaveBeenCalledWith('alice', 'a1', undefined)
  })
})

describe('MCP sync_weather tool', () => {
  test('passes the options to the weather sync and reports its result', async () => {
    const syncWeather = vi
      .fn()
      .mockResolvedValue({ cells: 1, cells_deferred: 0, hours_stored: 24, status: 'success' })
    const { server, tools } = buildFakeServer()
    registerSyncTools(server, 'alice', { syncWeather })

    const response = await tools.get('sync_weather')!({ full_resync: true, start_date: '2024-01-01' })

    expect(syncWeather).toHaveBeenCalledWith('alice', { fullResync: true, startDate: new Date('2024-01-01') })
    expect(JSON.parse(response.content[0].text)).toEqual({
      result: { cells: 1, cells_deferred: 0, hours_stored: 24, status: 'success' },
      success: true,
    })
  })

  test('a skipped sync is not a success', async () => {
    const syncWeather = vi.fn().mockResolvedValue({
      cells: 0,
      cells_deferred: 0,
      error: 'Weather is not enabled',
      hours_stored: 0,
      status: 'skipped',
    })
    const { server, tools } = buildFakeServer()
    registerSyncTools(server, 'alice', { syncWeather })

    const response = await tools.get('sync_weather')!({})

    expect(JSON.parse(response.content[0].text).success).toBe(false)
  })
})
