import { describe, expect, test } from 'vitest'

import { buildChartSvg } from './chart-svg.ts'

const series: [Date, number][] = [
  [new Date('2026-07-01T06:30:00Z'), 70],
  [new Date('2026-07-01T06:35:00Z'), 95],
  [new Date('2026-07-01T06:40:00Z'), 88],
  [new Date('2026-07-01T06:45:00Z'), 60],
]

describe('buildChartSvg', () => {
  test('produces a well-formed SVG with the default dimensions', () => {
    const svg = buildChartSvg(series)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
    expect(svg).toContain('width="1000"')
    expect(svg).toContain('height="420"')
    expect(svg).toContain('viewBox="0 0 1000 420"')
  })

  test('draws a polyline through every point for a multi-point series', () => {
    const svg = buildChartSvg(series)
    const match = /<polyline points="([^"]+)"/.exec(svg)
    expect(match).not.toBeNull()
    // One coordinate pair per point, and the extremes map to the padding edges:
    // highest value (95) hits the top pad (y=40), lowest (60) the bottom (y=380).
    const coords = (match?.[1] ?? '').split(' ')
    expect(coords).toHaveLength(series.length)
    expect(coords[0]).toBe('40.0,282.9') // first point (value 70), x at left pad
    expect(coords[1]).toBe('346.7,40.0') // peak value (95) → top pad
    expect(coords[3]).toBe('960.0,380.0') // last point (min value 60) → right/bottom pad
  })

  test('labels the min and max values, rounded', () => {
    const svg = buildChartSvg(series)
    expect(svg).toContain('>95</text>') // max
    expect(svg).toContain('>60</text>') // min
  })

  test('omits the polyline (but still renders) for a single point', () => {
    const svg = buildChartSvg([[new Date('2026-07-01T06:30:00Z'), 70]])
    expect(svg).not.toContain('<polyline')
    expect(svg).toContain('>70</text>') // still labels the value
  })

  test('drops non-finite values before plotting', () => {
    const svg = buildChartSvg([
      [new Date('2026-07-01T06:30:00Z'), 70],
      [new Date('2026-07-01T06:35:00Z'), Number.NaN],
    ])
    // Only one finite point remains → no polyline, no empty min/max labels.
    expect(svg).not.toContain('<polyline')
    expect(svg).toContain('>70</text>')
  })

  test('renders an empty series without throwing and without a polyline', () => {
    const svg = buildChartSvg([])
    expect(svg).not.toContain('<polyline')
    // No finite values → Math.min/max are ±Infinity, so labels are blank.
    expect(svg).toContain('text-anchor="end"></text>')
  })

  test('uses the given colour for the stroke', () => {
    expect(buildChartSvg(series, { color: '#22c55e' })).toContain('stroke="#22c55e"')
  })

  test('uses the default heart-rate colour and label when none given', () => {
    const svg = buildChartSvg(series)
    expect(svg).toContain('stroke="#ef4444"')
    expect(svg).toContain('>Heart rate</text>')
  })

  test('honours custom width and height', () => {
    const svg = buildChartSvg(series, { width: 600, height: 300 })
    expect(svg).toContain('width="600"')
    expect(svg).toContain('height="300"')
    expect(svg).toContain('viewBox="0 0 600 300"')
  })

  test('XML-escapes the label to prevent SVG injection', () => {
    const svg = buildChartSvg(series, { label: 'HR <b>&"peak"' })
    expect(svg).toContain('HR &lt;b&gt;&amp;&quot;peak&quot;')
    expect(svg).not.toContain('<b>')
  })
})
