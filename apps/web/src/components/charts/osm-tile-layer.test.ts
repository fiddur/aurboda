// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { OSM_TILE_URL, osmTileLayer, osmTileLayerOptions } from './osm-tile-layer'

describe('osmTileLayer', () => {
  it('sends the origin as Referer, which the page-wide same-origin policy would strip', () => {
    expect(osmTileLayerOptions.referrerPolicy).toBe('strict-origin-when-cross-origin')
    expect(osmTileLayer().options.referrerPolicy).toBe('strict-origin-when-cross-origin')
  })

  it('uses the single tile host rather than the retired a/b/c subdomains', () => {
    expect(OSM_TILE_URL).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png')
  })

  it('credits OpenStreetMap contributors', () => {
    expect(osmTileLayerOptions.attribution).toContain('OpenStreetMap</a> contributors')
  })
})
