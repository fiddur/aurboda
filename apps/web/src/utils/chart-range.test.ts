import { describe, expect, test } from 'vitest'

import {
  chartRange,
  localDateKey,
  lookbackToRange,
  parseSince,
  sinceForLookback,
  sinceToLookbackDays,
  validateSince,
  widgetLookbackDays,
  widgetRange,
} from './chart-range'

const now = new Date(2026, 10, 11, 15, 30)

describe('parseSince', () => {
  test('accepts a real calendar date', () => {
    expect(parseSince('2026-03-01')).toBe('2026-03-01')
    expect(parseSince('2024-02-29')).toBe('2024-02-29')
  })

  test('rejects missing, malformed and impossible dates', () => {
    expect(parseSince(undefined)).toBeUndefined()
    expect(parseSince('')).toBeUndefined()
    expect(parseSince('2026-3-1')).toBeUndefined()
    expect(parseSince('yesterday')).toBeUndefined()
    expect(parseSince('2026-02-30')).toBeUndefined()
    expect(parseSince('2025-02-29')).toBeUndefined()
    expect(parseSince('2026-13-01')).toBeUndefined()
  })

  test('starts at 1970-01-01, like the stored widget schema', () => {
    expect(parseSince('1970-01-01')).toBe('1970-01-01')
    expect(parseSince('1969-12-31')).toBeUndefined()
    expect(parseSince('0099-01-01')).toBeUndefined()
    expect(parseSince('0000-01-01')).toBeUndefined()
  })
})

describe('validateSince', () => {
  test('accepts a past date and today', () => {
    expect(validateSince('2026-01-01', now)).toEqual({ since: '2026-01-01' })
    expect(validateSince('2026-11-11', now)).toEqual({ since: '2026-11-11' })
  })

  test('rejects a future date', () => {
    expect(validateSince('2026-11-12', now)).toEqual({ error: 'The date is in the future.' })
  })

  test('rejects an empty or invalid date', () => {
    expect(validateSince('', now)).toEqual({ error: 'Pick a date.' })
    expect(validateSince('2026-02-30', now)).toEqual({ error: 'Pick a date.' })
  })
})

describe('sinceToLookbackDays', () => {
  test('counts calendar days from the date to today', () => {
    expect(sinceToLookbackDays('2026-11-01', now)).toBe(10)
    expect(sinceToLookbackDays('2025-11-11', now)).toBe(365)
  })

  test('is at least one day, so today is a range of its own', () => {
    expect(sinceToLookbackDays('2026-11-11', now)).toBe(1)
  })

  test('counts across a daylight-saving change as whole days', () => {
    expect(sinceToLookbackDays('2026-10-20', new Date(2026, 10, 1, 0, 30))).toBe(12)
    expect(sinceToLookbackDays('2026-03-20', new Date(2026, 3, 1, 23, 30))).toBe(12)
  })
})

describe('sinceForLookback', () => {
  test('is the date that many days before today', () => {
    expect(sinceForLookback(10, now)).toBe('2026-11-01')
    expect(sinceForLookback(365, now)).toBe('2025-11-11')
  })

  test('round-trips through sinceToLookbackDays', () => {
    expect(sinceToLookbackDays(sinceForLookback(90, now), now)).toBe(90)
  })
})

describe('localDateKey', () => {
  test('formats the local calendar date', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})

describe('lookbackToRange', () => {
  test('ends today and starts the given number of days earlier, on day boundaries', () => {
    expect(lookbackToRange(30, now)).toEqual({
      end: '2026-11-11T23:59:59.000Z',
      start: '2026-10-12T00:00:00.000Z',
    })
  })
})

describe('chartRange', () => {
  test('uses lookback_days when no since date is set', () => {
    expect(chartRange({ lookback_days: 30, since: '' }, now)).toEqual({
      lookback_days: 30,
      ...lookbackToRange(30, now),
    })
  })

  test('a since date wins: the range starts at its local midnight', () => {
    expect(chartRange({ lookback_days: 30, since: '2026-03-01' }, now)).toEqual({
      end: lookbackToRange(30, now).end,
      lookback_days: sinceToLookbackDays('2026-03-01', now),
      start: new Date(2026, 2, 1).toISOString(),
    })
  })
})

describe('widgetLookbackDays', () => {
  test('a since date wins over the stored lookback', () => {
    expect(widgetLookbackDays(30, '2026-11-01', now)).toBe(10)
    expect(widgetLookbackDays(30, undefined, now)).toBe(30)
  })

  test('a since date later than today counts as today', () => {
    expect(widgetLookbackDays(30, '2027-01-01', now)).toBe(widgetLookbackDays(30, '2026-11-11', now))
  })
})

describe('widgetRange', () => {
  test('ends now and starts lookbackDays back without a since date', () => {
    expect(widgetRange(7, undefined, now)).toEqual({
      end: now.toISOString(),
      start: new Date(2026, 10, 4, 15, 30).toISOString(),
    })
  })

  test("starts at the since date's local midnight when set", () => {
    expect(widgetRange(7, '2026-03-01', now)).toEqual({
      end: now.toISOString(),
      start: new Date(2026, 2, 1).toISOString(),
    })
  })

  test("a since date later than today starts at today's midnight, never after the end", () => {
    expect(widgetRange(7, '2027-01-01', now)).toEqual({
      end: now.toISOString(),
      start: new Date(2026, 10, 11).toISOString(),
    })
  })
})
