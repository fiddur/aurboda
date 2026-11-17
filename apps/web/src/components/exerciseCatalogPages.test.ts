import { describe, expect, test } from 'vitest'

import { loadedCatalog, nextCatalogOffset } from './exerciseCatalogPages'

const page = (keys: string[], total: number) => ({ entries: keys.map((key) => ({ key })), total })

describe('loadedCatalog', () => {
  test('nothing loaded', () => {
    expect(loadedCatalog([])).toEqual({ entries: [], remaining: 0, total: 0 })
  })

  test('joins the pages, with the total of the last one', () => {
    expect(loadedCatalog([page(['a', 'b'], 5), page(['c', 'd'], 6)])).toEqual({
      entries: [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }],
      remaining: 2,
      total: 6,
    })
  })

  test('never reports a negative remainder', () => {
    expect(loadedCatalog([page(['a', 'b'], 1)]).remaining).toBe(0)
  })
})

describe('nextCatalogOffset', () => {
  test('the number of loaded entries while more remain', () => {
    expect(nextCatalogOffset([page(['a', 'b'], 5)])).toBe(2)
    expect(nextCatalogOffset([page(['a', 'b'], 5), page(['c', 'd'], 5)])).toBe(4)
  })

  test('undefined when everything is loaded', () => {
    expect(nextCatalogOffset([page(['a', 'b'], 2)])).toBeUndefined()
    expect(nextCatalogOffset([page([], 0)])).toBeUndefined()
  })
})
