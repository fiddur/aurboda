/**
 * Render feed-post attachment images (a metric line chart and a GPS route map)
 * as PNGs, from raw series / coordinate data.
 *
 * The chart SVG is built by the shared `buildChartSvg` renderer (so the feed PNG
 * and the crisp `image/svg+xml` path stay one implementation) and rasterized here
 * with `sharp`. The route map
 * is drawn over an **OpenStreetMap street basemap**: the track is projected into
 * Web Mercator (the tiles' projection), the covering tiles are fetched and
 * composited behind it, and the required "© OpenStreetMap contributors"
 * attribution is baked in (see `osm-tiles.ts`). Tile fetching is injected
 * (`opts.fetchTile`) so it's opt-in and testable; when it's absent, or every tile
 * fails (e.g. offline), the route falls back to a bare polyline on a dark
 * background. No privacy trimming is applied (area masking is a planned
 * follow-up), so callers must only render for posts that opted in.
 */
import sharp from 'sharp'

import { buildChartSvg } from '../charts/chart-svg.ts'
import { type ScatterSvgData, buildScatterSvg } from '../charts/scatter-svg.ts'
import { maxOf, minOf } from '../numeric-extremes.ts'
import { chooseZoom, latToWorldY, lonToWorldX, TILE_SIZE, type TileFetcher } from './osm-tiles.ts'

const ROUTE_W = 700
const ROUTE_H = 700
const PAD = 40
/** Dark background behind the route (and behind any missing basemap tiles). */
const ROUTE_BG = '#0b0f19'
/** Guard against a pathological tile grid (chooseZoom keeps the route ≤ ~3 tiles wide). */
const MAX_TILES = 25
/** Max concurrent tile fetches — OSM's tile policy asks for ≤ ~2 connections. */
const TILE_FETCH_CONCURRENCY = 2

/**
 * Map over `items` running at most `limit` async calls at once, preserving order.
 * A tiny fixed-pool scheduler — no big `Promise.all` burst.
 */
const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results = Array.from<R>({ length: items.length })
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

const svgToPng = (svg: string): Promise<Buffer> => sharp(Buffer.from(svg)).png().toBuffer()

/**
 * A metric line chart (e.g. heart rate) rasterized to PNG for the feed
 * attachment. The SVG itself is built by the shared `buildChartSvg` renderer (so
 * the `image/svg+xml` and PNG paths stay one implementation); this only adds the
 * `sharp` rasterization.
 */
export const renderChartPng = (
  series: [Date, number][],
  opts: { color?: string; label?: string } = {},
): Promise<Buffer> => svgToPng(buildChartSvg(series, opts))

/**
 * A correlation scatter (trigger × outcome + OLS line + headline) rasterized to
 * PNG for an article correlation-block feed attachment. The SVG is built by the
 * shared `buildScatterSvg` renderer (the same scatter the web draws inline); this
 * only adds the `sharp` rasterization.
 */
export const renderScatterPng = (data: ScatterSvgData): Promise<Buffer> => svgToPng(buildScatterSvg(data))

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

interface Bbox {
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
}

const boundingBox = (pts: [number, number][]): Bbox => {
  const lons = pts.map(([lon]) => lon)
  const lats = pts.map(([, lat]) => lat)
  return {
    maxLat: maxOf(lats) ?? 0,
    maxLon: maxOf(lons) ?? 0,
    minLat: minOf(lats) ?? 0,
    minLon: minOf(lons) ?? 0,
  }
}

/**
 * The route polyline + start/end markers (+ optional attribution) as an SVG
 * overlay, projected into the 700×700 frame by the supplied `x`/`y`. Over a
 * basemap the line gets a white halo so it stays legible on any tile colour.
 */
const routeOverlaySvg = (
  pts: [number, number][],
  x: (lon: number) => number,
  y: (lat: number) => number,
  overBasemap: boolean,
): string => {
  const polyline = pts.map(([lon, lat]) => `${x(lon).toFixed(1)},${y(lat).toFixed(1)}`).join(' ')
  const first = pts[0]
  const last = pts[pts.length - 1]
  const line =
    pts.length >= 2
      ? `${overBasemap ? `<polyline points="${polyline}" fill="none" stroke="#ffffff" stroke-opacity="0.7" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
  <polyline points="${polyline}" fill="none" stroke="#673ab8" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`
      : ''
  const markerStroke = overBasemap ? ' stroke="#ffffff" stroke-width="2.5"' : ''
  const start = first
    ? `<circle cx="${x(first[0]).toFixed(1)}" cy="${y(first[1]).toFixed(1)}" r="9" fill="#22c55e"${markerStroke}/>`
    : ''
  const end = last
    ? `<circle cx="${x(last[0]).toFixed(1)}" cy="${y(last[1]).toFixed(1)}" r="9" fill="#ef4444"${markerStroke}/>`
    : ''
  // Required OSM attribution, bottom-right, on a translucent chip.
  const attribution = overBasemap
    ? `<g font-family="Liberation Sans, sans-serif" font-size="15">
    <rect x="${ROUTE_W - 262}" y="${ROUTE_H - 26}" width="258" height="22" fill="#ffffff" fill-opacity="0.75"/>
    <text x="${ROUTE_W - 6}" y="${ROUTE_H - 10}" text-anchor="end" fill="#1f2937">© OpenStreetMap contributors</text>
  </g>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ROUTE_W}" height="${ROUTE_H}" viewBox="0 0 ${ROUTE_W} ${ROUTE_H}">
  ${line}
  ${start}
  ${end}
  ${attribution}
</svg>`
}

/** A rounded-rect mask (used with `blend: 'dest-in'`) to round the map corners. */
const roundedMaskSvg = (): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${ROUTE_W}" height="${ROUTE_H}"><rect width="${ROUTE_W}" height="${ROUTE_H}" rx="16" fill="#fff"/></svg>`

/**
 * Render the route over an OSM basemap, or `null` if the basemap can't be built
 * (grid too large, or every covering tile failed to fetch) so the caller can fall
 * back to the bare shape. The route is projected in Web Mercator to match the
 * tiles, centred in the frame at a zoom that fits the whole track.
 */
const renderRouteWithBasemap = async (
  pts: [number, number][],
  bbox: Bbox,
  fetchTile: TileFetcher,
): Promise<Buffer | null> => {
  const zoom = chooseZoom(bbox, ROUTE_W - 2 * PAD, ROUTE_H - 2 * PAD)
  const worldSize = TILE_SIZE * 2 ** zoom
  const centerX = lonToWorldX((bbox.minLon + bbox.maxLon) / 2, worldSize)
  const centerY = latToWorldY((bbox.minLat + bbox.maxLat) / 2, worldSize)
  const vpLeft = centerX - ROUTE_W / 2
  const vpTop = centerY - ROUTE_H / 2

  const tileMinX = Math.floor(vpLeft / TILE_SIZE)
  const tileMaxX = Math.floor((vpLeft + ROUTE_W) / TILE_SIZE)
  const tileMinY = Math.floor(vpTop / TILE_SIZE)
  const tileMaxY = Math.floor((vpTop + ROUTE_H) / TILE_SIZE)
  const cols = tileMaxX - tileMinX + 1
  const rows = tileMaxY - tileMinY + 1
  if (cols * rows > MAX_TILES) return null

  const coords: { tx: number; ty: number }[] = []
  for (let tx = tileMinX; tx <= tileMaxX; tx++) {
    for (let ty = tileMinY; ty <= tileMaxY; ty++) coords.push({ tx, ty })
  }
  // Fetch through a small pool (not one big burst): OSM's tile policy asks for at
  // most ~2 concurrent download connections. Renders are cached per post, so the
  // extra latency is paid at most once per route.
  const tiles = await mapWithConcurrency(coords, TILE_FETCH_CONCURRENCY, async ({ tx, ty }) => ({
    buf: await fetchTile(zoom, tx, ty),
    tx,
    ty,
  }))
  const loaded = tiles.filter((t): t is { tx: number; ty: number; buf: Buffer } => t.buf != null)
  if (loaded.length === 0) {
    // Every covering tile failed to fetch — an OSM outage or block (e.g. 429), not
    // an expected case like the MAX_TILES guard above. `fetchTile` swallows each
    // failure to null, so this is the only place a real outage surfaces: log it so
    // the silent degradation to a bare shape is observable rather than invisible.
    console.warn(
      `⚠️ OSM basemap: all ${coords.length} tiles failed to fetch (zoom ${zoom}); using bare route`,
    )
    return null
  }

  // Composite tiles onto a grid canvas (all non-negative offsets), then crop the
  // 700×700 viewport out of it — avoids negative composite offsets entirely.
  const gridW = cols * TILE_SIZE
  const gridH = rows * TILE_SIZE
  const gridBuf = await sharp({
    create: { background: ROUTE_BG, channels: 4, height: gridH, width: gridW },
  })
    .composite(
      loaded.map((t) => ({
        input: t.buf,
        left: (t.tx - tileMinX) * TILE_SIZE,
        top: (t.ty - tileMinY) * TILE_SIZE,
      })),
    )
    .png()
    .toBuffer()

  const extractLeft = clamp(Math.round(vpLeft - tileMinX * TILE_SIZE), 0, gridW - ROUTE_W)
  const extractTop = clamp(Math.round(vpTop - tileMinY * TILE_SIZE), 0, gridH - ROUTE_H)
  const mapBuf = await sharp(gridBuf)
    .extract({ height: ROUTE_H, left: extractLeft, top: extractTop, width: ROUTE_W })
    .png()
    .toBuffer()

  const x = (lon: number) => lonToWorldX(lon, worldSize) - vpLeft
  const y = (lat: number) => latToWorldY(lat, worldSize) - vpTop
  return sharp(mapBuf)
    .composite([
      { input: Buffer.from(routeOverlaySvg(pts, x, y, true)), left: 0, top: 0 },
      { blend: 'dest-in', input: Buffer.from(roundedMaskSvg()) },
    ])
    .png()
    .toBuffer()
}

/**
 * Render the route as a bare polyline on a dark background (no basemap). Used as
 * the fallback. Longitudes are compressed by `cos(lat)` so the shape keeps its
 * true aspect, fit to the box, with start (green) / end (red) markers. North up.
 */
const renderBareRoute = async (pts: [number, number][], bbox: Bbox): Promise<Buffer> => {
  const midLatRad = (((bbox.minLat + bbox.maxLat) / 2) * Math.PI) / 180
  // Aspect-correct spans in a common unit; guard against a zero span (a point).
  const lonSpan = Math.max((bbox.maxLon - bbox.minLon) * Math.cos(midLatRad), 1e-9)
  const latSpan = Math.max(bbox.maxLat - bbox.minLat, 1e-9)
  const boxW = ROUTE_W - 2 * PAD
  const boxH = ROUTE_H - 2 * PAD
  const unit = Math.min(boxW / lonSpan, boxH / latSpan)
  const offX = PAD + (boxW - lonSpan * unit) / 2
  const offY = PAD + (boxH - latSpan * unit) / 2

  const x = (lon: number) => offX + (lon - bbox.minLon) * Math.cos(midLatRad) * unit
  const y = (lat: number) => offY + (bbox.maxLat - lat) * unit // invert so north is up

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ROUTE_W}" height="${ROUTE_H}" viewBox="0 0 ${ROUTE_W} ${ROUTE_H}">
  <rect width="${ROUTE_W}" height="${ROUTE_H}" fill="${ROUTE_BG}" rx="16"/>
  ${routeOverlaySvg(pts, x, y, false)
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '')}
</svg>`
  return svgToPng(svg)
}

/**
 * A GPS route map. `coords` is GeoJSON `[lon, lat]` pairs (as `getLocations`
 * returns). When `opts.fetchTile` is supplied (the production wiring passes the
 * OSM fetcher), the track is drawn over a street basemap; otherwise, or if the
 * basemap can't be built, it falls back to a bare polyline shape.
 */
export const renderRoutePng = async (
  coords: [number, number][],
  opts: { fetchTile?: TileFetcher } = {},
): Promise<Buffer> => {
  const pts = coords.filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))
  if (pts.length === 0) {
    return svgToPng(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${ROUTE_W}" height="${ROUTE_H}"><rect width="${ROUTE_W}" height="${ROUTE_H}" fill="${ROUTE_BG}" rx="16"/></svg>`,
    )
  }
  const bbox = boundingBox(pts)

  if (opts.fetchTile) {
    try {
      const map = await renderRouteWithBasemap(pts, bbox, opts.fetchTile)
      if (map) return map
    } catch (error) {
      // Fall back to the bare shape below. Log it: a bare shape is also the
      // *offline* fallback, so a genuine basemap regression would otherwise
      // silently degrade every route map with no signal.
      console.warn('⚠️ route basemap render failed, using bare shape:', error)
    }
  }
  return renderBareRoute(pts, bbox)
}
