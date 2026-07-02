import { describe, expect, test } from 'vitest'

import { dedupeLastWins } from './dedupe.ts'

describe('dedupeLastWins', () => {
  test('keeps the last item per key, preserving first-seen order', () => {
    const items = [
      { k: 'a', v: 1 },
      { k: 'b', v: 2 },
      { k: 'a', v: 3 },
      { k: 'c', v: 4 },
      { k: 'b', v: 5 },
    ]
    const result = dedupeLastWins(items, (i) => i.k)
    expect(result).toEqual([
      { k: 'a', v: 3 },
      { k: 'b', v: 5 },
      { k: 'c', v: 4 },
    ])
  })

  test('never dedupes items whose key is null', () => {
    const items = [
      { k: null, v: 1 },
      { k: null, v: 2 },
      { k: 'x', v: 3 },
      { k: 'x', v: 4 },
    ]
    const result = dedupeLastWins(items, (i) => i.k)
    expect(result).toEqual([
      { k: null, v: 1 },
      { k: null, v: 2 },
      { k: 'x', v: 4 },
    ])
  })

  test('empty input', () => {
    expect(dedupeLastWins([], () => 'k')).toEqual([])
  })

  test('no duplicates passes through unchanged', () => {
    const items = [{ k: 'a' }, { k: 'b' }, { k: 'c' }]
    expect(dedupeLastWins(items, (i) => i.k)).toEqual(items)
  })
})
