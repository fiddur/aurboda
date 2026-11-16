import { describe, expect, test } from 'vitest'

import {
  describeImpactMeta,
  describeOccurrences,
  describeSubtypeCount,
  formatAvgDuration,
  impactPeriodLabel,
  subtypesTitle,
  withImpactPeriod,
} from './occurrences'

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

describe('impactPeriodLabel', () => {
  test('names each long period', () => {
    expect([180, 365, 730, 1825, 3650].map(impactPeriodLabel)).toEqual([
      '6 months',
      '1 year',
      '2 years',
      '5 years',
      '10 years',
    ])
  })
})

describe('withImpactPeriod', () => {
  test('adds the period when the impact has its own', () => {
    expect(withImpactPeriod('447 occurrences, avg 21 min', 365)).toBe(
      '447 occurrences, avg 21 min · last 1 year',
    )
  })

  test('leaves the meta alone when following the table', () => {
    expect(withImpactPeriod('3 occurrences', null)).toBe('3 occurrences')
  })
})

describe('subtypes of a parent row', () => {
  test('counts them after the occurrences', () => {
    expect(describeSubtypeCount(1)).toBe(' · incl. 1 subtype')
    expect(describeSubtypeCount(2)).toBe(' · incl. 2 subtypes')
    expect(describeSubtypeCount(0)).toBe('')
  })

  test('names them in the tooltip', () => {
    expect(subtypesTitle(['Trail running', 'Mountain running'])).toBe(
      'Includes Trail running, Mountain running',
    )
    expect(subtypesTitle([])).toBeUndefined()
  })
})
