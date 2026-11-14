import { describe, expect, it } from 'vitest'

import { elapsedSeconds, extendRest, formatClock, restState, skipRest } from './restTimer'

const at = '2026-11-10T17:30:00.000Z'
const t0 = Date.parse(at)

describe('restState', () => {
  it('counts down from the newest set', () => {
    expect(restState(at, 120, t0 + 48_000)).toEqual({ remaining_s: 72, total_s: 120 })
    expect(restState(at, 120, t0)).toEqual({ remaining_s: 120, total_s: 120 })
  })

  it('ends at zero and is absent without a set', () => {
    expect(restState(at, 120, t0 + 120_000)).toBeUndefined()
    expect(restState(undefined, 120, t0)).toBeUndefined()
    expect(restState('nonsense', 120, t0)).toBeUndefined()
  })

  it('adds the extension and honours a skip for the same set only', () => {
    const extended = extendRest(at, extendRest(at, undefined))
    expect(extended.extra_s).toBe(60)
    expect(restState(at, 120, t0 + 150_000, extended)).toEqual({ remaining_s: 30, total_s: 180 })
    expect(restState(at, 120, t0, skipRest(at))).toBeUndefined()
    const later = '2026-11-10T17:35:00.000Z'
    expect(restState(later, 120, Date.parse(later), skipRest(at))).toEqual({ remaining_s: 120, total_s: 120 })
    expect(extendRest(later, extended).extra_s).toBe(30)
  })
})

describe('formatClock', () => {
  it('formats minutes and seconds, and hours when there are any', () => {
    expect(formatClock(72)).toBe('1:12')
    expect(formatClock(5)).toBe('0:05')
    expect(formatClock(34 * 60 + 12)).toBe('34:12')
    expect(formatClock(3600 + 4 * 60 + 12)).toBe('1:04:12')
    expect(formatClock(-3)).toBe('0:00')
  })
})

describe('elapsedSeconds', () => {
  it('counts whole seconds since the start, never negative', () => {
    expect(elapsedSeconds(at, t0 + 61_900)).toBe(61)
    expect(elapsedSeconds(at, t0 - 5000)).toBe(0)
  })
})
