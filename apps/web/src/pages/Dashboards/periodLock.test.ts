import type { DashboardConfig } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { canSave, hasPeriodLock, initialDraft, lockBody, withFrom, withMode } from './periodLock'

const latestLock = { period_fixed: null, period_from: null, period_lock: 'latest' as const }
const monthly: DashboardConfig = { period: { granularity: 'month' }, sections: [], version: 1 }

describe('hasPeriodLock', () => {
  test('only for a published period dashboard', () => {
    expect(hasPeriodLock({ config: monthly, visibility: 'unlisted' })).toBe(true)
    expect(hasPeriodLock({ config: monthly, visibility: 'public' })).toBe(true)
    expect(hasPeriodLock({ config: monthly, visibility: 'private' })).toBe(false)
    expect(hasPeriodLock({ config: { sections: [], version: 1 }, visibility: 'public' })).toBe(false)
  })
})

describe('initialDraft', () => {
  test('starts the pickers at the stored keys, else at the latest finished period', () => {
    expect(initialDraft(latestLock, '2026-10')).toEqual({
      confirmed: false,
      fixed: '2026-10',
      from: '2026-10',
      mode: 'latest',
    })
    expect(
      initialDraft({ period_fixed: null, period_from: '2026-01', period_lock: 'browsable' }, '2026-10'),
    ).toEqual({ confirmed: true, fixed: '2026-10', from: '2026-01', mode: 'browsable' })
  })
})

describe('canSave', () => {
  test('nothing to save while the draft matches what is stored', () => {
    expect(canSave(initialDraft(latestLock, '2026-10'), latestLock)).toBe(false)
  })

  test('a fixed period saves at once', () => {
    const draft = withMode(initialDraft(latestLock, '2026-10'), 'fixed')
    expect(canSave(draft, latestLock)).toBe(true)
    expect(lockBody(draft)).toEqual({ period_fixed: '2026-10', period_lock: 'fixed' })
  })

  test('browsable waits for the confirmation', () => {
    const draft = withMode(initialDraft(latestLock, '2026-10'), 'browsable')
    expect(draft.confirmed).toBe(false)
    expect(canSave(draft, latestLock)).toBe(false)
    expect(canSave({ ...draft, confirmed: true }, latestLock)).toBe(true)
    expect(lockBody(draft)).toEqual({ period_from: '2026-10', period_lock: 'browsable' })
  })

  test('moving the earliest period asks for the confirmation again', () => {
    const stored = { period_fixed: null, period_from: '2026-03', period_lock: 'browsable' as const }
    const draft = withFrom(initialDraft(stored, '2026-10'), '2026-01')
    expect(draft.confirmed).toBe(false)
    expect(canSave(draft, stored)).toBe(false)
    expect(canSave({ ...draft, confirmed: true }, stored)).toBe(true)
  })

  test('going back to latest saves without a confirmation', () => {
    const stored = { period_fixed: null, period_from: '2026-03', period_lock: 'browsable' as const }
    expect(canSave(withMode(initialDraft(stored, '2026-10'), 'latest'), stored)).toBe(true)
  })
})
