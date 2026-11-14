import { describe, expect, test, vi } from 'vitest'

import { createTtlCache } from './render-cache.ts'

const clock = (start = 0) => {
  let at = start
  return { advance: (ms: number) => (at += ms), now: () => at }
}

const bytesCache = (maxBytes: number, ttlMs = 1000, now = clock().now) =>
  createTtlCache<string>({ maxBytes, now, sizeOf: (value) => value.length, ttlMs })

describe('createTtlCache', () => {
  test('serves a value until its TTL runs out, then produces it afresh', async () => {
    const time = clock()
    const cached = bytesCache(100, 1000, time.now)
    const produce = vi.fn(async () => 'png')
    await cached('k', produce)
    time.advance(999)
    await cached('k', produce)
    expect(produce).toHaveBeenCalledTimes(1)
    time.advance(1)
    await cached('k', produce)
    expect(produce).toHaveBeenCalledTimes(2)
  })

  test('a call can set its own TTL', async () => {
    const time = clock()
    const cached = bytesCache(100, 1000, time.now)
    const produce = vi.fn(async () => 'png')
    await cached('k', produce, 100)
    time.advance(100)
    await cached('k', produce, 100)
    expect(produce).toHaveBeenCalledTimes(2)
  })

  test('collapses concurrent misses to one produce', async () => {
    const cached = bytesCache(100)
    const produce = vi.fn(async () => 'png')
    const [a, b] = await Promise.all([cached('k', produce), cached('k', produce)])
    expect([a, b]).toEqual(['png', 'png'])
    expect(produce).toHaveBeenCalledTimes(1)
  })

  test('does not keep a null result', async () => {
    const cached = bytesCache(100)
    const produce = vi.fn(async () => null)
    expect(await cached('k', produce)).toBeNull()
    expect(await cached('k', produce)).toBeNull()
    expect(produce).toHaveBeenCalledTimes(2)
  })

  test('drops the oldest entries once the held bytes pass the budget', async () => {
    const cached = bytesCache(10)
    const produce = vi.fn(async () => 'aaaa')
    await cached('k1', produce)
    await cached('k2', produce)
    await cached('k3', produce)
    await cached('k2', produce)
    await cached('k3', produce)
    expect(produce).toHaveBeenCalledTimes(3)
    await cached('k1', produce)
    expect(produce).toHaveBeenCalledTimes(4)
  })

  test('serves but does not keep a value larger than the whole budget', async () => {
    const cached = bytesCache(10)
    const small = vi.fn(async () => 'aaaa')
    const huge = vi.fn(async () => 'a'.repeat(11))
    await cached('small', small)
    expect(await cached('huge', huge)).toBe('a'.repeat(11))
    await cached('huge', huge)
    expect(huge).toHaveBeenCalledTimes(2)
    await cached('small', small)
    expect(small).toHaveBeenCalledTimes(1)
  })
})
