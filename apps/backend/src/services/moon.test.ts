import { describe, expect, test } from 'vitest'

import { moonPhase, SYNODIC_MONTH_DAYS } from './moon.ts'

describe('moonPhase', () => {
  test('is new at the reference new moon', () => {
    const moon = moonPhase('2000-01-06')
    expect(moon.emoji).toBe('🌑')
    expect(moon.illumination).toBeLessThan(1)
    expect(moon.age_days).toBeGreaterThan(SYNODIC_MONTH_DAYS - 1)
  })

  test('is full about half a cycle later', () => {
    const moon = moonPhase('2000-01-21')
    expect(moon.emoji).toBe('🌕')
    expect(moon.illumination).toBeGreaterThan(99)
    expect(moon.age_percent).toBeGreaterThan(48)
    expect(moon.age_percent).toBeLessThan(52)
  })

  test('the three values describe the same age', () => {
    const moon = moonPhase('2024-03-10')
    expect(moon.age_percent).toBeCloseTo((moon.age_days / SYNODIC_MONTH_DAYS) * 100, 10)
    expect(moon.illumination).toBeCloseTo(
      ((1 - Math.cos((2 * Math.PI * moon.age_percent) / 100)) / 2) * 100,
      10,
    )
  })

  test('steps through the eight phase emoji over a cycle', () => {
    const start = Date.UTC(2000, 0, 7)
    const seen = Array.from({ length: 30 }, (_, i) =>
      moonPhase(new Date(start + i * 86_400_000).toISOString().slice(0, 10)),
    ).map((m) => m.emoji)
    expect([...new Set(seen)]).toEqual(['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'])
  })

  test('first quarter is a waxing half', () => {
    const moon = moonPhase('2000-01-14')
    expect(moon.emoji).toBe('🌓')
    expect(moon.illumination).toBeGreaterThan(40)
    expect(moon.illumination).toBeLessThan(65)
  })
})
