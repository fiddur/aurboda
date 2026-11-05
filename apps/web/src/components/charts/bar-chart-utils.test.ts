import { describe, expect, test } from 'vitest'

import { barChartYMax, clipBarSpan, overlayLine, overlayLines, parseLinePoints } from './bar-chart-utils'

describe('barChartYMax', () => {
  test('takes the largest bar without a line', () => {
    expect(barChartYMax([3, 9, 4])).toBe(9)
  })

  test('takes the line when it rises above the bars', () => {
    expect(barChartYMax([3, 9], parseLinePoints([{ date: '2026-01-01', value: 12 }]))).toBe(12)
  })

  test('falls back to 1 when nothing is drawn', () => {
    expect(barChartYMax([], [])).toBe(1)
  })

  test('covers every line', () => {
    const low = parseLinePoints([{ date: '2026-01-01', value: 4 }])
    const high = parseLinePoints([{ date: '2026-01-01', value: 15 }])
    expect(barChartYMax([3, 9], low, high)).toBe(15)
  })
})

describe('parseLinePoints', () => {
  test('parses dates the way TrendLineChart does', () => {
    expect(parseLinePoints([{ date: '2026-03-01', value: 99 }])).toEqual([
      { date: new Date('2026-03-01'), value: 99 },
    ])
  })
})

describe('overlayLine', () => {
  const domain: [Date, Date] = [new Date('2026-01-01'), new Date('2026-02-01')]
  const data = [
    { date: '2025-12-31', value: 1 },
    { date: '2026-01-15', value: 2 },
    { date: '2026-02-02', value: 3 },
  ]

  test('keeps the points inside the x domain, with no color of its own', () => {
    expect(overlayLine({ data }, domain)).toEqual({
      points: [{ date: new Date('2026-01-15'), value: 2 }],
    })
  })

  test('carries the given color', () => {
    expect(overlayLine({ color: '#000', data }, domain)?.color).toBe('#000')
  })

  test('is undefined without a line or with no point in range', () => {
    expect(overlayLine(undefined, domain)).toBeUndefined()
    expect(overlayLine({ data: [data[0]] }, domain)).toBeUndefined()
  })
})

describe('overlayLines', () => {
  const domain: [Date, Date] = [new Date('2026-01-01'), new Date('2026-02-01')]
  const inRange = [{ date: '2026-01-15', value: 2 }]
  const palette = ['#bars', '#second', '#third']

  test('the first uncolored line keeps the CSS stroke, later ones take the palette by index', () => {
    expect(overlayLines([{ data: inRange }, { data: inRange }, { data: inRange }], domain, palette)).toEqual([
      { points: [{ date: new Date('2026-01-15'), value: 2 }] },
      { color: '#second', points: [{ date: new Date('2026-01-15'), value: 2 }] },
      { color: '#third', points: [{ date: new Date('2026-01-15'), value: 2 }] },
    ])
  })

  test('a line keeps its own color and an empty one is dropped', () => {
    const lines = [{ data: [{ date: '2025-12-01', value: 1 }] }, { color: '#000', data: inRange }]
    expect(overlayLines(lines, domain, palette)).toEqual([
      { color: '#000', points: [{ date: new Date('2026-01-15'), value: 2 }] },
    ])
  })
})

describe('clipBarSpan', () => {
  test('keeps a bar inside the plot as it is', () => {
    expect(clipBarSpan(10, 8, 100)).toEqual({ width: 8, x: 10 })
  })

  test('cuts a bar that starts left of the y axis at the axis', () => {
    expect(clipBarSpan(-5, 8, 100)).toEqual({ width: 3, x: 0 })
  })

  test('cuts a bar that runs past the right edge', () => {
    expect(clipBarSpan(95, 8, 100)).toEqual({ width: 5, x: 95 })
  })

  test('drops a bar entirely outside the plot', () => {
    expect(clipBarSpan(-10, 8, 100)).toBeNull()
    expect(clipBarSpan(100, 8, 100)).toBeNull()
  })
})
