import { describe, expect, test, vi } from 'vitest'

import {
  type AuditLogPruneDeps,
  DEDUCTION_RULE_RUN_RETENTION_DAYS,
  pruneAllAuditLogs,
  SYNCED_OUTBOUND_SYNC_RETENTION_DAYS,
} from './audit-log-prune-queue.ts'

const deps = (overrides: Partial<AuditLogPruneDeps>): AuditLogPruneDeps => ({
  getRetentionDays: async () => 7,
  listUsers: async () => ['alice', 'bob'],
  prune: async () => 0,
  pruneDeductionRuleRuns: async () => 0,
  pruneSyncedOutboundSync: async () => 0,
  ...overrides,
})

describe('pruneAllAuditLogs', () => {
  test('prunes every user with the retention value, read once', async () => {
    const getRetentionDays = vi.fn(async () => 30)
    const prune = vi.fn(async () => 0)
    const pruned = await pruneAllAuditLogs(deps({ getRetentionDays, prune }))
    expect(pruned).toBe(2)
    expect(getRetentionDays).toHaveBeenCalledTimes(1)
    expect(prune.mock.calls).toEqual([
      ['alice', 30],
      ['bob', 30],
    ])
  })

  test('prunes every user’s deduction rule runs with their own fixed retention', async () => {
    const pruneDeductionRuleRuns = vi.fn(async () => 0)
    await pruneAllAuditLogs(deps({ pruneDeductionRuleRuns }))
    expect(DEDUCTION_RULE_RUN_RETENTION_DAYS).toBe(30)
    expect(pruneDeductionRuleRuns.mock.calls).toEqual([
      ['alice', 30],
      ['bob', 30],
    ])
  })

  test('prunes every user’s synced outbound sync rows after 14 days', async () => {
    const pruneSyncedOutboundSync = vi.fn(async () => 0)
    await pruneAllAuditLogs(deps({ pruneSyncedOutboundSync }))
    expect(SYNCED_OUTBOUND_SYNC_RETENTION_DAYS).toBe(14)
    expect(pruneSyncedOutboundSync.mock.calls).toEqual([
      ['alice', 14],
      ['bob', 14],
    ])
  })

  test("one user's failure does not stop the rest", async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const prune = vi.fn(async (user: string) => {
      if (user === 'bob') throw new Error('boom')
      return 0
    })
    const pruned = await pruneAllAuditLogs(deps({ listUsers: async () => ['alice', 'bob', 'carol'], prune }))
    expect(pruned).toBe(2)
    expect(prune.mock.calls.map(([user]) => user)).toEqual(['alice', 'bob', 'carol'])
    expect(consoleError).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })

  test("one step's failure does not skip the user's other steps", async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pruneDeductionRuleRuns = vi.fn(async () => 0)
    const pruneSyncedOutboundSync = vi.fn(async () => 0)
    const pruned = await pruneAllAuditLogs(
      deps({
        listUsers: async () => ['alice'],
        prune: async () => {
          throw new Error('boom')
        },
        pruneDeductionRuleRuns,
        pruneSyncedOutboundSync,
      }),
    )
    expect(pruned).toBe(0)
    expect(pruneDeductionRuleRuns).toHaveBeenCalledOnce()
    expect(pruneSyncedOutboundSync).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })
})
