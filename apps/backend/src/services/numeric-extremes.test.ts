import { describe, expect, test } from 'vitest'

import { maxOf, minOf } from './numeric-extremes.ts'

describe('maxOf / minOf', () => {
  test('finds the extremes of a normal array', () => {
    expect(maxOf([3, 9, 1, 7])).toBe(9)
    expect(minOf([3, 9, 1, 7])).toBe(1)
  })

  test('returns undefined for an empty array rather than ∓Infinity', () => {
    expect(maxOf([])).toBeUndefined()
    expect(minOf([])).toBeUndefined()
  })

  test('handles a single element', () => {
    expect(maxOf([42])).toBe(42)
    expect(minOf([42])).toBe(42)
  })

  test('handles negative and zero values', () => {
    expect(maxOf([-5, -1, -9])).toBe(-1)
    expect(minOf([-5, -1, -9])).toBe(-9)
    expect(maxOf([0, -1])).toBe(0)
  })

  test('skips NaN instead of poisoning the result', () => {
    expect(maxOf([3, Number.NaN, 9])).toBe(9)
    expect(minOf([3, Number.NaN, 1])).toBe(1)
    expect(maxOf([Number.NaN])).toBeUndefined()
  })

  test('handles an array far past the argument limit that would break Math.max', () => {
    // 200k elements. `Math.max(...values)` blows the call stack around this size,
    // which is what took the backend down on a wide timeline zoom-out over
    // per-second data. Not asserted here: the exact threshold is a property of
    // V8's stack size, not of this code, so it moves with --stack-size and
    // platform.
    const values = Array.from({ length: 200_000 }, (_, i) => i)

    expect(maxOf(values)).toBe(199_999)
    expect(minOf(values)).toBe(0)
  })
})
