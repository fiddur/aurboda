import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { McpServer } from './helpers.ts'

import { getChartFirstDay } from '../services/chart-first-day.ts'
import { registerChartTools } from './chart-tools.ts'

vi.mock('../services/chart-data.ts', () => ({ getChartData: vi.fn() }))
vi.mock('../services/chart-first-day.ts', () => ({ getChartFirstDay: vi.fn() }))
vi.mock('../services/settings.ts', () => ({ getUserTimezone: vi.fn(async () => 'Europe/Oslo') }))

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>

const buildTool = (name: string): ToolHandler => {
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (toolName: string, _desc: string, _shape: unknown, handler: ToolHandler) => {
      tools.set(toolName, handler)
    },
  } as unknown as McpServer
  registerChartTools(server, 'tester')
  return tools.get(name)!
}

const call = async (params: Record<string, unknown>) =>
  JSON.parse((await buildTool('get_chart_first_day')(params)).content[0].text)

describe('MCP get_chart_first_day', () => {
  beforeEach(() => {
    vi.mocked(getChartFirstDay).mockReset()
  })

  test("answers the source's first day, in the user's zone when tz is absent", async () => {
    vi.mocked(getChartFirstDay).mockResolvedValue('1995-04-02')
    expect(await call({ source_type: 'journal' })).toEqual({
      data: { first_day: '1995-04-02' },
      success: true,
    })
    expect(vi.mocked(getChartFirstDay).mock.calls[0]).toEqual([
      'tester',
      { source_type: 'journal', tz: 'Europe/Oslo' },
    ])
  })

  test('answers no first day for a source without data', async () => {
    vi.mocked(getChartFirstDay).mockResolvedValue(undefined)
    expect(await call({ pattern: 'weight', source_type: 'metric', tz: 'UTC' })).toEqual({
      data: {},
      success: true,
    })
  })

  test('refuses journal filters on another source', async () => {
    const body = await call({ journal_q: 'x', pattern: 'weight', source_type: 'metric' })
    expect(body.success).toBe(false)
    expect(getChartFirstDay).not.toHaveBeenCalled()
  })
})
