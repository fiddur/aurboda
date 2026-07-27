import { describe, expect, test } from 'vitest'

import { type ScatterSvgData, buildScatterSvg } from './scatter-svg.ts'

const base: ScatterSvgData = {
  group_comparison: null,
  n: 4,
  outcome: { kind: 'metric', metric: 'sleep_score' },
  pearson: 0.82,
  pearson_p: 0.0004,
  series: [
    { outcome: 70, trigger: 10 },
    { outcome: 82, trigger: 25 },
    { outcome: 78, trigger: 40 },
    { outcome: 90, trigger: 55 },
  ],
  spearman: 0.8,
  trigger: { kind: 'metric', metric: 'steps' },
}

describe('buildScatterSvg', () => {
  test('produces a well-formed SVG with the default dimensions', () => {
    const svg = buildScatterSvg(base)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
    expect(svg).toContain('width="900"')
    expect(svg).toContain('height="600"')
    expect(svg).toContain('viewBox="0 0 900 600"')
  })

  test('draws one point circle per aligned pair and a regression line', () => {
    const svg = buildScatterSvg(base)
    expect(svg.match(/<circle /g)).toHaveLength(base.series.length)
    expect(svg).toContain(`stroke="#f472b6"`) // OLS regression line colour
  })

  test('leads with the Pearson headline for a continuous trigger', () => {
    const svg = buildScatterSvg(base)
    expect(svg).toContain('r=0.82')
    expect(svg).toContain('ρ=0.80')
    expect(svg).toContain('n=4')
    expect(svg).toContain('p=&lt;0.001') // <0.001, XML-escaped
  })

  test('leads with the group comparison for a binary/presence trigger', () => {
    const svg = buildScatterSvg({
      ...base,
      group_comparison: {
        cohens_d: 0.9,
        difference: 6.5,
        trigger_is_binary: true,
        welch: { p_value: 0.012 },
      },
      series: [
        { outcome: 72, trigger: 0 },
        { outcome: 74, trigger: 0 },
        { outcome: 84, trigger: 1 },
        { outcome: 88, trigger: 1 },
      ],
      trigger: { kind: 'tag', pattern: 'sauna' },
    })
    expect(svg).toContain('Δ(present−absent)=6.50')
    expect(svg).toContain('d=0.90')
    expect(svg).toContain('p=0.012')
    expect(svg).not.toContain('ρ=') // the Pearson/Spearman headline is suppressed
  })

  test('labels both axes from the selectors', () => {
    const svg = buildScatterSvg(base)
    expect(svg).toContain('steps') // trigger axis (x)
    expect(svg).toContain('sleep_score') // outcome axis (y)
    expect(svg).toContain('transform="rotate(-90') // y-axis label rotated
  })

  test('renders a dash for null coefficients rather than crashing', () => {
    const svg = buildScatterSvg({ ...base, pearson: null, pearson_p: null, spearman: null })
    expect(svg).toContain('r=—')
    expect(svg).toContain('p=—')
  })
})
