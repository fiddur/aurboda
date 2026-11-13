import { describe, expect, test } from 'vitest'

import { UNMAPPED_PAGE_SIZE, unmappedSummary, visibleUnmapped } from './unmappedItemValues'

describe('unmappedSummary', () => {
  test('counts the names', () => {
    expect(unmappedSummary(2)).toBe('2 exercise names are not matched to the built-in catalogue.')
  })

  test('uses the singular for one name', () => {
    expect(unmappedSummary(1)).toBe('1 exercise name is not matched to the built-in catalogue.')
  })
})

describe('visibleUnmapped', () => {
  const values = Array.from({ length: 45 }, (_, i) => i)

  test('shows the first page and how many remain', () => {
    const { rows, remaining } = visibleUnmapped(values, UNMAPPED_PAGE_SIZE)
    expect(rows).toEqual(values.slice(0, 20))
    expect(remaining).toBe(25)
  })

  test('shows everything once the limit passes the end', () => {
    const { rows, remaining } = visibleUnmapped(values, 60)
    expect(rows).toHaveLength(45)
    expect(remaining).toBe(0)
  })

  test('keeps the limit when rows leave the list', () => {
    const { rows, remaining } = visibleUnmapped(values.slice(1), 40)
    expect(rows).toHaveLength(40)
    expect(remaining).toBe(4)
  })
})
