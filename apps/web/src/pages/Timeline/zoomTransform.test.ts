import * as d3 from 'd3'
import { describe, expect, it } from 'vitest'

import { computeHorizontalZoomTransform, computeVerticalZoomTransform } from './zoomTransform'

describe('computeVerticalZoomTransform', () => {
  const baseScale = d3
    .scaleTime()
    .domain([new Date('2026-01-01T00:00:00Z'), new Date('2026-01-02T00:00:00Z')])
    .range([0, 800])

  it('returns identity-like transform when view matches base domain', () => {
    const t = computeVerticalZoomTransform(
      baseScale,
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-01-02T00:00:00Z'),
      800,
    )
    expect(t.k).toBeCloseTo(1)
  })

  it('zooms in when view is narrower than base domain', () => {
    const t = computeVerticalZoomTransform(
      baseScale,
      new Date('2026-01-01T06:00:00Z'),
      new Date('2026-01-01T12:00:00Z'),
      800,
    )
    expect(t.k).toBeGreaterThan(1)
  })

  it('produces a transform that maps view start to pixel 0', () => {
    const viewStart = new Date('2026-01-01T06:00:00Z')
    const viewEnd = new Date('2026-01-01T18:00:00Z')
    const t = computeVerticalZoomTransform(baseScale, viewStart, viewEnd, 800)
    const rescaled = t.rescaleY(baseScale)
    expect(rescaled(viewStart)).toBeCloseTo(0, 0)
    expect(rescaled(viewEnd)).toBeCloseTo(800, 0)
  })
})

describe('computeHorizontalZoomTransform', () => {
  const baseScale = d3
    .scaleTime()
    .domain([new Date('2026-01-01T00:00:00Z'), new Date('2026-01-02T00:00:00Z')])
    .range([0, 1200])

  it('returns identity-like transform when view matches base domain', () => {
    const t = computeHorizontalZoomTransform(
      baseScale,
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-01-02T00:00:00Z'),
      1200,
    )
    expect(t.k).toBeCloseTo(1)
  })

  it('zooms in when view is narrower', () => {
    const t = computeHorizontalZoomTransform(
      baseScale,
      new Date('2026-01-01T08:00:00Z'),
      new Date('2026-01-01T16:00:00Z'),
      1200,
    )
    expect(t.k).toBeGreaterThan(1)
  })

  it('produces a transform that maps view range to chart width', () => {
    const viewStart = new Date('2026-01-01T08:00:00Z')
    const viewEnd = new Date('2026-01-01T16:00:00Z')
    const t = computeHorizontalZoomTransform(baseScale, viewStart, viewEnd, 1200)
    const rescaled = t.rescaleX(baseScale)
    expect(rescaled(viewStart)).toBeCloseTo(0, 0)
    expect(rescaled(viewEnd)).toBeCloseTo(1200, 0)
  })
})
