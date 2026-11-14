import { describe, expect, test } from 'vitest'

import { debtSeries, formatDebt, hasNights } from './sleepDebt'

describe('sleep debt helpers', () => {
  test('formats debt minutes as hours and minutes', () => {
    expect(formatDebt(0)).toBe('0m')
    expect(formatDebt(45)).toBe('45m')
    expect(formatDebt(135)).toBe('2h 15m')
  })

  test('places each date at local noon', () => {
    const [[time, value]] = debtSeries([
      { date: '2026-03-01', debt_minutes: 30, severity: 'none', slept_minutes: 450 },
    ])
    expect(time.getHours()).toBe(12)
    expect(time.getDate()).toBe(1)
    expect(value).toBe(30)
  })

  test('tells a range with nights from one without', () => {
    const day = { date: '2026-03-01', debt_minutes: 0, severity: 'none' as const }
    expect(hasNights({ days: [{ ...day, slept_minutes: null }] })).toBe(false)
    expect(hasNights({ days: [{ ...day, slept_minutes: 420 }] })).toBe(true)
  })
})
