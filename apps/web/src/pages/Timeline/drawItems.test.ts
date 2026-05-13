import { describe, expect, it } from 'vitest'

import type { ChartItem } from './types'

import { clampLabelLayout, getDetailUrl, truncateLabel } from './drawItems'

const baseItem: ChartItem = {
  color: '#000',
  column: 'Activity',
  end: new Date(0),
  isPoint: false,
  label: 'x',
  start: new Date(0),
  tooltip: { details: [], time: '', title: '' },
}

describe('getDetailUrl', () => {
  it('prefers explicit href over entity-based URL', () => {
    const item: ChartItem = { ...baseItem, entity_id: 'm1', entity_type: 'meal', href: '/meals/m1' }
    expect(getDetailUrl(item)).toBe('/meals/m1')
  })

  it('falls back to /detail/{type}/{id} when no href is set', () => {
    const item: ChartItem = { ...baseItem, entity_id: 'a1', entity_type: 'activity' }
    expect(getDetailUrl(item)).toBe('/detail/activity/a1')
  })

  it('encodes the entity id', () => {
    const item: ChartItem = { ...baseItem, entity_id: 'a/1 b', entity_type: 'activity' }
    expect(getDetailUrl(item)).toBe('/detail/activity/a%2F1%20b')
  })

  it('returns undefined when no href and no entity info is available', () => {
    expect(getDetailUrl(baseItem)).toBeUndefined()
  })

  it('returns undefined when entity_type is missing', () => {
    const item: ChartItem = { ...baseItem, entity_id: 'x' }
    expect(getDetailUrl(item)).toBeUndefined()
  })
})

describe('clampLabelLayout', () => {
  it('uses bar start when the bar is fully visible', () => {
    expect(clampLabelLayout(100, 200, 4)).toEqual({ x: 104, width: 192 })
  })

  it('clamps to chart left edge when the bar starts before the chart', () => {
    // Bar from -200 to 200 (width 400), chart starts at 0. Label clamped to 4.
    expect(clampLabelLayout(-200, 400, 4)).toEqual({ x: 4, width: 192 })
  })

  it('respects a non-zero chart left x', () => {
    expect(clampLabelLayout(-50, 200, 4, 10)).toEqual({ x: 14, width: 132 })
  })

  it('returns zero width when the bar ends before the chart', () => {
    expect(clampLabelLayout(-500, 200, 4).width).toBe(0)
  })

  it('produces a width that yields the visible portion of the label', () => {
    // Bar -100..300, chart 0..400. Visible 0..300. Label at x=4, width = 300-4-4 = 292.
    const { width } = clampLabelLayout(-100, 400, 4)
    expect(truncateLabel('sleep', width)).toBe('sleep')
  })
})
