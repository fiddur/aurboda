import { periodLabel, shiftPeriodKey } from '@aurboda/api-spec'
import { describe, expect, it } from 'vitest'

import {
  isFinishedPeriod,
  latestFinishedPeriodKey,
  periodDays,
  periodKeyOf,
  periodWindow,
  previousWindow,
} from './periods.ts'

const TZ = 'Europe/Stockholm'

const iso = (w: { end: Date; start: Date }) => ({ end: w.end.toISOString(), start: w.start.toISOString() })

describe('periodWindow', () => {
  it('bounds a month in local time across the DST change', () => {
    expect(iso(periodWindow('2026-10', TZ))).toEqual({
      end: '2026-10-31T23:00:00.000Z',
      start: '2026-09-30T22:00:00.000Z',
    })
    expect(periodDays(periodWindow('2026-10', TZ))).toBe(31)
  })

  it('bounds a year', () => {
    expect(iso(periodWindow('2025', 'UTC'))).toEqual({
      end: '2026-01-01T00:00:00.000Z',
      start: '2025-01-01T00:00:00.000Z',
    })
  })

  it('starts ISO week 1 on the Monday of the week holding 4 January', () => {
    expect(iso(periodWindow('2026-W01', TZ))).toEqual({
      end: '2026-01-04T23:00:00.000Z',
      start: '2025-12-28T23:00:00.000Z',
    })
  })

  it('has a week 53 in 2026, which starts on a Thursday', () => {
    expect(iso(periodWindow('2026-W53', 'UTC'))).toEqual({
      end: '2027-01-04T00:00:00.000Z',
      start: '2026-12-28T00:00:00.000Z',
    })
    expect(() => periodWindow('2025-W53', 'UTC')).toThrow('Invalid period')
  })

  it('rejects malformed keys', () => {
    expect(() => periodWindow('2026-13', 'UTC')).toThrow('Invalid period')
    expect(() => periodWindow('oct', 'UTC')).toThrow('Invalid period')
  })

  it('gives the previous calendar period', () => {
    expect(iso(previousWindow('2026-10', 'UTC'))).toEqual({
      end: '2026-10-01T00:00:00.000Z',
      start: '2026-09-01T00:00:00.000Z',
    })
    expect(iso(previousWindow('2026-W01', 'UTC')).start).toBe('2025-12-22T00:00:00.000Z')
  })
})

describe('periodKeyOf', () => {
  it('keys by the local calendar date', () => {
    expect(periodKeyOf(new Date('2026-10-31T23:30:00Z'), 'month', TZ)).toBe('2026-11')
    expect(periodKeyOf(new Date('2026-10-31T22:30:00Z'), 'month', TZ)).toBe('2026-10')
  })

  it('uses the ISO week-year', () => {
    expect(periodKeyOf(new Date('2025-12-30T12:00:00Z'), 'week', TZ)).toBe('2026-W01')
    expect(periodKeyOf(new Date('2027-01-02T12:00:00Z'), 'week', TZ)).toBe('2026-W53')
    expect(periodKeyOf(new Date('2027-01-02T12:00:00Z'), 'year', TZ)).toBe('2027')
  })
})

describe('latestFinishedPeriodKey', () => {
  const now = new Date('2026-11-07T10:00:00Z')

  it('is the period before the one holding now', () => {
    expect(latestFinishedPeriodKey('month', now, TZ)).toBe('2026-10')
    expect(latestFinishedPeriodKey('week', now, TZ)).toBe('2026-W44')
    expect(latestFinishedPeriodKey('year', now, TZ)).toBe('2025')
  })

  it('wraps into the previous year', () => {
    const january = new Date('2026-01-03T10:00:00Z')
    expect(latestFinishedPeriodKey('month', january, TZ)).toBe('2025-12')
    expect(latestFinishedPeriodKey('week', january, TZ)).toBe('2025-W52')
  })
})

describe('isFinishedPeriod', () => {
  it('is finished exactly at the exclusive end', () => {
    expect(isFinishedPeriod('2026-10', new Date('2026-10-31T23:00:00Z'), TZ)).toBe(true)
    expect(isFinishedPeriod('2026-10', new Date('2026-10-31T22:59:59.999Z'), TZ)).toBe(false)
  })
})

describe('api-spec period keys', () => {
  it('shifts across year and week-year boundaries', () => {
    expect(shiftPeriodKey('2026-01', -1)).toBe('2025-12')
    expect(shiftPeriodKey('2025-12', 13)).toBe('2027-01')
    expect(shiftPeriodKey('2026-W53', 1)).toBe('2027-W01')
    expect(shiftPeriodKey('2027-W01', -1)).toBe('2026-W53')
    expect(shiftPeriodKey('2026-W01', -1)).toBe('2025-W52')
    expect(shiftPeriodKey('2026', -1)).toBe('2025')
    expect(shiftPeriodKey('nope', 1)).toBeNull()
  })

  it('labels each granularity', () => {
    expect(periodLabel('2026-10')).toBe('October 2026')
    expect(periodLabel('2026-W44')).toBe('Week 44, 2026')
    expect(periodLabel('2026')).toBe('2026')
  })
})
