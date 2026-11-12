import { describe, expect, test } from 'vitest'

import { CHART_HEIGHT, CHART_WIDTH } from './chart-svg.ts'
import { articleBlockFigureSize, FIGURE_BAND_HEIGHT, withFigureTitle } from './figure-svg.ts'
import { IMPACT_HEIGHT, IMPACT_WIDTH } from './impact-svg.ts'
import { SCATTER_HEIGHT, SCATTER_WIDTH } from './scatter-svg.ts'

const chart =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="420" viewBox="0 0 1000 420"><rect/></svg>'
const size = { height: 420, width: 1000 }

describe('withFigureTitle', () => {
  test('is the chart size plus the title band', () => {
    const svg = withFigureTitle(chart, size, { heading: 'Figure 1' })
    expect(svg).toMatch(
      /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1000" height="508" viewBox="0 0 1000 508">/,
    )
    expect(FIGURE_BAND_HEIGHT).toBe(88)
  })

  test('centres the heading and caption', () => {
    const svg = withFigureTitle(chart, size, { caption: 'Overnight HR', heading: 'Figure 2' })
    expect(svg).toMatch(/<text x="500" y="\d+" text-anchor="middle"[^>]*font-size="28"[^>]*>Figure 2<\/text>/)
    expect(svg).toMatch(
      /<text x="500" y="\d+" text-anchor="middle"[^>]*font-size="20"[^>]*>Overnight HR<\/text>/,
    )
  })

  test('cuts a long caption to the width with an ellipsis', () => {
    const svg = withFigureTitle(chart, size, { caption: 'x'.repeat(200), heading: 'Figure 1' })
    const caption = /font-size="20"[^>]*>([^<]*)<\/text>/.exec(svg)?.[1] ?? ''
    expect(caption.endsWith('…')).toBe(true)
    expect(caption.length).toBeLessThanOrEqual(Math.floor(1000 / 11))
  })

  test('escapes the heading and caption', () => {
    const svg = withFigureTitle(chart, size, { caption: 'A <b> & "c"', heading: 'Figure <1>' })
    expect(svg).toContain('Figure &lt;1&gt;')
    expect(svg).toContain('A &lt;b&gt; &amp; &quot;c&quot;')
    expect(svg).not.toContain('<b>')
  })

  test('nests the chart under the band', () => {
    const svg = withFigureTitle(chart, size, { heading: 'Figure 1' })
    expect(svg).toContain(
      '<svg x="0" y="88" xmlns="http://www.w3.org/2000/svg" width="1000" height="420" viewBox="0 0 1000 420"><rect/></svg>',
    )
  })

  test('throws when the chart is not an svg element', () => {
    expect(() => withFigureTitle('<div/>', size, { heading: 'Figure 1' })).toThrow()
    expect(() => withFigureTitle('<svg>chart</svg>', size, { heading: 'Figure 1' })).toThrow()
  })
})

describe('articleBlockFigureSize', () => {
  test('is the size each block type renders its chart at', () => {
    expect(articleBlockFigureSize('chart')).toEqual({ height: CHART_HEIGHT, width: CHART_WIDTH })
    expect(articleBlockFigureSize('challenge')).toEqual({ height: CHART_HEIGHT, width: CHART_WIDTH })
    expect(articleBlockFigureSize('correlation')).toEqual({ height: SCATTER_HEIGHT, width: SCATTER_WIDTH })
    expect(articleBlockFigureSize('impact')).toEqual({ height: IMPACT_HEIGHT, width: IMPACT_WIDTH })
  })
})
