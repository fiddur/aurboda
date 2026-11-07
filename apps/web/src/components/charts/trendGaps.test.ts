import { describe, expect, test } from 'vitest'

import { trendPlot, trendPlotSeries, trimLeadingZeros } from './trendGaps'

const p = (date: string, value: number) => ({ date, value })

describe('trimLeadingZeros', () => {
  test('drops the zeros before the first sample', () => {
    expect(trimLeadingZeros([p('2026-01-01', 0), p('2026-01-02', 0), p('2026-01-03', 5)])).toEqual([
      p('2026-01-03', 5),
    ])
  })

  test('keeps zeros after the first sample', () => {
    const points = [p('2026-01-01', 0), p('2026-01-02', 3), p('2026-01-03', 0), p('2026-01-04', 2)]
    expect(trimLeadingZeros(points)).toEqual(points.slice(1))
  })

  test('leaves a series that starts with data alone', () => {
    const points = [p('2026-01-01', 1), p('2026-01-02', 0)]
    expect(trimLeadingZeros(points)).toBe(points)
  })

  test('leaves an all-zero series alone', () => {
    const points = [p('2026-01-01', 0), p('2026-01-02', 0)]
    expect(trimLeadingZeros(points)).toBe(points)
  })

  test('handles an empty series', () => {
    expect(trimLeadingZeros([])).toEqual([])
  })
})

describe('trendPlot', () => {
  test('keeps the x-axis on the whole history', () => {
    const plot = trendPlot([p('2026-01-01', 0), p('2026-01-02', 4), p('2026-01-03', 6)])
    expect(plot.data).toEqual([p('2026-01-02', 4), p('2026-01-03', 6)])
    expect(plot.xDomain).toEqual([new Date('2026-01-01'), new Date('2026-01-03')])
  })

  test('has no domain for an empty history', () => {
    expect(trendPlot([]).xDomain).toBeUndefined()
  })
})

describe('trendPlotSeries', () => {
  test('trims each series and spans the x-axis over all of them', () => {
    const plot = trendPlotSeries([
      { data: [p('2026-01-01', 0), p('2026-01-02', 0), p('2026-01-03', 2)], name: 'a' },
      { data: [p('2026-01-01', 1), p('2026-01-02', 0), p('2026-01-04', 2)], name: 'b' },
    ])
    expect(plot.series).toEqual([
      { data: [p('2026-01-03', 2)], name: 'a' },
      { data: [p('2026-01-01', 1), p('2026-01-02', 0), p('2026-01-04', 2)], name: 'b' },
    ])
    expect(plot.xDomain).toEqual([new Date('2026-01-01'), new Date('2026-01-04')])
  })
})
