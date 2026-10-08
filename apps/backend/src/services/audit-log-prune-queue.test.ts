import { describe, expect, test, vi } from 'vitest'

import { DEDUCTION_RULE_RUN_RETENTION_DAYS, pruneAllAuditLogs } from './audit-log-prune-queue.ts'

describe('pruneAllAuditLogs', () => {
  test('prunes every user with the retention value, read once', async () => {
    const getRetentionDays = vi.fn(async () => 30)
    const prune = vi.fn(async () => 0)
    const pruned = await pruneAllAuditLogs({
      getRetentionDays,
      listUsers: async () => ['alice', 'bob'],
      prune,
      pruneDeductionRuleRuns: async () => 0,
    })
    expect(pruned).toBe(2)
    expect(getRetentionDays).toHaveBeenCalledTimes(1)
    expect(prune.mock.calls).toEqual([
      ['alice', 30],
      ['bob', 30],
    ])
  })

  test('prunes every user’s deduction rule runs with their own fixed retention', async () => {
    const pruneDeductionRuleRuns = vi.fn(async () => 0)
    await pruneAllAuditLogs({
      getRetentionDays: async () => 7,
      listUsers: async () => ['alice', 'bob'],
      prune: async () => 0,
      pruneDeductionRuleRuns,
    })
    expect(DEDUCTION_RULE_RUN_RETENTION_DAYS).toBe(30)
    expect(pruneDeductionRuleRuns.mock.calls).toEqual([
      ['alice', 30],
      ['bob', 30],
    ])
  })

  test("one user's failure does not stop the rest", async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const prune = vi.fn(async (user: string) => {
      if (user === 'bob') throw new Error('boom')
      return 0
    })
    const pruned = await pruneAllAuditLogs({
      getRetentionDays: async () => 7,
      listUsers: async () => ['alice', 'bob', 'carol'],
      prune,
      pruneDeductionRuleRuns: async () => 0,
    })
    expect(pruned).toBe(2)
    expect(prune.mock.calls.map(([user]) => user)).toEqual(['alice', 'bob', 'carol'])
    expect(consoleError).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })
})
