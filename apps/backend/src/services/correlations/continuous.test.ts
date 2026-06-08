import { describe, expect, test } from 'vitest'

import { computeContinuous } from './continuous.ts'

const seriesMap = (entries: [string, number][]): Map<string, number> => new Map(entries)

describe('computeContinuous', () => {
  test('perfectly correlated same-day series', () => {
    const days = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04']
    const trigger = seriesMap(days.map((d, i) => [d, i + 1]))
    const outcome = seriesMap(days.map((d, i) => [d, 2 * (i + 1)]))

    const result = computeContinuous({
      triggerDaily: trigger,
      outcomeDaily: outcome,
      triggerKnown: days,
      outcomeKnown: days,
      lagDays: 0,
    })

    expect(result.n).toBe(4)
    expect(result.pearson).toBeCloseTo(1, 5)
    expect(result.spearman).toBeCloseTo(1, 5)
  })

  test('lag shifts the outcome forward by N days', () => {
    const days = ['2024-01-01', '2024-01-02', '2024-01-03']
    // outcome on day d+1 equals trigger on day d
    const trigger = seriesMap([
      ['2024-01-01', 10],
      ['2024-01-02', 20],
      ['2024-01-03', 30],
    ])
    const outcome = seriesMap([
      ['2024-01-02', 10],
      ['2024-01-03', 20],
      ['2024-01-04', 30],
    ])

    const result = computeContinuous({
      triggerDaily: trigger,
      outcomeDaily: outcome,
      triggerKnown: days,
      outcomeKnown: ['2024-01-02', '2024-01-03', '2024-01-04'],
      lagDays: 1,
    })

    expect(result.n).toBe(3)
    expect(result.pearson).toBeCloseTo(1, 5)
    expect(result.series[0]).toEqual({ date: '2024-01-01', trigger: 10, outcome: 10 })
  })

  test('only pairs days where both sides are known', () => {
    const trigger = seriesMap([
      ['2024-01-01', 1],
      ['2024-01-02', 2],
      ['2024-01-03', 3],
    ])
    const outcome = seriesMap([
      ['2024-01-01', 5],
      ['2024-01-03', 9],
    ])

    const result = computeContinuous({
      triggerDaily: trigger,
      outcomeDaily: outcome,
      triggerKnown: ['2024-01-01', '2024-01-02', '2024-01-03'],
      outcomeKnown: ['2024-01-01', '2024-01-03'], // day 2 unknown
      lagDays: 0,
    })

    expect(result.n).toBe(2)
  })

  test('missing value on a known day defaults to 0', () => {
    const result = computeContinuous({
      triggerDaily: seriesMap([['2024-01-01', 100]]), // day 2 known but absent -> 0
      outcomeDaily: seriesMap([
        ['2024-01-01', 1],
        ['2024-01-02', 2],
        ['2024-01-03', 3],
      ]),
      triggerKnown: ['2024-01-01', '2024-01-02', '2024-01-03'],
      outcomeKnown: ['2024-01-01', '2024-01-02', '2024-01-03'],
      lagDays: 0,
    })

    expect(result.n).toBe(3)
    const day2 = result.series.find((p) => p.date === '2024-01-02')
    expect(day2?.trigger).toBe(0)
  })

  test('caps the returned series', () => {
    const days = Array.from({ length: 50 }, (_, i) =>
      new Date(Date.parse('2024-01-01T00:00:00Z') + i * 86_400_000).toISOString().split('T')[0],
    )
    const trigger = seriesMap(days.map((d, i) => [d, i]))
    const outcome = seriesMap(days.map((d, i) => [d, i]))

    const result = computeContinuous({
      triggerDaily: trigger,
      outcomeDaily: outcome,
      triggerKnown: days,
      outcomeKnown: days,
      lagDays: 0,
      maxSeriesPoints: 10,
    })

    expect(result.n).toBe(50)
    expect(result.series).toHaveLength(10)
  })
})
