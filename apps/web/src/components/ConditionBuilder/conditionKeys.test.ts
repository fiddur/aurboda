import { describe, expect, test } from 'vitest'

import { removeKey, syncKeys } from './conditionKeys'

const counter = () => {
  let n = 0
  return () => `k${n++}`
}

describe('syncKeys', () => {
  test('keeps the same keys when the length is unchanged', () => {
    const keys = ['a', 'b']
    expect(syncKeys(keys, 2, counter())).toBe(keys)
  })

  test('appends fresh keys for added conditions', () => {
    expect(syncKeys(['a'], 3, counter())).toEqual(['a', 'k0', 'k1'])
  })

  test('drops trailing keys when conditions shrink from outside', () => {
    expect(syncKeys(['a', 'b', 'c'], 1, counter())).toEqual(['a'])
  })
})

describe('removeKey', () => {
  test('removes the key of the removed condition so the survivors keep theirs', () => {
    const keys = removeKey(['a', 'b', 'c'], 0)
    expect(keys).toEqual(['b', 'c'])
    expect(syncKeys(keys, 2, counter())).toEqual(['b', 'c'])
  })
})
