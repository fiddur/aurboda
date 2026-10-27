import { addDeductionRuleBodySchema } from '@aurboda/api-spec'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../db/index.ts', () => ({
  claimSettingsFlagIn: vi.fn(),
  expandActivityTypes: vi.fn(),
  insertDeductionRule: vi.fn(),
}))
vi.mock('../db/connection.ts', () => ({ withUserTransaction: vi.fn() }))
vi.mock('./audit-log.ts', () => ({ auditError: vi.fn() }))

import type { Queryable } from '../db/pool.ts'

import {
  defaultRunCategoryRules,
  ensureDefaultRunCategoryRules,
  type RunCategoryRuleDeps,
} from './run-category-rules.ts'

const tx = { tx: true } as unknown as Queryable

const fakeDeps = (claimed: boolean): RunCategoryRuleDeps => ({
  claimSeeding: vi.fn().mockResolvedValue(claimed),
  insertDeductionRule: vi.fn().mockResolvedValue({}),
  isRunningType: vi.fn(async (_user: string, type: string) => ['running', 'trail_running'].includes(type)),
  reportFailure: vi.fn(),
  withTransaction: vi.fn(async (_user, fn) => fn(tx)) as RunCategoryRuleDeps['withTransaction'],
})

describe('defaultRunCategoryRules', () => {
  test('are valid enrich rules on running that categorise by features', () => {
    for (const rule of defaultRunCategoryRules) {
      expect(addDeductionRuleBodySchema.safeParse(rule).success).toBe(true)
      expect(rule).toMatchObject({
        enabled: true,
        mode: 'enrich',
        output_activity_type: 'running',
        priority: 0,
      })
      expect(rule.output_data).toBeUndefined()
      expect(
        rule.conditions.every((c) => c.kind === 'activity_feature' && c.activity_type === 'running'),
      ).toBe(true)
    }
    expect(defaultRunCategoryRules.map((r) => r.output_category)).toEqual([
      'low_hr',
      'intervals',
      'long',
      'long',
      'tempo',
      'hard',
    ])
  })
})

describe('ensureDefaultRunCategoryRules', () => {
  test('claims and inserts every default rule in one transaction', async () => {
    const deps = fakeDeps(true)
    expect(await ensureDefaultRunCategoryRules('user', 'running', deps)).toEqual({
      seeded: defaultRunCategoryRules.length,
    })
    expect(deps.withTransaction).toHaveBeenCalledOnce()
    expect(deps.claimSeeding).toHaveBeenCalledExactlyOnceWith(tx)
    expect(vi.mocked(deps.insertDeductionRule).mock.calls).toEqual(
      defaultRunCategoryRules.map((r) => [tx, r]),
    )
    expect(vi.mocked(deps.claimSeeding).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.insertDeductionRule).mock.invocationCallOrder[0]!,
    )
  })

  test('a transaction that loses the claim inserts nothing', async () => {
    const deps = fakeDeps(false)
    expect(await ensureDefaultRunCategoryRules('user', 'running', deps)).toEqual({ seeded: 0 })
    expect(deps.insertDeductionRule).not.toHaveBeenCalled()
  })

  test('a failed insert fails the whole transaction and is reported', async () => {
    const deps = fakeDeps(true)
    const error = new Error('boom')
    vi.mocked(deps.insertDeductionRule).mockResolvedValueOnce({}).mockRejectedValueOnce(error)
    expect(await ensureDefaultRunCategoryRules('user', 'running', deps)).toEqual({ seeded: 0 })
    expect(deps.reportFailure).toHaveBeenCalledExactlyOnceWith('user', error)
  })

  test('seeds for running and its descendants only', async () => {
    const walk = fakeDeps(true)
    expect(await ensureDefaultRunCategoryRules('user', 'walking', walk)).toEqual({ seeded: 0 })
    expect(walk.withTransaction).not.toHaveBeenCalled()

    const trail = fakeDeps(true)
    expect((await ensureDefaultRunCategoryRules('user', 'trail_running', trail)).seeded).toBe(
      defaultRunCategoryRules.length,
    )
  })

  test('without a type it seeds unconditionally', async () => {
    const deps = fakeDeps(true)
    expect((await ensureDefaultRunCategoryRules('user', undefined, deps)).seeded).toBe(
      defaultRunCategoryRules.length,
    )
    expect(deps.isRunningType).not.toHaveBeenCalled()
  })
})
