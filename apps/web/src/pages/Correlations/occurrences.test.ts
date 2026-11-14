import { describe, expect, test } from 'vitest'

import { describeImpactMeta, describeOccurrences, formatAvgDuration } from './occurrences'

describe('formatAvgDuration', () => {
  test('formats a duration', () => {
    expect(formatAvgDuration(42)).toBe('avg 42 min')
    expect(formatAvgDuration(0)).toBe('avg 0 min')
  })

  test('is null for point activities', () => {
    expect(formatAvgDuration(undefined)).toBeNull()
    expect(formatAvgDuration(null)).toBeNull()
  })
})

describe('describeOccurrences', () => {
  test('keeps the count and adds the average duration', () => {
    expect(describeOccurrences(12, 35)).toBe('12× (avg 35 min)')
  })

  test('keeps only the count when there is no duration', () => {
    expect(describeOccurrences(7, undefined)).toBe('7×')
  })
})

describe('describeImpactMeta', () => {
  test('uses the singular for one occurrence', () => {
    expect(describeImpactMeta(1, 29)).toBe('1 occurrence, avg 29 min')
  })

  test('uses the plural otherwise', () => {
    expect(describeImpactMeta(3, 29)).toBe('3 occurrences, avg 29 min')
    expect(describeImpactMeta(0, undefined)).toBe('0 occurrences')
  })
})
