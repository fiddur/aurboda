// @vitest-environment jsdom
import * as d3 from 'd3'
import { describe, expect, it } from 'vitest'

import type { MetricBucketParsed } from '../../utils/chart'

import { computeYScales, drawMetricsYAxes } from './drawMetricsTrack'

const hrvBucket = (min: number, max: number): MetricBucketParsed => ({
  end: new Date('2026-01-01T01:00:00Z'),
  metrics: { hrv_rmssd: { avg: (min + max) / 2, count: 1, max, min } },
  start: new Date('2026-01-01T00:00:00Z'),
})

const container = () => {
  const svg = d3.select(document.body).append('svg')
  return svg.append('g')
}

const tickLabels = (g: d3.Selection<SVGGElement, unknown, null, undefined>) =>
  g
    .selectAll<SVGTextElement, unknown>('.metrics-y-axis text')
    .nodes()
    .map((n) => n.textContent)

describe('drawMetricsYAxes', () => {
  it('draws the HR axis on the left and the HRV axis on the right', () => {
    const g = container()
    drawMetricsYAxes(g, computeYScales([hrvBucket(20, 80)], 0, 200), 500)
    const axes = g.selectAll('.metrics-y-axis').nodes() as Element[]
    expect(axes).toHaveLength(2)
    expect(axes[0]!.getAttribute('transform')).toBeNull()
    expect(axes[1]!.getAttribute('transform')).toBe('translate(500,0)')
  })

  it('replaces the axes when the scales change, so a late data load still gets them', () => {
    const g = container()
    drawMetricsYAxes(g, null, 500)
    expect(g.selectAll('.metrics-y-axis').size()).toBe(0)

    drawMetricsYAxes(g, computeYScales([hrvBucket(20, 80)], 0, 200), 500)
    const before = tickLabels(g)
    drawMetricsYAxes(g, computeYScales([hrvBucket(100, 300)], 0, 200), 500)
    expect(g.selectAll('.metrics-y-axis').size()).toBe(2)
    expect(tickLabels(g)).not.toEqual(before)
  })

  it('clears the axes when the track has no scales', () => {
    const g = container()
    drawMetricsYAxes(g, computeYScales([hrvBucket(20, 80)], 0, 200), 500)
    drawMetricsYAxes(g, null, 500)
    expect(g.selectAll('*').size()).toBe(0)
  })
})
