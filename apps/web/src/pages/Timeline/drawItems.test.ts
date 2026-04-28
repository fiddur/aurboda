import { describe, expect, it } from 'vitest'

import type { ChartItem } from './types'

import { getDetailUrl } from './drawItems'

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
