import { describe, expect, it } from 'vitest'

import { effectiveBucketSize } from './challenge-spec.ts'

const days = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000)
const start = new Date('2026-07-01T00:00:00.000Z')
const after = (d: number) => new Date(start.getTime() + d * 24 * 60 * 60 * 1000)

describe('effectiveBucketSize', () => {
  it('uses a fixed creator choice as-is (override for long challenges)', () => {
    expect(effectiveBucketSize('1d', start, after(365))).toBe('1d')
    expect(effectiveBucketSize('1w', start, after(1))).toBe('1w')
    expect(effectiveBucketSize('1M', start, after(3))).toBe('1M')
  })

  it('adapts "auto" to the window: finer for short, coarser for long', () => {
    expect(effectiveBucketSize('auto', start, after(1))).toBe('5m') // <= 1 day
    expect(effectiveBucketSize('auto', start, after(2))).toBe('15m') // <= 3 days
    expect(effectiveBucketSize('auto', start, after(3))).toBe('15m')
    expect(effectiveBucketSize('auto', start, after(7))).toBe('1h') // <= 14 days
    expect(effectiveBucketSize('auto', start, after(14))).toBe('1h')
    expect(effectiveBucketSize('auto', start, after(30))).toBe('1d') // <= 120 days
    expect(effectiveBucketSize('auto', start, after(120))).toBe('1d')
    expect(effectiveBucketSize('auto', start, after(200))).toBe('1w') // > 120 days
  })

  it('treats a sub-day window as the finest bucket', () => {
    expect(effectiveBucketSize('auto', start, new Date(start.getTime() + 13 * 60 * 60 * 1000))).toBe('5m')
    expect(effectiveBucketSize('auto', new Date(), days(1))).toBe('5m')
  })
})
