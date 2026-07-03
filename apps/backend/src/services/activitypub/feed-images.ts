/**
 * Render feed-post attachment images (a metric line chart and a GPS route map)
 * as PNGs, from raw series / coordinate data.
 *
 * Both are pure functions of their inputs: they build a self-contained SVG and
 * rasterize it with `sharp` (no fonts, no external tiles). The route is drawn as
 * a bare polyline shape — a street basemap would need an external tile provider
 * and is a later enhancement. No privacy trimming is applied (area masking is a
 * planned follow-up), so callers must only render for public/unlisted posts that
 * opted in.
 */
import sharp from 'sharp'

const CHART_W = 1000
const CHART_H = 420
const ROUTE_W = 700
const ROUTE_H = 700
const PAD = 40

const svgToPng = (svg: string): Promise<Buffer> => sharp(Buffer.from(svg)).png().toBuffer()

/** Scale a value from `[min, max]` into `[lo, hi]`; collapses to the midpoint when the range is empty. */
const scale = (v: number, min: number, max: number, lo: number, hi: number): number =>
  max === min ? (lo + hi) / 2 : lo + ((v - min) / (max - min)) * (hi - lo)

/**
 * A metric line chart (e.g. heart rate). `series` is `[time, value]` pairs,
 * assumed time-ordered; non-finite values are dropped. Renders a bg, a smooth
 * polyline, and min/max value labels.
 */
export const renderChartPng = async (
  series: [Date, number][],
  opts: { color?: string; label?: string } = {},
): Promise<Buffer> => {
  const color = opts.color ?? '#ef4444'
  const pts = series.filter(([, v]) => Number.isFinite(v))
  const times = pts.map(([t]) => t.getTime())
  const vals = pts.map(([, v]) => v)
  const tMin = Math.min(...times)
  const tMax = Math.max(...times)
  const vMin = Math.min(...vals)
  const vMax = Math.max(...vals)

  const x = (t: number) => scale(t, tMin, tMax, PAD, CHART_W - PAD)
  const y = (v: number) => scale(v, vMin, vMax, CHART_H - PAD, PAD)
  const polyline = pts.map(([t, v]) => `${x(t.getTime()).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_W}" height="${CHART_H}" viewBox="0 0 ${CHART_W} ${CHART_H}">
  <rect width="${CHART_W}" height="${CHART_H}" fill="#0b0f19" rx="16"/>
  ${pts.length >= 2 ? `<polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
  <text x="${PAD}" y="${PAD - 12}" fill="#e5e7eb" font-family="sans-serif" font-size="26" font-weight="700">${escapeXml(opts.label ?? 'Heart rate')}</text>
  <text x="${CHART_W - PAD}" y="${PAD}" fill="#9ca3af" font-family="sans-serif" font-size="22" text-anchor="end">${Number.isFinite(vMax) ? Math.round(vMax) : ''}</text>
  <text x="${CHART_W - PAD}" y="${CHART_H - PAD}" fill="#9ca3af" font-family="sans-serif" font-size="22" text-anchor="end">${Number.isFinite(vMin) ? Math.round(vMin) : ''}</text>
</svg>`
  return svgToPng(svg)
}

/** Escape text for safe inclusion in SVG. */
const escapeXml = (s: string): string =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/**
 * A GPS route map. `coords` is GeoJSON `[lon, lat]` pairs (as `getLocations`
 * returns). Longitudes are compressed by `cos(lat)` so the shape keeps its true
 * aspect, the route is fit to the box preserving that aspect, and start (green)
 * / end (red) points are marked. North is up.
 */
export const renderRoutePng = async (coords: [number, number][]): Promise<Buffer> => {
  const pts = coords.filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))
  const lons = pts.map(([lon]) => lon)
  const lats = pts.map(([, lat]) => lat)
  const minLon = Math.min(...lons)
  const maxLon = Math.max(...lons)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const midLatRad = (((minLat + maxLat) / 2) * Math.PI) / 180

  // Aspect-correct spans in a common unit; guard against a zero span (a point).
  const lonSpan = Math.max((maxLon - minLon) * Math.cos(midLatRad), 1e-9)
  const latSpan = Math.max(maxLat - minLat, 1e-9)
  const boxW = ROUTE_W - 2 * PAD
  const boxH = ROUTE_H - 2 * PAD
  const unit = Math.min(boxW / lonSpan, boxH / latSpan)
  const offX = PAD + (boxW - lonSpan * unit) / 2
  const offY = PAD + (boxH - latSpan * unit) / 2

  const x = (lon: number) => offX + (lon - minLon) * Math.cos(midLatRad) * unit
  const y = (lat: number) => offY + (maxLat - lat) * unit // invert so north is up
  const polyline = pts.map(([lon, lat]) => `${x(lon).toFixed(1)},${y(lat).toFixed(1)}`).join(' ')
  const first = pts[0]
  const last = pts[pts.length - 1]

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ROUTE_W}" height="${ROUTE_H}" viewBox="0 0 ${ROUTE_W} ${ROUTE_H}">
  <rect width="${ROUTE_W}" height="${ROUTE_H}" fill="#0b0f19" rx="16"/>
  ${pts.length >= 2 ? `<polyline points="${polyline}" fill="none" stroke="#673ab8" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
  ${first ? `<circle cx="${x(first[0]).toFixed(1)}" cy="${y(first[1]).toFixed(1)}" r="9" fill="#22c55e"/>` : ''}
  ${last ? `<circle cx="${x(last[0]).toFixed(1)}" cy="${y(last[1]).toFixed(1)}" r="9" fill="#ef4444"/>` : ''}
</svg>`
  return svgToPng(svg)
}
