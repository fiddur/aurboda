import { describe, expect, test } from 'vitest'

import { mapWithConcurrency, pushAll, reduceTimeSeries } from './utils.ts'

describe('reduceTimeSeries', () => {
  test('removes duplicate dates keeping first occurrence', () => {
    const series: [Date, number][] = [
      [new Date('1976-03-04'), 42],
      [new Date('1976-03-05'), 43],
      [new Date('1976-03-04'), 99],
    ]

    expect(reduceTimeSeries(series)).toEqual([
      [new Date('1976-03-04'), 42],
      [new Date('1976-03-05'), 43],
    ])
  })

  test('returns empty array for empty input', () => {
    expect(reduceTimeSeries([])).toEqual([])
  })

  test('returns single element unchanged', () => {
    const series: [Date, string][] = [[new Date('2024-01-01'), 'only']]
    expect(reduceTimeSeries(series)).toEqual([[new Date('2024-01-01'), 'only']])
  })

  test('sorts dates chronologically', () => {
    const series: [Date, number][] = [
      [new Date('2024-03-01'), 3],
      [new Date('2024-01-01'), 1],
      [new Date('2024-02-01'), 2],
    ]

    expect(reduceTimeSeries(series)).toEqual([
      [new Date('2024-01-01'), 1],
      [new Date('2024-02-01'), 2],
      [new Date('2024-03-01'), 3],
    ])
  })

  test('handles all duplicate dates', () => {
    const series: [Date, number][] = [
      [new Date('2024-01-01'), 1],
      [new Date('2024-01-01'), 2],
      [new Date('2024-01-01'), 3],
    ]

    expect(reduceTimeSeries(series)).toEqual([[new Date('2024-01-01'), 1]])
  })

  test('preserves value type with objects', () => {
    const series: [Date, { value: number }][] = [
      [new Date('2024-01-01'), { value: 100 }],
      [new Date('2024-01-02'), { value: 200 }],
    ]

    expect(reduceTimeSeries(series)).toEqual([
      [new Date('2024-01-01'), { value: 100 }],
      [new Date('2024-01-02'), { value: 200 }],
    ])
  })

  test('handles dates with same day but different times', () => {
    const series: [Date, number][] = [
      [new Date('2024-01-01T10:00:00Z'), 1],
      [new Date('2024-01-01T12:00:00Z'), 2],
      [new Date('2024-01-01T10:00:00Z'), 3],
    ]

    expect(reduceTimeSeries(series)).toEqual([
      [new Date('2024-01-01T10:00:00Z'), 1],
      [new Date('2024-01-01T12:00:00Z'), 2],
    ])
  })
})

describe('pushAll', () => {
  test('appends in order and returns the target', () => {
    const target = [1, 2]
    expect(pushAll(target, [3, 4])).toBe(target)
    expect(target).toEqual([1, 2, 3, 4])
  })

  test('handles 200k items, where push(...items) overflows the call stack', () => {
    const items = Array.from({ length: 200_000 }, (_, i) => i)
    expect(() => [].push(...(items as never[]))).toThrow(RangeError)

    const target: number[] = []
    pushAll(target, items)
    expect(target).toHaveLength(200_000)
    expect(target[199_999]).toBe(199_999)
  })
})

describe('mapWithConcurrency', () => {
  test('keeps the input order and never exceeds the limit', async () => {
    let inFlight = 0
    let peak = 0
    const result = await mapWithConcurrency([5, 1, 4, 2, 3, 0, 6], 3, async (n) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, n))
      inFlight--
      return n * 10
    })
    expect(result).toEqual([50, 10, 40, 20, 30, 0, 60])
    expect(peak).toBe(3)
  })

  test('an empty list maps to an empty list', async () => {
    expect(await mapWithConcurrency([], 5, async (n: number) => n)).toEqual([])
  })
})
