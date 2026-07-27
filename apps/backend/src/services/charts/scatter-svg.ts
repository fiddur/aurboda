/**
 * The shared server-side correlation **scatter** renderer: an aligned daily
 * `trigger` × `outcome` series → a self-contained SVG **string**.
 *
 * The companion to `chart-svg.ts` for the *correlation* article block. It is the
 * server-side twin of the web `ArticleCorrelationBlock` scatter — same maths
 * (`linearRegression`, `describeSelectorAxis` from the shared api-spec source),
 * same present-vs-absent headline for a binary trigger — rendered on the dark
 * card background so a rasterised PNG reads legibly as a standalone Mastodon
 * attachment (the web draws the same scatter inline on a light card). Pure and
 * synchronous — unit-testable on the string; rasterize with `sharp` for the PNG.
 */
import type { CorrelationSelector } from '@aurboda/api-spec'

import { describeSelectorAxis, linearRegression } from '@aurboda/api-spec'

import { escapeXml, scale } from './chart-svg.ts'

/** Default scatter dimensions (feed attachment size); overridable per call. */
export const SCATTER_WIDTH = 900
export const SCATTER_HEIGHT = 600
const PAD = { bottom: 64, left: 80, right: 28, top: 44 }
/** Dark card background, matching the metric chart and route map. */
const SCATTER_BG = '#0b0f19'
const AXIS_COLOR = '#4b5563'
const POINT_COLOR = '#a78bfa'
const REG_COLOR = '#f472b6'
const TEXT_COLOR = '#e5e7eb'
const MUTED_COLOR = '#9ca3af'
const FONT = 'Liberation Sans, sans-serif'

/** The subset of a continuous-correlation result this renderer draws. */
export interface ScatterSvgData {
  series: { trigger: number; outcome: number }[]
  pearson: number | null
  spearman: number | null
  pearson_p: number | null
  n: number
  group_comparison: {
    trigger_is_binary: boolean
    difference?: number | null
    cohens_d?: number | null
    welch?: { p_value?: number | null } | null
  } | null
  trigger: CorrelationSelector
  outcome: CorrelationSelector
}

export interface ScatterSvgOptions {
  width?: number
  height?: number
}

const fmt = (value: number | null | undefined, digits = 2): string =>
  value == null ? '—' : value.toFixed(digits)

const fmtP = (p: number | null | undefined): string => (p == null ? '—' : p < 0.001 ? '<0.001' : p.toFixed(3))

/**
 * The headline stat line. For a binary/presence trigger (0/1 — tags, activities,
 * apps) a Pearson r is misleading, so lead with the present-vs-absent group
 * comparison instead, the same choice the web scatter and Correlations explorer
 * make.
 */
const headlineOf = (data: ScatterSvgData): string => {
  const gc = data.group_comparison
  return gc?.trigger_is_binary
    ? `Δ(present−absent)=${fmt(gc.difference)} · d=${fmt(gc.cohens_d)} · n=${data.n} · p=${fmtP(gc.welch?.p_value)}`
    : `r=${fmt(data.pearson)} · ρ=${fmt(data.spearman)} · n=${data.n} · p=${fmtP(data.pearson_p)}`
}

/**
 * Build the correlation scatter as a self-contained SVG string: points, an OLS
 * regression line, the r/ρ/n/p (or group-comparison) headline, and the two
 * selector axis labels. `data.series` must be non-empty (the caller 404s an
 * empty/too-small window). Pure and synchronous.
 */
export const buildScatterSvg = (data: ScatterSvgData, opts: ScatterSvgOptions = {}): string => {
  const width = opts.width ?? SCATTER_WIDTH
  const height = opts.height ?? SCATTER_HEIGHT
  const xs = data.series.map((p) => p.trigger)
  const ys = data.series.map((p) => p.outcome)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)

  const sx = (x: number) => scale(x, xMin, xMax, PAD.left, width - PAD.right)
  const sy = (y: number) => scale(y, yMin, yMax, height - PAD.bottom, PAD.top)

  const reg = linearRegression(xs, ys)
  const regLine = reg
    ? `<line x1="${sx(xMin).toFixed(1)}" y1="${sy(reg.slope * xMin + reg.intercept).toFixed(1)}" x2="${sx(xMax).toFixed(1)}" y2="${sy(reg.slope * xMax + reg.intercept).toFixed(1)}" stroke="${REG_COLOR}" stroke-width="3"/>`
    : ''
  const points = data.series
    .map(
      (p) =>
        `<circle cx="${sx(p.trigger).toFixed(1)}" cy="${sy(p.outcome).toFixed(1)}" r="5" fill="${POINT_COLOR}" opacity="0.5"/>`,
    )
    .join('')

  const xAxis = describeSelectorAxis(data.trigger)
  const yAxis = describeSelectorAxis(data.outcome)
  const yLabelX = 24
  const yLabelY = (PAD.top + (height - PAD.bottom)) / 2

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${SCATTER_BG}" rx="16"/>
  <line x1="${PAD.left}" y1="${height - PAD.bottom}" x2="${width - PAD.right}" y2="${height - PAD.bottom}" stroke="${AXIS_COLOR}" stroke-width="2"/>
  <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${height - PAD.bottom}" stroke="${AXIS_COLOR}" stroke-width="2"/>
  ${points}
  ${regLine}
  <text x="${PAD.left + 8}" y="${PAD.top - 16}" fill="${TEXT_COLOR}" font-family="${FONT}" font-size="24" font-weight="700">${escapeXml(headlineOf(data))}</text>
  <text x="${(PAD.left + (width - PAD.right)) / 2}" y="${height - 20}" fill="${MUTED_COLOR}" font-family="${FONT}" font-size="22" text-anchor="middle">${escapeXml(xAxis)}</text>
  <text x="${yLabelX}" y="${yLabelY}" fill="${MUTED_COLOR}" font-family="${FONT}" font-size="22" text-anchor="middle" transform="rotate(-90 ${yLabelX} ${yLabelY})">${escapeXml(yAxis)}</text>
</svg>`
}
