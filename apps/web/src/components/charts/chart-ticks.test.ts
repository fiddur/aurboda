import { describe, expect, test } from 'vitest'

import { daySpanTickStep } from './chart-ticks'

describe('daySpanTickStep', () => {
  test('returns null for non-positive or long spans (fall back to ~6 auto ticks)', () => {
    expect(daySpanTickStep(0)).toBeNull()
    expect(daySpanTickStep(-5)).toBeNull()
    expect(daySpanTickStep(32)).toBeNull()
    expect(daySpanTickStep(90)).toBeNull()
  })

  test('one tick per day for very short spans (e.g. a 3-day challenge)', () => {
    expect(daySpanTickStep(3)).toBe(1)
    expect(daySpanTickStep(6)).toBe(1)
    expect(daySpanTickStep(7)).toBe(2)
  })

  test('caps at ~6 ticks for longer short spans (no more crowded than before)', () => {
    expect(daySpanTickStep(12)).toBe(2)
    expect(daySpanTickStep(30)).toBe(5)
    expect(daySpanTickStep(31)).toBe(6)
  })
})
