import { describe, expect, test } from 'vitest'
import { reduceTimeSeries } from './utils'

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
