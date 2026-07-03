/**
 * OpenStreetMap slippy-map tile helpers for the route basemap.
 *
 * Web Mercator (EPSG:3857) projection math + a tile fetcher for
 * `tile.openstreetmap.org`. The route renderer projects the track into the same
 * world-pixel space as the tiles so they align, fetches the covering tiles, and
 * composites them behind the track.
 *
 * OSM's tile usage policy is respected: a descriptive `User-Agent`, low volume
 * (route renders are cached per post, so tiles are fetched at most once per
 * route until eviction), and the required "© OpenStreetMap contributors"
 * attribution is baked into the rendered image (see `feed-images.ts`). Fetches
 * are best-effort with a short timeout — a failure falls back to the bare shape.
 */

/** Standard slippy-map tile edge, in pixels. World size at zoom z is `TILE_SIZE * 2**z`. */
export const TILE_SIZE = 256

/** `User-Agent` identifying this app + a contact URL, per the OSM tile policy. */
const TILE_USER_AGENT = 'Aurboda/1.0 (+https://aurboda.net; feed route maps)'

/** Per-tile fetch timeout — a slow tile must not stall the (cached) image response. */
const TILE_TIMEOUT_MS = 5000

/** World pixel X for a longitude at the given world size (`TILE_SIZE * 2**zoom`). */
export const lonToWorldX = (lon: number, worldSize: number): number => ((lon + 180) / 360) * worldSize

/** World pixel Y for a latitude (Web Mercator) at the given world size. */
export const latToWorldY = (lat: number, worldSize: number): number => {
  const latRad = (lat * Math.PI) / 180
  const merc = Math.log(Math.tan(latRad) + 1 / Math.cos(latRad))
  return (0.5 - merc / (2 * Math.PI)) * worldSize
}

/**
 * The largest zoom in `[minZoom, maxZoom]` at which the lat/lon bounding box fits
 * inside `fitW × fitH` pixels — so the route fills the frame without spilling
 * out. A degenerate (zero-span) box returns `maxZoom`.
 */
export const chooseZoom = (
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  fitW: number,
  fitH: number,
  minZoom = 1,
  maxZoom = 18,
): number => {
  for (let z = maxZoom; z >= minZoom; z--) {
    const worldSize = TILE_SIZE * 2 ** z
    const w = lonToWorldX(bbox.maxLon, worldSize) - lonToWorldX(bbox.minLon, worldSize)
    // minLat is the southern edge → larger world-Y, so height = y(minLat) - y(maxLat).
    const h = latToWorldY(bbox.minLat, worldSize) - latToWorldY(bbox.maxLat, worldSize)
    if (w <= fitW && h <= fitH) return z
  }
  return minZoom
}

/** A fetched tile PNG, or `null` if the tile is out of range or the fetch failed. */
export type TileFetcher = (z: number, x: number, y: number) => Promise<Buffer | null>

/**
 * Fetch a single OSM tile PNG, or `null` on any failure (out-of-range indices,
 * non-200, network error, or timeout). Never throws — the renderer treats a null
 * tile as a gap to leave as background.
 */
export const fetchOsmTile: TileFetcher = async (z, x, y) => {
  const n = 2 ** z
  if (x < 0 || y < 0 || x >= n || y >= n) return null
  try {
    const res = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
      headers: { 'User-Agent': TILE_USER_AGENT },
      signal: AbortSignal.timeout(TILE_TIMEOUT_MS),
    })
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  }
}
