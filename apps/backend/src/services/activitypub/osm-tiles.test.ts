import { describe, expect, test } from 'vitest'

import { chooseZoom, fetchOsmTile, latToWorldY, lonToWorldX, TILE_SIZE } from './osm-tiles.ts'

describe('Web Mercator projection', () => {
  const worldSize = TILE_SIZE * 2 ** 4 // arbitrary zoom

  test('longitude maps -180→0, 0→center, 180→worldSize', () => {
    expect(lonToWorldX(-180, worldSize)).toBeCloseTo(0)
    expect(lonToWorldX(0, worldSize)).toBeCloseTo(worldSize / 2)
    expect(lonToWorldX(180, worldSize)).toBeCloseTo(worldSize)
  })

  test('latitude 0 maps to the vertical centre; north is a smaller Y than south', () => {
    expect(latToWorldY(0, worldSize)).toBeCloseTo(worldSize / 2)
    expect(latToWorldY(60, worldSize)).toBeLessThan(latToWorldY(0, worldSize))
    expect(latToWorldY(-60, worldSize)).toBeGreaterThan(latToWorldY(0, worldSize))
  })
})

describe('chooseZoom', () => {
  test('a tiny bounding box zooms all the way in (maxZoom)', () => {
    const z = chooseZoom({ maxLat: 57.7001, maxLon: 11.9701, minLat: 57.7, minLon: 11.97 }, 620, 620)
    expect(z).toBe(18)
  })

  test('a world-spanning box falls to the minimum zoom', () => {
    const z = chooseZoom({ maxLat: 80, maxLon: 179, minLat: -80, minLon: -179 }, 620, 620, 1, 18)
    expect(z).toBe(1)
  })

  test('picks a mid zoom that fits a city-scale route within the frame', () => {
    // ~0.05° span (a few km) should land somewhere in the teens, and must fit.
    const bbox = { maxLat: 57.73, maxLon: 12.0, minLat: 57.7, minLon: 11.95 }
    const z = chooseZoom(bbox, 620, 620)
    const worldSize = TILE_SIZE * 2 ** z
    const w = lonToWorldX(bbox.maxLon, worldSize) - lonToWorldX(bbox.minLon, worldSize)
    const h = latToWorldY(bbox.minLat, worldSize) - latToWorldY(bbox.maxLat, worldSize)
    expect(w).toBeLessThanOrEqual(620)
    expect(h).toBeLessThanOrEqual(620)
    // One zoom deeper, at least one dimension overflows — i.e. this is the
    // tightest fit (here Mercator stretches latitude at ~57.7°, so height binds).
    const deeper = TILE_SIZE * 2 ** (z + 1)
    const wDeeper = lonToWorldX(bbox.maxLon, deeper) - lonToWorldX(bbox.minLon, deeper)
    const hDeeper = latToWorldY(bbox.minLat, deeper) - latToWorldY(bbox.maxLat, deeper)
    expect(wDeeper > 620 || hDeeper > 620).toBe(true)
  })
})

describe('fetchOsmTile', () => {
  test('returns null for out-of-range tile indices without touching the network', async () => {
    // At zoom 2 there are 4×4 tiles (0..3); 5 and -1 are out of range.
    expect(await fetchOsmTile(2, 5, 0)).toBeNull()
    expect(await fetchOsmTile(2, 0, -1)).toBeNull()
  })
})
