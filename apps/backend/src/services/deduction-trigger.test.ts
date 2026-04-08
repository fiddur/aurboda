import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { createDeductionTrigger } from './deduction-trigger.ts'

type DeductionTriggerDeps = Parameters<typeof createDeductionTrigger>[0]

vi.mock('./audit-log', () => ({
  auditError: vi.fn(),
  auditInfo: vi.fn(),
}))

const d = (h: number, m = 0) =>
  new Date(`2024-01-15T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`)

const makeDeps = (overrides: Partial<DeductionTriggerDeps> = {}): DeductionTriggerDeps => ({
  engineDeps: {
    deleteStaleRuleActivities: vi.fn(),
    getActivities: vi.fn(),
    getScreentime: vi.fn(),
    getTags: vi.fn(),
    insertActivity: vi.fn(),
    insertRuleRun: vi.fn(),
  },
  evaluateAllRules: vi.fn().mockResolvedValue({ activities_created: 0, rules_evaluated: 0 }),
  getEnabledRules: vi.fn().mockResolvedValue([]),
  ...overrides,
})

describe('createDeductionTrigger', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('getPendingCount starts at 0', () => {
    const trigger = createDeductionTrigger(makeDeps())
    expect(trigger.getPendingCount()).toBe(0)
  })

  test('triggerEvaluation adds a pending evaluation', () => {
    const trigger = createDeductionTrigger(makeDeps())

    trigger.triggerEvaluation('user1', { end: d(12), start: d(10) })

    expect(trigger.getPendingCount()).toBe(1)
  })

  test('tracks separate evaluations per user', () => {
    const trigger = createDeductionTrigger(makeDeps())

    trigger.triggerEvaluation('user1', { end: d(12), start: d(10) })
    trigger.triggerEvaluation('user2', { end: d(14), start: d(13) })

    expect(trigger.getPendingCount()).toBe(2)
  })

  test('debounces evaluation by 5 seconds', async () => {
    const deps = makeDeps({
      getEnabledRules: vi.fn().mockResolvedValue([{ id: 'r1' }]),
    })
    const trigger = createDeductionTrigger(deps)

    trigger.triggerEvaluation('user1', { end: d(12), start: d(10) })

    expect(deps.getEnabledRules).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(5000)

    expect(deps.getEnabledRules).toHaveBeenCalledWith('user1')
    expect(trigger.getPendingCount()).toBe(0)
  })

  test('merges windows when debounced triggers overlap', async () => {
    const deps = makeDeps({
      getEnabledRules: vi.fn().mockResolvedValue([{ id: 'r1' }]),
    })
    const trigger = createDeductionTrigger(deps)

    trigger.triggerEvaluation('user1', { end: d(12), start: d(10) })
    // Second trigger before debounce expires — should merge windows
    await vi.advanceTimersByTimeAsync(2000)
    trigger.triggerEvaluation('user1', { end: d(15), start: d(11) })

    // Still only 1 pending (same user)
    expect(trigger.getPendingCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(5000)

    // evaluateAllRules should be called with the merged+buffered window
    expect(deps.evaluateAllRules).toHaveBeenCalledWith(
      'user1',
      [{ id: 'r1' }],
      {
        // Merged: start=min(10,11)=10, end=max(12,15)=15, then ±1h buffer
        end: new Date(d(15).getTime() + 60 * 60 * 1000),
        start: new Date(d(10).getTime() - 60 * 60 * 1000),
      },
      deps.engineDeps,
    )
  })

  test('skips evaluation when no enabled rules', async () => {
    const deps = makeDeps({
      getEnabledRules: vi.fn().mockResolvedValue([]),
    })
    const trigger = createDeductionTrigger(deps)

    trigger.triggerEvaluation('user1', { end: d(12), start: d(10) })
    await vi.advanceTimersByTimeAsync(5000)

    expect(deps.evaluateAllRules).not.toHaveBeenCalled()
  })

  test('clearPending cancels all pending evaluations', async () => {
    const deps = makeDeps({
      getEnabledRules: vi.fn().mockResolvedValue([{ id: 'r1' }]),
    })
    const trigger = createDeductionTrigger(deps)

    trigger.triggerEvaluation('user1', { end: d(12), start: d(10) })
    trigger.triggerEvaluation('user2', { end: d(14), start: d(13) })

    expect(trigger.getPendingCount()).toBe(2)

    trigger.clearPending()

    expect(trigger.getPendingCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(10000)
    expect(deps.getEnabledRules).not.toHaveBeenCalled()
  })

  test('handles evaluation errors gracefully', async () => {
    const { auditError } = await import('./audit-log.ts')
    const deps = makeDeps({
      getEnabledRules: vi.fn().mockRejectedValue(new Error('DB down')),
    })
    const trigger = createDeductionTrigger(deps)

    trigger.triggerEvaluation('user1', { end: d(12), start: d(10) })
    await vi.advanceTimersByTimeAsync(5000)

    expect(auditError).toHaveBeenCalledWith('user1', 'deduction', 'Rule evaluation failed', {
      error: 'Error: DB down',
    })
  })
})
