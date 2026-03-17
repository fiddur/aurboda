import { describe, expect, test } from 'vitest'

import { packLanes } from './lanePacking'

interface TestItem {
  name: string
  start: Date
  end?: Date
}

const getStart = (item: TestItem): Date => item.start
const getEnd = (item: TestItem): Date | undefined => item.end

describe('packLanes', () => {
  test('returns empty result for empty input', () => {
    const result = packLanes<TestItem>([], getStart, getEnd)
    expect(result).toEqual({ items: [], laneCount: 0 })
  })

  test('puts non-overlapping items in lane 0', () => {
    const items: TestItem[] = [
      { end: new Date('2024-01-01T08:00:00Z'), name: 'a', start: new Date('2024-01-01T06:00:00Z') },
      { end: new Date('2024-01-01T10:00:00Z'), name: 'b', start: new Date('2024-01-01T09:00:00Z') },
      { end: new Date('2024-01-01T14:00:00Z'), name: 'c', start: new Date('2024-01-01T12:00:00Z') },
    ]

    const result = packLanes(items, getStart, getEnd)

    expect(result.laneCount).toBe(1)
    expect(result.items).toEqual([
      { item: items[0], lane: 0 },
      { item: items[1], lane: 0 },
      { item: items[2], lane: 0 },
    ])
  })

  test('puts overlapping items in separate lanes', () => {
    const items: TestItem[] = [
      { end: new Date('2024-01-01T10:00:00Z'), name: 'a', start: new Date('2024-01-01T06:00:00Z') },
      { end: new Date('2024-01-01T12:00:00Z'), name: 'b', start: new Date('2024-01-01T08:00:00Z') },
    ]

    const result = packLanes(items, getStart, getEnd)

    expect(result.laneCount).toBe(2)
    expect(result.items[0]).toEqual({ item: items[0], lane: 0 })
    expect(result.items[1]).toEqual({ item: items[1], lane: 1 })
  })

  test('reuses lanes when earlier item finishes', () => {
    const items: TestItem[] = [
      { end: new Date('2024-01-01T08:00:00Z'), name: 'a', start: new Date('2024-01-01T06:00:00Z') },
      { end: new Date('2024-01-01T12:00:00Z'), name: 'b', start: new Date('2024-01-01T07:00:00Z') },
      { end: new Date('2024-01-01T10:00:00Z'), name: 'c', start: new Date('2024-01-01T08:00:00Z') },
    ]

    const result = packLanes(items, getStart, getEnd)

    expect(result.laneCount).toBe(2)
    // 'a' in lane 0, 'b' in lane 1, 'c' back in lane 0 (a finished)
    expect(result.items[0]).toEqual({ item: items[0], lane: 0 })
    expect(result.items[1]).toEqual({ item: items[1], lane: 1 })
    expect(result.items[2]).toEqual({ item: items[2], lane: 0 })
  })

  test('gives point-in-time items synthetic 15-min duration for packing', () => {
    const items: TestItem[] = [
      { name: 'point-a', start: new Date('2024-01-01T10:00:00Z') },
      { name: 'point-b', start: new Date('2024-01-01T10:05:00Z') },
      { name: 'point-c', start: new Date('2024-01-01T10:20:00Z') },
    ]

    const result = packLanes(items, getStart, getEnd)

    // a and b overlap (within 15 min), c does not overlap with a (20 min apart)
    expect(result.laneCount).toBe(2)
    expect(result.items[0]).toEqual({ item: items[0], lane: 0 })
    expect(result.items[1]).toEqual({ item: items[1], lane: 1 })
    expect(result.items[2]).toEqual({ item: items[2], lane: 0 })
  })

  test('handles unsorted input by sorting by start time', () => {
    const items: TestItem[] = [
      { end: new Date('2024-01-01T14:00:00Z'), name: 'c', start: new Date('2024-01-01T12:00:00Z') },
      { end: new Date('2024-01-01T08:00:00Z'), name: 'a', start: new Date('2024-01-01T06:00:00Z') },
      { end: new Date('2024-01-01T10:00:00Z'), name: 'b', start: new Date('2024-01-01T09:00:00Z') },
    ]

    const result = packLanes(items, getStart, getEnd)

    expect(result.laneCount).toBe(1)
    // Items should be sorted by start in output
    expect(result.items.map((r) => r.item.name)).toEqual(['a', 'b', 'c'])
    expect(result.items.every((r) => r.lane === 0)).toBe(true)
  })

  test('handles three-way overlap requiring three lanes', () => {
    const items: TestItem[] = [
      { end: new Date('2024-01-01T12:00:00Z'), name: 'a', start: new Date('2024-01-01T06:00:00Z') },
      { end: new Date('2024-01-01T11:00:00Z'), name: 'b', start: new Date('2024-01-01T07:00:00Z') },
      { end: new Date('2024-01-01T10:00:00Z'), name: 'c', start: new Date('2024-01-01T08:00:00Z') },
    ]

    const result = packLanes(items, getStart, getEnd)

    expect(result.laneCount).toBe(3)
    expect(result.items[0]?.lane).toBe(0)
    expect(result.items[1]?.lane).toBe(1)
    expect(result.items[2]?.lane).toBe(2)
  })

  test('single item goes in lane 0', () => {
    const items: TestItem[] = [
      { end: new Date('2024-01-01T08:00:00Z'), name: 'only', start: new Date('2024-01-01T06:00:00Z') },
    ]

    const result = packLanes(items, getStart, getEnd)

    expect(result.laneCount).toBe(1)
    expect(result.items).toEqual([{ item: items[0], lane: 0 }])
  })
})
