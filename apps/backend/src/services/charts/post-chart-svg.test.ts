import { describe, expect, test } from 'vitest'

import type { RaceChartSvgData } from './race-chart-svg.ts'
import type { ScatterSvgData } from './scatter-svg.ts'

import { isDrawablePostChart, type PostChart, postChartCaption, postChartSvg } from './post-chart-svg.ts'

const START = new Date('2026-11-01T00:00:00Z')
const END = new Date('2026-11-08T00:00:00Z')
const series: [Date, number][] = [
  [START, 60],
  [END, 65],
]
const race: RaceChartSvgData = {
  asOf: END,
  endTime: END,
  lines: [{ color: '#2b9ea7', name: 'olle', points: series }],
  startTime: START,
  timezone: 'UTC',
  title: 'November steps',
}
const scatter: ScatterSvgData = {
  group_comparison: null,
  n: 3,
  outcome: { kind: 'metric', metric: 'sleep_score' },
  pearson: 0.5,
  pearson_p: 0.1,
  series: [{ outcome: 2, trigger: 1 }],
  spearman: 0.5,
  trigger: { kind: 'metric', metric: 'steps' },
}

const charts: PostChart[] = [
  { opts: { color: '#2b9ea7', label: 'Heart Rate' }, series, type: 'line' },
  { data: race, type: 'race' },
  { data: scatter, type: 'scatter' },
]

describe('postChartSvg', () => {
  test('draws every kind bare at the asked size, with no text for librsvg to turn into tofu', () => {
    for (const chart of charts) {
      const svg = postChartSvg(chart, { bare: true, height: 150, width: 1008 })
      expect(svg).toContain('viewBox="0 0 1008 150"')
      expect(svg).not.toContain('<text')
    }
  })

  test('without bare it is the feed image itself, title and all', () => {
    expect(postChartSvg(charts[0], { height: 420, width: 1000 })).toContain('>Heart Rate</text>')
    expect(postChartSvg(charts[1], { height: 420, width: 1000 })).toContain('>November steps</text>')
  })

  test('keeps a line chart’s colour', () => {
    expect(postChartSvg(charts[0], { bare: true, height: 100, width: 200 })).toContain('stroke="#2b9ea7"')
  })
})

describe('postChartCaption', () => {
  test('names what each chart shows', () => {
    expect(charts.map(postChartCaption)).toEqual([
      'Heart Rate',
      'Standings',
      'steps (count) vs sleep_score (score)',
    ])
    expect(postChartCaption({ series, type: 'line' })).toBe('Heart rate')
  })
})

describe('isDrawablePostChart', () => {
  test('a line needs two finite points, a race one line, a scatter one point', () => {
    expect(charts.every(isDrawablePostChart)).toBe(true)
    expect(isDrawablePostChart({ series: [series[0], [END, Number.NaN]], type: 'line' })).toBe(false)
    expect(isDrawablePostChart({ data: { ...race, lines: [] }, type: 'race' })).toBe(false)
    expect(isDrawablePostChart({ data: { ...scatter, series: [] }, type: 'scatter' })).toBe(false)
  })
})
