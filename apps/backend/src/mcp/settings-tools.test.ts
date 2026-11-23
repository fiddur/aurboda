import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { McpServer } from './helpers.ts'

import { registerSettingsTools } from './settings-tools.ts'

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>

const store = vi.hoisted(() => ({ settings: {} as Record<string, unknown> }))

vi.mock('../db/index.ts', () => ({
  getActivityTypeNames: async () => [],
  getAllSyncStates: async () => [],
  getGoals: async () => [],
  getOAuthToken: async () => null,
  getUserSettings: async () => store.settings,
  replaceGoals: async () => {},
  upsertUserSettings: async (_user: string, updates: Record<string, unknown>, clear: string[] = []) => {
    const next = { ...store.settings, ...updates }
    for (const key of clear) delete next[key]
    store.settings = next
    return next
  },
}))

vi.mock('../services/central-db.ts', () => ({
  getCentralDb: () => ({
    getLastFmApiKey: async () => null,
    getServerSetting: async () => null,
  }),
}))

const setup = () => {
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _description: string, _shape: unknown, handler: ToolHandler) =>
      tools.set(name, handler),
  } as unknown as McpServer
  registerSettingsTools(server, 'alice')
  return async (name: string, params: Record<string, unknown> = {}) =>
    JSON.parse((await tools.get(name)!(params)).content[0]!.text) as Record<string, unknown>
}

beforeEach(() => {
  store.settings = {}
})

describe('hidden_pages through the settings MCP tools', () => {
  test('get_user_settings lists none until set', async () => {
    const call = setup()
    expect((await call('get_user_settings')).hidden_pages).toEqual([])
  })

  test('update_user_settings stores the menu paths, drops an unknown one, and get reads them back', async () => {
    const call = setup()

    const updated = await call('update_user_settings', { hidden_pages: ['/strength', '/no-such-page'] })
    expect(updated.success).toBe(true)
    expect(updated.hidden_pages).toEqual(['/strength'])
    expect((await call('get_user_settings')).hidden_pages).toEqual(['/strength'])

    await call('update_user_settings', { hidden_pages: [] })
    expect((await call('get_user_settings')).hidden_pages).toEqual([])
  })
})

describe('journal_strip_metadata through the settings MCP tools', () => {
  test('is false until set, true once set, and null resets it', async () => {
    const call = setup()
    expect((await call('get_user_settings')).journal_strip_metadata).toBe(false)

    const updated = await call('update_user_settings', { journal_strip_metadata: true })
    expect(updated.journal_strip_metadata).toBe(true)
    expect((await call('get_user_settings')).journal_strip_metadata).toBe(true)

    await call('update_user_settings', { journal_strip_metadata: null })
    expect(store.settings).not.toHaveProperty('journal_strip_metadata')
    expect((await call('get_user_settings')).journal_strip_metadata).toBe(false)
  })
})

describe('tz through the settings MCP tools', () => {
  test('update_user_settings sets the time zone and null clears it', async () => {
    const call = setup()

    const updated = await call('update_user_settings', { tz: 'Asia/Kolkata' })
    expect(updated.tz).toBe('Asia/Kolkata')
    expect(store.settings.device_timezone).toBe('Asia/Kolkata')

    expect((await call('update_user_settings', { tz: null })).tz).toBeNull()
    expect(store.settings).not.toHaveProperty('device_timezone')
  })
})
