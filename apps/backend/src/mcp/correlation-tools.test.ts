import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { McpServer } from './helpers.ts'

import { impactData } from '../test/impact-fixture.ts'
import { registerCorrelationTools } from './correlation-tools.ts'

vi.mock('../services/correlations/activity-impact.ts', () => ({ getActivityImpact: vi.fn() }))

const { getActivityImpact } = await import('../services/correlations/activity-impact.ts')

type ToolHandler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>

const impactTool = (): ToolHandler => {
  const tools = new Map<string, ToolHandler>()
  const server = {
    tool: (name: string, _desc: string, _shape: unknown, handler: ToolHandler) => {
      tools.set(name, handler)
    },
  } as unknown as McpServer
  registerCorrelationTools(server, 'tester')
  return tools.get('get_activity_impact')!
}

describe('get_activity_impact', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getActivityImpact).mockResolvedValue(impactData())
  })

  test('start and end fix the analysed period', async () => {
    await impactTool()({
      activity: 'yoga',
      activity_type: 'activity_type',
      end: '2026-03-01T00:00:00Z',
      start: '2026-01-01T00:00:00Z',
    })
    expect(getActivityImpact).toHaveBeenCalledWith(
      'tester',
      'yoga',
      'activity_type',
      30,
      90,
      undefined,
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-01-01T00:00:00Z'),
      undefined,
    )
  })

  test('one bound alone or a reversed period is an error', async () => {
    const onlyEnd = await impactTool()({
      activity: 'yoga',
      activity_type: 'activity_type',
      end: '2026-03-01T00:00:00Z',
    })
    expect(onlyEnd.content[0].text).toBe('Give both start and end, or neither.')
    const reversed = await impactTool()({
      activity: 'yoga',
      activity_type: 'activity_type',
      end: '2026-01-01T00:00:00Z',
      start: '2026-03-01T00:00:00Z',
    })
    expect(reversed.content[0].text).toBe('start must be before end.')
    expect(getActivityImpact).not.toHaveBeenCalled()
  })
})
