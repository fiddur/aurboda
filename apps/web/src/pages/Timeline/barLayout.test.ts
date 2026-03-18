import { describe, expect, test } from 'vitest'

import { computeBarLayout, slotPixels } from './barLayout'

describe('computeBarLayout', () => {
  test('single visible slot gets full width', () => {
    const layout = computeBarLayout([{ id: 'a', visible: true }])
    expect(layout.totalSlots).toBe(1)
    expect(layout.slotWidth).toBe(1)
    expect(layout.getOffset('a')).toBe(0)
  })

  test('two visible slots split evenly', () => {
    const layout = computeBarLayout([
      { id: 'a', visible: true },
      { id: 'b', visible: true },
    ])
    expect(layout.totalSlots).toBe(2)
    expect(layout.slotWidth).toBe(0.5)
    expect(layout.getOffset('a')).toBe(0)
    expect(layout.getOffset('b')).toBe(0.5)
  })

  test('hidden slots are excluded from layout', () => {
    const layout = computeBarLayout([
      { id: 'a', visible: true },
      { id: 'b', visible: false },
      { id: 'c', visible: true },
    ])
    expect(layout.totalSlots).toBe(2)
    expect(layout.slotWidth).toBe(0.5)
    expect(layout.getOffset('a')).toBe(0)
    expect(layout.getOffset('c')).toBe(0.5)
    // Hidden slot returns 0 as fallback
    expect(layout.getOffset('b')).toBe(0)
  })

  test('no visible slots defaults to 1', () => {
    const layout = computeBarLayout([{ id: 'a', visible: false }])
    expect(layout.totalSlots).toBe(1)
    expect(layout.slotWidth).toBe(1)
  })

  test('five visible slots (realistic config)', () => {
    const layout = computeBarLayout([
      { id: 'fatigue', visible: true },
      { id: 'impulse', visible: true },
      { id: 'screentime', visible: true },
      { id: 'steps', visible: true },
      { id: 'calories', visible: true },
    ])
    expect(layout.totalSlots).toBe(5)
    expect(layout.slotWidth).toBeCloseTo(0.2)
    expect(layout.getOffset('fatigue')).toBeCloseTo(0)
    expect(layout.getOffset('impulse')).toBeCloseTo(0.2)
    expect(layout.getOffset('screentime')).toBeCloseTo(0.4)
    expect(layout.getOffset('steps')).toBeCloseTo(0.6)
    expect(layout.getOffset('calories')).toBeCloseTo(0.8)
  })
})

describe('slotPixels', () => {
  test('computes pixel position for a slot', () => {
    const { x, width } = slotPixels(100, 60, 0.5, 0.25, 0.5)
    expect(x).toBe(130) // 100 + 60 * 0.5
    expect(width).toBe(14.5) // 60 * 0.25 - 0.5
  })

  test('minimum width is 1', () => {
    const { width } = slotPixels(0, 2, 0, 0.25, 0.5)
    expect(width).toBe(1) // max(1, 2 * 0.25 - 0.5) = max(1, 0) = 1
  })
})
