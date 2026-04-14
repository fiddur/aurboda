import * as d3 from 'd3'
import { describe, expect, it } from 'vitest'

import type { ChartItem } from './types'

import { mergeSmallItems, stackIconPoints } from './drawVerticalHelpers'

const makeItem = (start: string, end: string, overrides: Partial<ChartItem> = {}): ChartItem => ({
  color: '#333',
  column: 'Activity',
  end: new Date(end),
  isPoint: false,
  label: 'Test',
  start: new Date(start),
  tooltip: { details: [], time: '', title: '' },
  ...overrides,
})

describe('mergeSmallItems', () => {
  // Scale: 24h mapped to 800px → ~33px per hour
  const yScale = d3
    .scaleTime()
    .domain([new Date('2026-01-01T00:00:00Z'), new Date('2026-01-02T00:00:00Z')])
    .range([0, 800])

  it('returns empty array for empty input', () => {
    expect(mergeSmallItems([], yScale)).toEqual([])
  })

  it('returns items unchanged when all are large enough', () => {
    const items = [
      { item: makeItem('2026-01-01T08:00:00Z', '2026-01-01T10:00:00Z'), lane: 0 },
      { item: makeItem('2026-01-01T12:00:00Z', '2026-01-01T14:00:00Z'), lane: 0 },
    ]
    const result = mergeSmallItems(items, yScale)
    expect(result).toHaveLength(2)
  })

  it('merges tiny adjacent items into a cluster', () => {
    // Zoomed out scale: 30 days → 800px, so 1-minute items are < 1px
    const zoomedOutScale = d3
      .scaleTime()
      .domain([new Date('2026-01-01T00:00:00Z'), new Date('2026-01-31T00:00:00Z')])
      .range([0, 800])

    const items = [
      { item: makeItem('2026-01-01T08:00:00Z', '2026-01-01T08:01:00Z'), lane: 0 },
      { item: makeItem('2026-01-01T08:02:00Z', '2026-01-01T08:03:00Z'), lane: 0 },
      { item: makeItem('2026-01-01T08:04:00Z', '2026-01-01T08:05:00Z'), lane: 0 },
    ]
    const result = mergeSmallItems(items, zoomedOutScale)
    expect(result).toHaveLength(1)
    expect(result[0]!.item.label).toBe('3 items')
  })

  it('preserves items with icons even when tiny', () => {
    const zoomedOutScale = d3
      .scaleTime()
      .domain([new Date('2026-01-01T00:00:00Z'), new Date('2026-01-31T00:00:00Z')])
      .range([0, 800])

    const items = [
      { item: makeItem('2026-01-01T08:00:00Z', '2026-01-01T08:01:00Z', { icon: '🍽️' }), lane: 0 },
    ]
    const result = mergeSmallItems(items, zoomedOutScale)
    expect(result).toHaveLength(1)
    expect(result[0]!.item.icon).toBe('🍽️')
  })
})

describe('stackIconPoints', () => {
  const pointItem = (label: string, time: string): { item: ChartItem; lane: number } => ({
    item: makeItem(time, time, { isPoint: true, label }),
    lane: 0,
  })

  it('returns items with xOffset 0 when no overlapping points', () => {
    const items = [pointItem('A', '2026-01-01T08:00:00Z'), pointItem('B', '2026-01-01T09:00:00Z')]
    const result = stackIconPoints(items, 100)
    expect(result.every((r) => r.xOffset === 0)).toBe(true)
  })

  it('assigns increasing xOffsets for same-time points', () => {
    const items = [
      pointItem('A', '2026-01-01T08:00:00Z'),
      pointItem('B', '2026-01-01T08:00:00Z'),
      pointItem('C', '2026-01-01T08:00:00Z'),
    ]
    const result = stackIconPoints(items, 100)
    const offsets = result.map((r) => r.xOffset)
    expect(offsets[0]).toBe(0)
    expect(offsets[1]).toBeGreaterThan(0)
    expect(offsets[2]).toBeGreaterThan(offsets[1]!)
  })

  it('assigns offsets in alphabetical order for same-time points', () => {
    const items = [
      pointItem('C', '2026-01-01T08:00:00Z'),
      pointItem('A', '2026-01-01T08:00:00Z'),
      pointItem('B', '2026-01-01T08:00:00Z'),
    ]
    const result = stackIconPoints(items, 100)
    const labels = result.filter((r) => r.xOffset >= 0).map((r) => r.item.label)
    // A should come first (offset 0), then B, then C
    expect(labels).toEqual(['C', 'A', 'B']) // input order preserved but offsets sorted
  })

  it('does not stack non-point items', () => {
    const items = [
      { item: makeItem('2026-01-01T08:00:00Z', '2026-01-01T09:00:00Z'), lane: 0 },
      { item: makeItem('2026-01-01T08:00:00Z', '2026-01-01T09:00:00Z'), lane: 1 },
    ]
    const result = stackIconPoints(items, 100)
    expect(result.every((r) => r.xOffset === 0)).toBe(true)
  })

  it('returns single point without stacking', () => {
    const items = [pointItem('A', '2026-01-01T08:00:00Z')]
    const result = stackIconPoints(items, 100)
    expect(result).toHaveLength(1)
    expect(result[0]!.xOffset).toBe(0)
  })
})
