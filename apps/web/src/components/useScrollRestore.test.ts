import { describe, expect, it } from 'vitest'

import { readScroll, saveScroll } from './useScrollRestore'

const memoryStorage = () => {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  }
}

const throwingStorage = () => {
  throw new Error('SecurityError')
}

describe('scroll restore storage', () => {
  it('round-trips a position per key', () => {
    const storage = memoryStorage()
    saveScroll(() => storage, 'board-1:2026-10', 812.4)
    expect(storage.data.get('aurboda:scroll:board-1:2026-10')).toBe('812')
    expect(readScroll(() => storage, 'board-1:2026-10')).toBe(812)
    expect(readScroll(() => storage, 'board-1:2026-09')).toBeUndefined()
  })

  it('has nothing to restore at the top or for a malformed value', () => {
    const storage = memoryStorage()
    saveScroll(() => storage, 'top', 0)
    storage.setItem('aurboda:scroll:bad', 'abc')
    expect(readScroll(() => storage, 'top')).toBeUndefined()
    expect(readScroll(() => storage, 'bad')).toBeUndefined()
  })

  it('survives storage that throws', () => {
    expect(() => saveScroll(throwingStorage, 'k', 100)).not.toThrow()
    expect(readScroll(throwingStorage, 'k')).toBeUndefined()
  })
})
