import { describe, expect, test } from 'vitest'

import { aggregateBucketsAligned, type MetricBucketParsed, preprocessData } from './chart'

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

describe('aggregateBucketsAligned', () => {
  const daily = (iso: string, steps: number): MetricBucketParsed => {
    const start = new Date(`${iso}T00:00:00Z`)
    return {
      end: new Date(start.getTime() + 86_400_000),
      metrics: { steps: { avg: steps, count: 1, max: steps, min: steps, sum: steps } },
      start,
    }
  }

  test('groups days into Monday-started weeks', () => {
    // Thu 2026-01-01 .. Tue 2026-01-06: Thu-Sun fall in the week of Mon 2025-12-29.
    const days = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06']
    const weeks = aggregateBucketsAligned(
      days.map((d) => daily(d, 1000)),
      '1w',
    )
    expect(weeks.map((w) => [w.start.toISOString(), w.end.toISOString(), w.metrics.steps?.sum])).toEqual([
      ['2025-12-29T00:00:00.000Z', '2026-01-05T00:00:00.000Z', 4000],
      ['2026-01-05T00:00:00.000Z', '2026-01-12T00:00:00.000Z', 2000],
    ])
  })

  test('groups hours into local days', () => {
    const hourly: MetricBucketParsed[] = Array.from({ length: 30 }, (_, i) => {
      const start = new Date(Date.UTC(2026, 2, 10, 20) + i * 3_600_000)
      return {
        end: new Date(start.getTime() + 3_600_000),
        metrics: { steps: { avg: 10, count: 1, max: 10, min: 10, sum: 10 } },
        start,
      }
    })
    const days = aggregateBucketsAligned(hourly, '1d')
    expect(days.map((d) => [d.start.toISOString(), d.end.toISOString(), d.metrics.steps?.sum])).toEqual([
      ['2026-03-10T00:00:00.000Z', '2026-03-11T00:00:00.000Z', 40],
      ['2026-03-11T00:00:00.000Z', '2026-03-12T00:00:00.000Z', 240],
      ['2026-03-12T00:00:00.000Z', '2026-03-13T00:00:00.000Z', 20],
    ])
  })
})
