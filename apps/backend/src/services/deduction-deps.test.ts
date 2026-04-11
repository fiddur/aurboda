import { describe, expect, test, vi } from 'vitest'

vi.mock('../db/index', () => ({
  deleteStaleRuleActivities: vi.fn(),
  insertActivity: vi.fn().mockResolvedValue('new-id'),
  insertDeductionRuleRun: vi.fn(),
}))

vi.mock('../db/connection', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
}))

vi.mock('./locations', () => ({
  getPlaceVisits: vi.fn().mockResolvedValue([]),
}))

import { createDefaultEngineDeps } from './deduction-deps.ts'

describe('createDefaultEngineDeps', () => {
  test('insertActivity calls notifier with activity data', async () => {
    const notifier = vi.fn()
    const deps = createDefaultEngineDeps(notifier)

    const activity = {
      activity_type: 'tv',
      data: { rule_id: 'rule-123', rule_name: 'TV Rule' },
      end_time: new Date('2024-03-15T22:00:00Z'),
      id: 'act-1',
      source: 'deduction-rule' as const,
      start_time: new Date('2024-03-15T20:00:00Z'),
    }

    await deps.insertActivity('testuser', activity)

    expect(notifier).toHaveBeenCalledWith(
      'testuser',
      'tv',
      new Date('2024-03-15T20:00:00Z'),
      new Date('2024-03-15T22:00:00Z'),
      'rule-123',
    )
  })

  test('insertActivity works without notifier', async () => {
    const deps = createDefaultEngineDeps()
    const activity = {
      activity_type: 'tv',
      end_time: new Date('2024-03-15T22:00:00Z'),
      id: 'act-1',
      source: 'deduction-rule' as const,
      start_time: new Date('2024-03-15T20:00:00Z'),
    }

    const id = await deps.insertActivity('testuser', activity)
    expect(id).toBe('new-id')
  })

  test('insertActivity passes undefined sourceRuleId when no rule_id in data', async () => {
    const notifier = vi.fn()
    const deps = createDefaultEngineDeps(notifier)

    const activity = {
      activity_type: 'tv',
      end_time: new Date('2024-03-15T22:00:00Z'),
      id: 'act-1',
      source: 'deduction-rule' as const,
      start_time: new Date('2024-03-15T20:00:00Z'),
    }

    await deps.insertActivity('testuser', activity)

    expect(notifier).toHaveBeenCalledWith(
      'testuser',
      'tv',
      new Date('2024-03-15T20:00:00Z'),
      new Date('2024-03-15T22:00:00Z'),
      undefined,
    )
  })
})
