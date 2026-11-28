import { type DashboardConfig, JOURNAL_AGGREGATION_ERROR, JOURNAL_BREAKDOWN_ERROR } from '@aurboda/api-spec'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { McpServer } from './helpers.ts'

vi.mock('../db/index.ts', () => ({
  createSharedDashboard: vi.fn(),
  deleteSharedDashboard: vi.fn(),
  getSharedDashboardById: vi.fn(),
  listSharedDashboards: vi.fn(),
  updateSharedDashboard: vi.fn(),
}))
vi.mock('../services/settings.ts', () => ({ getSettings: vi.fn(), getUserTimezone: vi.fn() }))
vi.mock('../services/shared-dashboard-data.ts', () => ({ resolveDashboardView: vi.fn() }))
vi.mock('../services/data-presence.ts', () => ({ queryDataPresence: vi.fn() }))

const { createSharedDashboard, getSharedDashboardById, updateSharedDashboard } =
  await import('../db/index.ts')
const { registerSharedDashboardTools } = await import('./shared-dashboard-tools.ts')

type ToolResult = { content: Array<{ text: string }>; isError?: boolean }
type ToolHandler = (params: Record<string, unknown>) => Promise<ToolResult>

const setup = () => {
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _description: string, _shape: unknown, handler: ToolHandler) =>
      tools.set(name, handler),
  } as unknown as McpServer
  registerSharedDashboardTools(server, 'alice')
  return (name: string, params: Record<string, unknown>) => tools.get(name)!(params)
}

const journalTrend = (config: Record<string, unknown>): DashboardConfig =>
  ({
    sections: [
      {
        id: 's',
        title: 'Journal',
        type: 'charts',
        widgets: [{ config: { source_type: 'journal', ...config }, id: 'trend', type: 'trend_chart' }],
      },
    ],
    version: 1,
  }) as DashboardConfig

const ID = '00000000-0000-4000-8000-000000000001'

describe('a journal chart saved on a shared dashboard through MCP', () => {
  beforeEach(() => vi.clearAllMocks())

  test('create_shared_dashboard refuses a journal chart the chart tools refuse, without creating', async () => {
    const result = await setup()('create_shared_dashboard', {
      config: journalTrend({ aggregation: 'mean' }),
      name: 'Journal',
    })

    expect(result).toEqual({ content: [{ text: JOURNAL_AGGREGATION_ERROR, type: 'text' }], isError: true })
    expect(createSharedDashboard).not.toHaveBeenCalled()
  })

  test('update_shared_dashboard refuses a journal chart the chart tools refuse, without updating', async () => {
    vi.mocked(getSharedDashboardById).mockResolvedValue({ id: ID } as Awaited<
      ReturnType<typeof getSharedDashboardById>
    >)

    const result = await setup()('update_shared_dashboard', {
      config: journalTrend({ breakdown_fields: ['mood'] }),
      id: ID,
    })

    expect(result).toEqual({ content: [{ text: JOURNAL_BREAKDOWN_ERROR, type: 'text' }], isError: true })
    expect(updateSharedDashboard).not.toHaveBeenCalled()
  })
})
