import { describe, expect, it } from 'vitest'

import { fromDatetimeLocal, toDatetimeLocal } from './datetimeLocal'

describe('toDatetimeLocal', () => {
  it('formats a Date as local wall-clock time', () => {
    expect(toDatetimeLocal(new Date(2026, 8, 13, 7, 5))).toBe('2026-09-13T07:05')
  })

  it('accepts an ISO string', () => {
    const iso = new Date(2026, 0, 2, 23, 45).toISOString()
    expect(toDatetimeLocal(iso)).toBe('2026-01-02T23:45')
  })

  it('returns empty for missing or unparseable values', () => {
    expect(toDatetimeLocal(undefined)).toBe('')
    expect(toDatetimeLocal(null)).toBe('')
    expect(toDatetimeLocal('')).toBe('')
    expect(toDatetimeLocal('not a date')).toBe('')
  })
})

describe('fromDatetimeLocal', () => {
  it('parses an input value back to the same instant', () => {
    const original = new Date(2026, 8, 13, 7, 5)
    const parsed = fromDatetimeLocal(toDatetimeLocal(original))
    expect(parsed?.getTime()).toBe(original.getTime())
  })

  it('returns undefined for blank or unparseable input', () => {
    expect(fromDatetimeLocal('')).toBeUndefined()
    expect(fromDatetimeLocal('tomorrow-ish')).toBeUndefined()
  })
})
