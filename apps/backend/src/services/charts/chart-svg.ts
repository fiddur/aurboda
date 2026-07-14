/**
 * The shared server-side chart renderer: a metric time series → a self-contained
 * SVG **string**.
 *
 * This is deliberately sharp-free — it builds only the SVG markup, so it is a
 * pure, synchronous function that unit tests can assert on directly (the string),
 * not just on an opaque rasterized PNG. Two very different consumers need the same
 * chart from the same data, and this is the single implementation both share:
 *
 *   - **PNG** for the ActivityPub feed attachment / OG snapshot / Reddit export —
 *     `sharp(Buffer.from(svg)).png()` (Mastodon and other non-Aurboda consumers
 *     that can't re-resolve the live series get this raster). librsvg (via sharp)
 *     needs the bundled Liberation fonts registered in the Docker image to render
 *     the `<text>` labels — see the Dockerfile font setup.
 *   - **`image/svg+xml`** served directly for crisp Aurboda-native rendering
 *     (`aurboda:charts`, #901); browsers fall back through the `font-family` list
 *     to their own sans-serif, so no bundled font is required for that path.
 *
 * The chart draws only from shared metric types (the same data as the series
 * endpoint), so the window `[start, end]` a caller resolves the series over is
 * what makes the chart stable and citable (#934 articles lock that window).
 */

/** Default chart dimensions (feed attachment size); overridable per call. */
export const CHART_WIDTH = 1000
export const CHART_HEIGHT = 420
const PAD = 40
/** Dark card background, matching the route map and OG gradient's dark end. */
const CHART_BG = '#0b0f19'
/** Default line colour (heart-rate red) — kept as the default for feed parity. */
const DEFAULT_COLOR = '#ef4444'
const DEFAULT_LABEL = 'Heart rate'

export interface ChartSvgOptions {
  /** Line stroke colour. */
  color?: string
  /** Title drawn top-left. */
  label?: string
  /** Overall SVG width in px. */
  width?: number
  /** Overall SVG height in px. */
  height?: number
}

/** Escape text for safe inclusion in SVG/XML. */
export const escapeXml = (s: string): string =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** Scale a value from `[min, max]` into `[lo, hi]`; collapses to the midpoint when the range is empty. */
export const scale = (v: number, min: number, max: number, lo: number, hi: number): number =>
  max === min ? (lo + hi) / 2 : lo + ((v - min) / (max - min)) * (hi - lo)

/**
 * Build a metric line chart as a self-contained SVG string. `series` is
 * `[time, value]` pairs, assumed time-ordered; non-finite values are dropped.
 * Renders a rounded background, a smooth polyline (only with ≥ 2 points), and the
 * min/max value labels. Pure and synchronous — rasterize with `sharp` for PNG or
 * serve the string directly as `image/svg+xml`.
 */
export const buildChartSvg = (series: [Date, number][], opts: ChartSvgOptions = {}): string => {
  const color = opts.color ?? DEFAULT_COLOR
  const width = opts.width ?? CHART_WIDTH
  const height = opts.height ?? CHART_HEIGHT
  const pts = series.filter(([, v]) => Number.isFinite(v))
  const times = pts.map(([t]) => t.getTime())
  const vals = pts.map(([, v]) => v)
  const tMin = Math.min(...times)
  const tMax = Math.max(...times)
  const vMin = Math.min(...vals)
  const vMax = Math.max(...vals)

  const x = (t: number) => scale(t, tMin, tMax, PAD, width - PAD)
  const y = (v: number) => scale(v, vMin, vMax, height - PAD, PAD)
  const polyline = pts.map(([t, v]) => `${x(t.getTime()).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${CHART_BG}" rx="16"/>
  ${pts.length >= 2 ? `<polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
  <text x="${PAD}" y="${PAD - 12}" fill="#e5e7eb" font-family="Liberation Sans, sans-serif" font-size="26" font-weight="700">${escapeXml(opts.label ?? DEFAULT_LABEL)}</text>
  <text x="${width - PAD}" y="${PAD}" fill="#9ca3af" font-family="Liberation Sans, sans-serif" font-size="22" text-anchor="end">${Number.isFinite(vMax) ? Math.round(vMax) : ''}</text>
  <text x="${width - PAD}" y="${height - PAD}" fill="#9ca3af" font-family="Liberation Sans, sans-serif" font-size="22" text-anchor="end">${Number.isFinite(vMin) ? Math.round(vMin) : ''}</text>
</svg>`
}
