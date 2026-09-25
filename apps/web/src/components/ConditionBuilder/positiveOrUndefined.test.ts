import { describe, expect, test } from 'vitest'

import { positiveOrUndefined } from './positiveOrUndefined'

describe('positiveOrUndefined', () => {
  test('keeps positive numbers', () => {
    expect(positiveOrUndefined('30')).toBe(30)
    expect(positiveOrUndefined('0.5')).toBe(0.5)
  })

  test('treats empty, zero, negative and non-numeric input as unset', () => {
    expect(['', ' ', '0', '-1', '-0.2', 'abc', 'NaN'].map(positiveOrUndefined)).toEqual(
      Array(7).fill(undefined),
    )
  })
})
