import { describe, expect, test } from 'vitest'

import { describeOccurrences, formatAvgDuration } from './occurrences'

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
