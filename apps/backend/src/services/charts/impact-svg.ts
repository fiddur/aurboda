/**
 * The server-side twin of the web impact chart (the Analyze page's "Impact of"
 * chart, and the article impact block): HRV, heart rate and stress per bucket
 * before, during and after an activity's sessions, each on its own y scale, with
 * the paired before -> after effect lines under the legend. Drawn on the dark
 * card so a rasterised PNG reads as a standalone attachment. Pure and synchronous.
 */
import type { ActivityImpactData, ImpactBucket, WindowEffect } from '@aurboda/api-spec'

import { impactBucketLabel, impactEffectSummary } from '@aurboda/api-spec'

import { maxOf, minOf } from '../numeric-extremes.ts'
import { escapeXml, scale } from './chart-svg.ts'

export const IMPACT_WIDTH = 1000
export const IMPACT_HEIGHT = 560

const BG = '#0b0f19'
const AXIS_COLOR = '#4b5563'
const TEXT_COLOR = '#e5e7eb'
const MUTED_COLOR = '#9ca3af'
const BAND_COLOR = '#3b82f6'
const FONT = 'Liberation Sans, sans-serif'
const PAD = { bottom: 176, left: 48, right: 48, top: 84 }
const BARE_PAD = { bottom: 8, left: 12, right: 12, top: 8 }
const LINE_HEIGHT = 26

export type ImpactSvgData = Pick<
  ActivityImpactData,
  | 'activity'
  | 'avg_duration_min'
  | 'hr_effect'
  | 'hrv_effect'
  | 'occurrences'
  | 'stress_effect'
  | 'timeline'
  | 'window_minutes'
>

export interface ImpactSvgOptions {
  width?: number
  height?: number
  /** Only the band, lines and dots on a transparent background: no `<text>` (see `ChartSvgOptions.bare`). */
  bare?: boolean
}

interface Series {
  label: string
  color: string
  means: (number | null)[]
  effect: WindowEffect
}

const seriesOf = (data: ImpactSvgData): Series[] => [
  {
    color: '#10b981',
    effect: data.hrv_effect,
    label: 'HRV',
    means: data.timeline.map((b) => b.hrv.mean),
  },
  {
    color: '#ef4444',
    effect: data.hr_effect,
    label: 'Heart rate',
    means: data.timeline.map((b) => b.hr.mean),
  },
  {
    color: '#f59e0b',
    effect: data.stress_effect,
    label: 'Stress',
    means: data.timeline.map((b) => b.stress.mean),
  },
]

/** The web's `paddedDomain`: the values' range widened by 30 % of itself, or by 10 when flat. */
export const paddedDomain = (values: (number | null)[]): [number, number] => {
  const present = values.filter((v): v is number => v != null && Number.isFinite(v))
  const lo = minOf(present)
  const hi = maxOf(present)
  if (lo == null || hi == null) return [0, 100]
  const padding = (hi - lo) * 0.3 || 10
  return [lo - padding, hi + padding]
}

/** Evenly spaced x positions, one per bucket, like d3's `scalePoint` with no padding. */
const pointX = (count: number, lo: number, hi: number) => (i: number) =>
  count <= 1 ? (lo + hi) / 2 : lo + (i * (hi - lo)) / (count - 1)

/** Polyline runs between nulls: a gap wherever a mean is missing. */
const runs = (points: ({ x: number; y: number } | null)[]): { x: number; y: number }[][] => {
  const out: { x: number; y: number }[][] = []
  let current: { x: number; y: number }[] = []
  for (const point of points) {
    if (point == null) {
      if (current.length > 0) out.push(current)
      current = []
    } else current.push(point)
  }
  if (current.length > 0) out.push(current)
  return out
}

const drawSeries = (series: Series, x: (i: number) => number, top: number, bottom: number): string => {
  const [lo, hi] = paddedDomain(series.means)
  const points = series.means.map((mean, i) =>
    mean == null || !Number.isFinite(mean) ? null : { x: x(i), y: scale(mean, lo, hi, bottom, top) },
  )
  const lines = runs(points)
    .filter((run) => run.length >= 2)
    .map(
      (run) =>
        `<polyline points="${run.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="${series.color}" stroke-width="3"/>`,
    )
  const dots = points
    .filter((p): p is { x: number; y: number } => p != null)
    .map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6" fill="${series.color}"/>`)
  return [...lines, ...dots].join('')
}

const duringBand = (
  buckets: ImpactBucket[],
  x: (i: number) => number,
  step: number,
  top: number,
  bottom: number,
): string => {
  const index = buckets.findIndex((b) => b.phase === 'during')
  if (index < 0) return ''
  const width = Math.min(80, step)
  return `<rect x="${(x(index) - width / 2).toFixed(1)}" y="${top}" width="${width.toFixed(1)}" height="${bottom - top}" fill="${BAND_COLOR}" fill-opacity="0.15"/>`
}

const legend = (
  items: { label: string; color: string; band?: boolean }[],
  left: number,
  y: number,
): string => {
  let cursor = left
  return items
    .map((item) => {
      const swatch = item.band
        ? `<rect x="${cursor}" y="${y - 14}" width="18" height="18" fill="${BAND_COLOR}" fill-opacity="0.35"/>`
        : `<circle cx="${cursor + 9}" cy="${y - 5}" r="7" fill="${item.color}"/>`
      const text = `<text x="${cursor + 26}" y="${y}" fill="${TEXT_COLOR}" font-family="${FONT}" font-size="20">${escapeXml(item.label)}</text>`
      cursor += 26 + item.label.length * 11 + 32
      return swatch + text
    })
    .join('')
}

export const buildImpactSvg = (data: ImpactSvgData, opts: ImpactSvgOptions = {}): string => {
  const width = opts.width ?? IMPACT_WIDTH
  const height = opts.height ?? IMPACT_HEIGHT
  const pad = opts.bare ? BARE_PAD : PAD
  const top = pad.top
  const bottom = height - pad.bottom
  const left = pad.left
  const right = width - pad.right
  const buckets = data.timeline
  const x = pointX(buckets.length, left, right)
  const step = buckets.length <= 1 ? right - left : (right - left) / (buckets.length - 1)
  const series = seriesOf(data)
  const plot = [
    duringBand(buckets, x, step, top, bottom),
    ...series.map((s) => drawSeries(s, x, top, bottom)),
  ].join('\n  ')

  if (opts.bare) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${plot}
</svg>`
  }

  const title = `<text x="${left}" y="48" fill="${TEXT_COLOR}" font-family="${FONT}" font-size="28" font-weight="700">${escapeXml(`Impact of "${data.activity}"`)}<tspan dx="14" fill="${MUTED_COLOR}" font-weight="400" font-size="22">${data.occurrences} occurrences, avg ${Math.round(data.avg_duration_min)} min</tspan></text>`
  const axis = `<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="${AXIS_COLOR}" stroke-width="2"/>`
  const labels = buckets
    .map(
      (bucket, i) =>
        `<text x="${x(i).toFixed(1)}" y="${bottom + 30}" fill="${MUTED_COLOR}" font-family="${FONT}" font-size="18" text-anchor="middle">${escapeXml(impactBucketLabel(bucket))}</text>`,
    )
    .join('')
  const legendY = bottom + 74
  const legendRow = legend(
    [
      ...series.map((s) => ({ color: s.color, label: s.label })),
      { band: true, color: BAND_COLOR, label: 'Activity period' },
    ],
    left,
    legendY,
  )
  const effects = [series[1], series[2], series[0]]
    .map((s) => impactEffectSummary(s.label, s.effect, data.occurrences))
    .filter((line): line is string => line != null)
    .map(
      (line, i) =>
        `<text x="${left}" y="${legendY + 34 + i * LINE_HEIGHT}" fill="${MUTED_COLOR}" font-family="${FONT}" font-size="19">${escapeXml(line)}</text>`,
    )
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${BG}" rx="16"/>
  ${title}
  ${axis}
  ${plot}
  ${labels}
  ${legendRow}
  ${effects}
</svg>`
}
