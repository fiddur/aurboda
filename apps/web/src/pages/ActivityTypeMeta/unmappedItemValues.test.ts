import { describe, expect, test } from 'vitest'

import { loadedUnmapped, nextUnmappedOffset, unmappedSummary } from './unmappedItemValues'

describe('unmappedSummary', () => {
  test('counts the names', () => {
    expect(unmappedSummary(2)).toBe('2 exercise names are not matched to the built-in catalogue.')
  })

  test('uses the singular for one name', () => {
    expect(unmappedSummary(1)).toBe('1 exercise name is not matched to the built-in catalogue.')
  })
})

describe('the fetched pages', () => {
  const page = (from: number, to: number, total = 45) => ({
    total,
    values: Array.from({ length: to - from }, (_, i) => from + i),
  })

  test('one page: its rows, how many remain and where the next starts', () => {
    expect(loadedUnmapped([page(0, 20)])).toEqual({ remaining: 25, rows: page(0, 20).values, total: 45 })
    expect(nextUnmappedOffset([page(0, 20)])).toBe(20)
  })

  test('every page fetched: nothing remains and there is no next page', () => {
    const pages = [page(0, 20), page(20, 40), page(40, 45)]
    expect(loadedUnmapped(pages)).toMatchObject({ remaining: 0, total: 45 })
    expect(loadedUnmapped(pages).rows).toHaveLength(45)
    expect(nextUnmappedOffset(pages)).toBeUndefined()
  })

  test('the latest page’s total counts, after names left the list', () => {
    const pages = [page(0, 20, 44), page(20, 40, 44)]
    expect(loadedUnmapped(pages)).toMatchObject({ remaining: 4, total: 44 })
    expect(nextUnmappedOffset(pages)).toBe(40)
  })

  test('no pages', () => {
    expect(loadedUnmapped([])).toEqual({ remaining: 0, rows: [], total: 0 })
    expect(nextUnmappedOffset([])).toBeUndefined()
  })
})
