import { describe, expect, it } from 'vitest'

import { dayEndInTz, dayKey, dayKeysEndingAt, dayStartInTz, shiftDayKey } from './day-keys.ts'

const HOUR_MS = 60 * 60 * 1000

describe('dayKey', () => {
  it('keys by the UTC calendar day for UTC', () => {
    expect(dayKey(new Date('2026-02-02T23:30:00-02:00'), 'UTC')).toBe('2026-02-03')
    expect(dayKey(new Date('2026-02-02T00:00:00Z'), 'UTC')).toBe('2026-02-02')
  })

  it('keys by the local calendar day east of UTC', () => {
    expect(dayKey(new Date('2026-02-02T12:00:00Z'), 'Pacific/Auckland')).toBe('2026-02-03')
    expect(dayKey(new Date('2026-02-02T10:59:59Z'), 'Pacific/Auckland')).toBe('2026-02-02')
  })

  it('keys by the local calendar day west of UTC', () => {
    expect(dayKey(new Date('2026-02-03T05:00:00Z'), 'America/Los_Angeles')).toBe('2026-02-02')
    expect(dayKey(new Date('2026-02-03T08:00:00Z'), 'America/Los_Angeles')).toBe('2026-02-03')
  })
})

describe('shiftDayKey', () => {
  it('does calendar arithmetic across month and year ends', () => {
    expect(shiftDayKey('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDayKey('2025-12-31', 1)).toBe('2026-01-01')
    expect(shiftDayKey('2026-02-02', 0)).toBe('2026-02-02')
  })
})

describe('dayStartInTz and dayEndInTz', () => {
  it('match UTC midnight and the last millisecond for UTC', () => {
    expect(dayStartInTz('2026-02-02', 'UTC').toISOString()).toBe('2026-02-02T00:00:00.000Z')
    expect(dayEndInTz('2026-02-02', 'UTC').toISOString()).toBe('2026-02-02T23:59:59.999Z')
  })

  it('give local midnight in a +13:00 zone', () => {
    expect(dayStartInTz('2026-02-03', 'Pacific/Auckland').toISOString()).toBe('2026-02-02T11:00:00.000Z')
    expect(dayEndInTz('2026-02-03', 'Pacific/Auckland').toISOString()).toBe('2026-02-03T10:59:59.999Z')
  })

  it('give local midnight in a negative zone', () => {
    expect(dayStartInTz('2026-02-02', 'America/Los_Angeles').toISOString()).toBe('2026-02-02T08:00:00.000Z')
    expect(dayEndInTz('2026-02-02', 'America/Los_Angeles').toISOString()).toBe('2026-02-03T07:59:59.999Z')
  })

  it('span 23 hours on a spring-forward day', () => {
    const start = dayStartInTz('2026-03-29', 'Europe/Stockholm')
    const end = dayEndInTz('2026-03-29', 'Europe/Stockholm')
    expect(start.toISOString()).toBe('2026-03-28T23:00:00.000Z')
    expect(end.getTime() - start.getTime()).toBe(23 * HOUR_MS - 1)
  })
})

describe('dayKeysEndingAt', () => {
  it('lists the keys oldest first, ending with today in the zone', () => {
    const today = new Date('2026-02-02T12:00:00Z')
    expect(dayKeysEndingAt(today, 3, 'UTC')).toEqual(['2026-01-31', '2026-02-01', '2026-02-02'])
    expect(dayKeysEndingAt(today, 3, 'Pacific/Auckland')).toEqual(['2026-02-01', '2026-02-02', '2026-02-03'])
  })
})
