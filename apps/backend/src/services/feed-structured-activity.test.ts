import { describe, expect, test } from 'vitest'

import { downsampleRoutePoints } from './feed-structured-activity.ts'

describe('downsampleRoutePoints', () => {
  test('passes a list at or under the cap through unchanged', () => {
    const points = [1, 2, 3]
    expect(downsampleRoutePoints(points, 3)).toBe(points)
    expect(downsampleRoutePoints(points, 500)).toBe(points)
    expect(downsampleRoutePoints([], 500)).toEqual([])
  })

  test('downsamples evenly to the cap, keeping the first and last points', () => {
    const points = Array.from({ length: 2000 }, (_, i) => i)
    const out = downsampleRoutePoints(points, 500)
    expect(out).toHaveLength(500)
    expect(out[0]).toBe(0)
    expect(out.at(-1)).toBe(1999)
    // Strictly increasing (time-ordered input stays time-ordered).
    for (let i = 1; i < out.length; i++) expect(out[i]!).toBeGreaterThan(out[i - 1]!)
  })

  test('a cap of 2 keeps exactly the endpoints', () => {
    expect(downsampleRoutePoints([10, 20, 30, 40], 2)).toEqual([10, 40])
  })
})
