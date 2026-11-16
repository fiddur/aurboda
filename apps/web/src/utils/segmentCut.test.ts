import { describe, expect, it } from 'vitest'

import {
  cumulativeDistancesM,
  cutBounds,
  cutLengthM,
  cutTooShortReason,
  densifyLine,
  indexRangeForKm,
  indexRangeForOffsets,
  moveCutEdge,
} from './segmentCut'

describe('indexRangeForOffsets', () => {
  const offsets = [0, 1, 2, 5, 9, 10]

  it('keeps the points inside the window, ends included', () => {
    expect(indexRangeForOffsets(offsets, 1, 9)).toEqual({ from: 1, to: 4 })
  })

  it('rounds a window edge between samples inwards', () => {
    expect(indexRangeForOffsets(offsets, 3, 9.5)).toEqual({ from: 3, to: 4 })
  })

  it('clamps a window reaching past either end', () => {
    expect(indexRangeForOffsets(offsets, -5, 50)).toEqual({ from: 0, to: 5 })
  })

  it('gives null when no point falls inside', () => {
    expect(indexRangeForOffsets(offsets, 6, 8)).toBeNull()
    expect(indexRangeForOffsets([], 0, 10)).toBeNull()
  })

  it('keeps a single point', () => {
    expect(indexRangeForOffsets(offsets, 4, 6)).toEqual({ from: 3, to: 3 })
  })
})

describe('cumulativeDistancesM', () => {
  it('starts at zero and grows by the haversine distance', () => {
    const distances = cumulativeDistancesM([
      { lat: 59.3, lon: 18.0 },
      { lat: 59.301, lon: 18.0 },
      { lat: 59.302, lon: 18.0 },
    ])
    expect(distances[0]).toBe(0)
    expect(distances[1]).toBeCloseTo(111.2, 0)
    expect(distances[2]).toBeCloseTo(222.4, 0)
  })

  it('is empty for no points', () => {
    expect(cumulativeDistancesM([])).toEqual([])
  })
})

describe('indexRangeForKm', () => {
  const distances = [0, 250, 500, 750, 1000]

  it('spans the stretch from the point at or before its start to the one at or after its end', () => {
    expect(indexRangeForKm(distances, 0.25, 0.75)).toEqual({ from: 1, to: 3 })
    expect(indexRangeForKm(distances, 0.3, 0.9)).toEqual({ from: 1, to: 4 })
  })

  it('spans a stretch that falls between two points', () => {
    expect(indexRangeForKm(distances, 0.3, 0.4)).toEqual({ from: 1, to: 2 })
  })

  it('clamps a stretch reaching past the end', () => {
    expect(indexRangeForKm(distances, 0.9, 1.2)).toEqual({ from: 3, to: 4 })
  })

  it('gives null for an empty or reversed stretch', () => {
    expect(indexRangeForKm(distances, 0.5, 0.5)).toBeNull()
    expect(indexRangeForKm(distances, 0.6, 0.4)).toBeNull()
    expect(indexRangeForKm(distances, 1.1, 1.2)).toBeNull()
  })
})

describe('cutLengthM', () => {
  const distances = [0, 250, 500, 750, 1000]

  it('measures between the range ends', () => {
    expect(cutLengthM(distances, { from: 1, to: 3 })).toBe(500)
    expect(cutLengthM(distances, { from: 2, to: 2 })).toBe(0)
  })

  it('is zero without a range', () => {
    expect(cutLengthM(distances, null)).toBe(0)
  })
})

describe('cutTooShortReason', () => {
  it('refuses under 100 m', () => {
    expect(cutTooShortReason(99.9)).toBe('A segment must be at least 100 m long')
    expect(cutTooShortReason(100)).toBeNull()
  })
})

describe('moveCutEdge', () => {
  const bounds = { max: 600, min: 0 }

  it('moves either end freely while they stay apart', () => {
    expect(moveCutEdge({ end: 300, start: 100 }, 'start', 50, bounds)).toEqual({ end: 300, start: 50 })
    expect(moveCutEdge({ end: 300, start: 100 }, 'end', 400, bounds)).toEqual({ end: 400, start: 100 })
  })

  it('stops a moved end a second short of the other', () => {
    expect(moveCutEdge({ end: 300, start: 100 }, 'start', 350, bounds)).toEqual({ end: 300, start: 299 })
    expect(moveCutEdge({ end: 300, start: 100 }, 'end', 20, bounds)).toEqual({ end: 101, start: 100 })
  })

  it('keeps both ends inside the bounds', () => {
    expect(moveCutEdge({ end: 300, start: 100 }, 'start', -10, bounds)).toEqual({ end: 300, start: 0 })
    expect(moveCutEdge({ end: 300, start: 100 }, 'end', 900, bounds)).toEqual({ end: 600, start: 100 })
  })
})

describe('cutBounds', () => {
  it('spans the whole seconds of the track', () => {
    expect(cutBounds([0.4, 10, 600.7])).toEqual({ max: 600, min: 1 })
  })

  it('is null without a track or for one too short to cut', () => {
    expect(cutBounds(null)).toBeNull()
    expect(cutBounds([5])).toBeNull()
    expect(cutBounds([0, 1.5])).toBeNull()
  })
})

describe('densifyLine', () => {
  it('puts a point at least every step along each edge, keeping the corners', () => {
    const line = [
      { lat: 59.3, lon: 18.07 },
      { lat: 59.3, lon: 18.07 + 100 / 56_800 },
    ]
    const dense = densifyLine(line, 10)
    expect(dense[0]).toEqual(line[0])
    expect(dense.at(-1)).toEqual(line[1])
    const distances = cumulativeDistancesM(dense)
    expect(distances.slice(1).every((d, i) => d - distances[i] <= 10.01)).toBe(true)
    const range = indexRangeForKm(distances, 0.02, 0.06)
    expect(cutLengthM(distances, range)).toBeGreaterThan(39)
    expect(cutLengthM(distances, range)).toBeLessThan(61)
  })
})
