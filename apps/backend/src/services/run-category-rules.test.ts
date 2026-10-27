import { addDeductionRuleBodySchema } from '@aurboda/api-spec'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../db/index.ts', () => ({ claimSettingsFlag: vi.fn(), insertDeductionRule: vi.fn() }))
vi.mock('./audit-log.ts', () => ({ auditError: vi.fn() }))

import {
  defaultRunCategoryRules,
  ensureDefaultRunCategoryRules,
  type RunCategoryRuleDeps,
} from './run-category-rules.ts'

const fakeDeps = (claimed: boolean): RunCategoryRuleDeps => ({
  claimSeeding: vi.fn().mockResolvedValue(claimed),
  insertDeductionRule: vi.fn().mockResolvedValue({}),
  reportFailure: vi.fn(),
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
  test('the caller that wins the claim inserts every default rule', async () => {
    const deps = fakeDeps(true)
    expect(await ensureDefaultRunCategoryRules('user', deps)).toEqual({
      seeded: defaultRunCategoryRules.length,
    })
    expect(deps.claimSeeding).toHaveBeenCalledExactlyOnceWith('user')
    expect(vi.mocked(deps.insertDeductionRule).mock.calls.map((c) => c[1])).toEqual(defaultRunCategoryRules)
    expect(vi.mocked(deps.claimSeeding).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.insertDeductionRule).mock.invocationCallOrder[0]!,
    )
  })

  test('a caller that loses the claim inserts nothing', async () => {
    const deps = fakeDeps(false)
    expect(await ensureDefaultRunCategoryRules('user', deps)).toEqual({ seeded: 0 })
    expect(deps.insertDeductionRule).not.toHaveBeenCalled()
  })

  test('a failed insert is reported and not retried', async () => {
    const deps = fakeDeps(true)
    const error = new Error('boom')
    vi.mocked(deps.insertDeductionRule).mockResolvedValueOnce({}).mockRejectedValueOnce(error)
    expect(await ensureDefaultRunCategoryRules('user', deps)).toEqual({ seeded: 1 })
    expect(deps.insertDeductionRule).toHaveBeenCalledTimes(2)
    expect(deps.reportFailure).toHaveBeenCalledExactlyOnceWith('user', error)
  })
})
