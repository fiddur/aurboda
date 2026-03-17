import { describe, expect, test } from 'vitest'

import { preprocessData } from './chart'

describe('preprocessData', () => {
  test('returns empty array for empty input', () => {
    expect(preprocessData([], 10)).toEqual([])
  })

  test('returns single element unchanged', () => {
    const data: [Date, number][] = [[new Date('2024-01-01T10:00:00Z'), 70]]
    expect(preprocessData(data, 10)).toEqual([[new Date('2024-01-01T10:00:00Z'), 70]])
  })

  test('keeps consecutive points without null when gap is below threshold', () => {
    const data: [Date, number][] = [
      [new Date('2024-01-01T10:00:00Z'), 70],
      [new Date('2024-01-01T10:05:00Z'), 72], // 5 min gap
      [new Date('2024-01-01T10:09:00Z'), 75], // 4 min gap
    ]

    const result = preprocessData(data, 10)

    expect(result).toEqual([
      [new Date('2024-01-01T10:00:00Z'), 70],
      [new Date('2024-01-01T10:05:00Z'), 72],
      [new Date('2024-01-01T10:09:00Z'), 75],
    ])
  })

  test('inserts null when gap exceeds threshold', () => {
    const data: [Date, number][] = [
      [new Date('2024-01-01T10:00:00Z'), 70],
      [new Date('2024-01-01T10:30:00Z'), 72], // 30 min gap
    ]

    const result = preprocessData(data, 10)

    expect(result).toEqual([
      [new Date('2024-01-01T10:00:00Z'), 70],
      null,
      [new Date('2024-01-01T10:30:00Z'), 72],
    ])
  })

  test('inserts multiple nulls for multiple gaps', () => {
    const data: [Date, number][] = [
      [new Date('2024-01-01T10:00:00Z'), 70],
      [new Date('2024-01-01T10:05:00Z'), 72], // 5 min - ok
      [new Date('2024-01-01T11:00:00Z'), 80], // 55 min - gap
      [new Date('2024-01-01T11:05:00Z'), 82], // 5 min - ok
      [new Date('2024-01-01T12:00:00Z'), 90], // 55 min - gap
    ]

    const result = preprocessData(data, 10)

    expect(result).toEqual([
      [new Date('2024-01-01T10:00:00Z'), 70],
      [new Date('2024-01-01T10:05:00Z'), 72],
      null,
      [new Date('2024-01-01T11:00:00Z'), 80],
      [new Date('2024-01-01T11:05:00Z'), 82],
      null,
      [new Date('2024-01-01T12:00:00Z'), 90],
    ])
  })

  test('respects custom threshold', () => {
    const data: [Date, number][] = [
      [new Date('2024-01-01T10:00:00Z'), 70],
      [new Date('2024-01-01T10:03:00Z'), 72], // 3 min gap
    ]

    // With 5 min threshold - no null
    expect(preprocessData(data, 5)).toEqual([
      [new Date('2024-01-01T10:00:00Z'), 70],
      [new Date('2024-01-01T10:03:00Z'), 72],
    ])

    // With 2 min threshold - insert null
    expect(preprocessData(data, 2)).toEqual([
      [new Date('2024-01-01T10:00:00Z'), 70],
      null,
      [new Date('2024-01-01T10:03:00Z'), 72],
    ])
  })

  test('handles exact threshold boundary', () => {
    const data: [Date, number][] = [
      [new Date('2024-01-01T10:00:00Z'), 70],
      [new Date('2024-01-01T10:10:00Z'), 72], // exactly 10 min
    ]

    // At exactly threshold - should NOT insert null (must exceed)
    expect(preprocessData(data, 10)).toEqual([
      [new Date('2024-01-01T10:00:00Z'), 70],
      [new Date('2024-01-01T10:10:00Z'), 72],
    ])

    // Just over threshold - should insert null
    const dataOver: [Date, number][] = [
      [new Date('2024-01-01T10:00:00Z'), 70],
      [new Date('2024-01-01T10:10:01Z'), 72], // 10 min 1 sec
    ]
    expect(preprocessData(dataOver, 10)).toEqual([
      [new Date('2024-01-01T10:00:00Z'), 70],
      null,
      [new Date('2024-01-01T10:10:01Z'), 72],
    ])
  })
})
