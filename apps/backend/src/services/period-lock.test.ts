import type { DashboardConfig } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import {
  defaultPeriodLock,
  publicPeriodFor,
  requestedPeriodLock,
  resolveLockUpdate,
  validatePeriodLock,
} from './period-lock.ts'
import { PeriodError } from './periods.ts'

const TZ = 'Europe/Stockholm'
const NOW = new Date('2026-11-08T12:00:00Z')

const monthly: DashboardConfig = { period: { granularity: 'month' }, sections: [], version: 1 }
const weekly: DashboardConfig = { period: { granularity: 'week' }, sections: [], version: 1 }
const rolling: DashboardConfig = { sections: [], version: 1 }

const errorCodeOf = (fn: () => unknown): string | undefined => {
  try {
    fn()
  } catch (error) {
    if (error instanceof PeriodError) return error.code
    throw error
  }
  return undefined
}

describe('requestedPeriodLock', () => {
  it('is undefined when the request sends no period_lock', () => {
    expect(requestedPeriodLock({ period_fixed: '2026-09' })).toBeUndefined()
  })

  it('keeps only the key its mode uses', () => {
    expect(
      requestedPeriodLock({ period_fixed: '2026-09', period_from: '2026-01', period_lock: 'fixed' }),
    ).toEqual({
      period_fixed: '2026-09',
      period_from: null,
      period_lock: 'fixed',
    })
    expect(
      requestedPeriodLock({ period_fixed: '2026-09', period_from: '2026-01', period_lock: 'browsable' }),
    ).toEqual({ period_fixed: null, period_from: '2026-01', period_lock: 'browsable' })
    expect(requestedPeriodLock({ period_fixed: '2026-09', period_lock: 'latest' })).toEqual(defaultPeriodLock)
  })
})

describe('validatePeriodLock', () => {
  it('accepts latest on any dashboard', () => {
    expect(validatePeriodLock(rolling, defaultPeriodLock)).toBeNull()
    expect(validatePeriodLock(monthly, defaultPeriodLock)).toBeNull()
  })

  it('rejects any other lock on a rolling dashboard', () => {
    expect(
      validatePeriodLock(rolling, { period_fixed: '2026-09', period_from: null, period_lock: 'fixed' }),
    ).toMatch(/period dashboard/)
  })

  it('needs the key of the mode', () => {
    expect(
      validatePeriodLock(monthly, { period_fixed: null, period_from: null, period_lock: 'fixed' }),
    ).toMatch(/period_fixed/)
    expect(
      validatePeriodLock(monthly, { period_fixed: '2026-09', period_from: null, period_lock: 'browsable' }),
    ).toMatch(/period_from/)
  })

  it('needs the key to parse and match the granularity', () => {
    expect(
      validatePeriodLock(monthly, { period_fixed: '2026-W60', period_from: null, period_lock: 'fixed' }),
    ).toMatch(/not a valid period/)
    expect(
      validatePeriodLock(monthly, { period_fixed: '2026-W40', period_from: null, period_lock: 'fixed' }),
    ).toMatch(/week/)
    expect(
      validatePeriodLock(monthly, { period_fixed: '2026-09', period_from: null, period_lock: 'fixed' }),
    ).toBeNull()
    expect(
      validatePeriodLock(weekly, { period_fixed: null, period_from: '2026-W01', period_lock: 'browsable' }),
    ).toBeNull()
  })
})

describe('resolveLockUpdate', () => {
  const stored = {
    config: monthly,
    period_fixed: '2026-09',
    period_from: null,
    period_lock: 'fixed' as const,
  }

  it('leaves the stored lock when none is sent', () => {
    expect(resolveLockUpdate(stored, { config: monthly })).toEqual({ lock: undefined })
  })

  it('rejects a granularity change that would strand the stored key', () => {
    expect(resolveLockUpdate(stored, { config: weekly })).toHaveProperty('error')
  })

  it('accepts a granularity change together with a matching lock', () => {
    expect(
      resolveLockUpdate(stored, { config: weekly, period_from: '2026-W01', period_lock: 'browsable' }),
    ).toEqual({
      lock: { period_fixed: null, period_from: '2026-W01', period_lock: 'browsable' },
    })
  })

  it('rejects dropping the period while a lock remains', () => {
    expect(resolveLockUpdate(stored, { config: rolling })).toHaveProperty('error')
    expect(resolveLockUpdate(stored, { config: rolling, period_lock: 'latest' })).toEqual({
      lock: defaultPeriodLock,
    })
  })
})

describe('publicPeriodFor', () => {
  const record = (lock: Partial<typeof defaultPeriodLock>, config = monthly) => ({
    config,
    ...defaultPeriodLock,
    ...lock,
  })

  it('is undefined on a rolling dashboard', () => {
    expect(publicPeriodFor(record({}, rolling), '2026-09', NOW, TZ)).toBeUndefined()
  })

  it('latest ignores the requested period', () => {
    expect(publicPeriodFor(record({}), '2026-01', NOW, TZ)).toBe('2026-10')
    expect(publicPeriodFor(record({}), '2099-01', NOW, TZ)).toBe('2026-10')
  })

  it('fixed resolves the pinned period whatever is asked', () => {
    const fixed = record({ period_fixed: '2026-03', period_lock: 'fixed' })
    expect(publicPeriodFor(fixed, undefined, NOW, TZ)).toBe('2026-03')
    expect(publicPeriodFor(fixed, '2026-05', NOW, TZ)).toBe('2026-03')
  })

  describe('browsable', () => {
    const browsable = record({ period_from: '2026-03', period_lock: 'browsable' })

    it('defaults to the latest finished period', () => {
      expect(publicPeriodFor(browsable, undefined, NOW, TZ)).toBe('2026-10')
    })

    it('honours a finished period from period_from on', () => {
      expect(publicPeriodFor(browsable, '2026-03', NOW, TZ)).toBe('2026-03')
      expect(publicPeriodFor(browsable, '2026-07', NOW, TZ)).toBe('2026-07')
    })

    it('rejects a period before period_from', () => {
      expect(errorCodeOf(() => publicPeriodFor(browsable, '2026-02', NOW, TZ))).toBe('before_period_from')
    })

    it('rejects an unfinished period', () => {
      expect(errorCodeOf(() => publicPeriodFor(browsable, '2026-11', NOW, TZ))).toBe('not_finished')
    })

    it('rejects a period of another granularity', () => {
      expect(errorCodeOf(() => publicPeriodFor(browsable, '2026-W30', NOW, TZ))).toBe('granularity_mismatch')
    })

    it('rejects a key that does not parse', () => {
      expect(errorCodeOf(() => publicPeriodFor(browsable, '2026-W60', NOW, TZ))).toBe('invalid')
    })
  })
})
