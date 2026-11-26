import L from 'leaflet'

export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

/**
 * nginx sends `Referrer-Policy: same-origin` so one-time OAuth codes in page URLs never leave
 * the site, which strips the Referer from cross-origin tile requests. OSM's tile usage policy
 * requires one and serves a "403 Access blocked" tile without it, so the tiles alone send the
 * origin (never the path or query).
 */
export const osmTileLayerOptions: L.TileLayerOptions = {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
  referrerPolicy: 'strict-origin-when-cross-origin',
}

export const osmTileLayer = (): L.TileLayer => L.tileLayer(OSM_TILE_URL, osmTileLayerOptions)
