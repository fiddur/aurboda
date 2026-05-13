import type { ReportFlag } from '@aurboda/api-spec'

import './ReferenceRangeBar.css'

export interface RangeMarker {
  value: number
  flag?: ReportFlag
  /** Short label shown above the marker (e.g. "1d", "7d"). */
  label?: string
}

interface ReferenceRangeBarProps {
  /** Single-marker shorthand. Ignored when `markers` is provided. */
  value?: number
  /** Flag for the single-marker shorthand. */
  flag?: ReportFlag
  /** Multi-marker mode — overrides `value`/`flag`. */
  markers?: RangeMarker[]
  reference_low?: number
  reference_high?: number
}

const FLAG_COLORS: Record<string, string> = {
  critical_high: '#dc2626',
  critical_low: '#dc2626',
  high: '#f59e0b',
  low: '#f59e0b',
  normal: '#22c55e',
}

interface DisplayRange {
  displayMin: number
  displayMax: number
  /** Where the normal-zone starts as a 0–100 percentage of the visible track. */
  normalStartPct: number
  /** Where the normal-zone ends as a 0–100 percentage of the visible track. */
  normalEndPct: number
}

/**
 * Compute where to draw the visible track and where the normal/warning
 * zones sit on it, given a possibly one-sided reference range and one or
 * more values.
 *
 * Two-sided: existing 30%-padding-on-each-side display, with warning zones
 * on both ends and normal in the middle. Used by report cards (HRV, body
 * fat etc.) where both ends matter.
 *
 * Upper-only (e.g. salt, saturated_fat, alcohol): anchor at zero, extend
 * 30% beyond the cap; normal zone is everything from 0 up to the cap, the
 * warning zone covers only the over-cap region.
 *
 * Lower-only (open upper bound, e.g. potassium minimum): warning zone
 * below the floor, normal zone above; extend display until at least the
 * highest value or 1.5× floor.
 */
const computeDisplayRange = (
  low: number | undefined,
  high: number | undefined,
  values: number[],
): DisplayRange => {
  const maxAbs = values.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  const maxVal = values.reduce((m, v) => Math.max(m, v), Number.NEGATIVE_INFINITY)
  const minVal = values.reduce((m, v) => Math.min(m, v), Number.POSITIVE_INFINITY)
  if (low !== undefined && high !== undefined) {
    const span = high - low
    const padding = Math.max(span * 0.3, maxAbs * 0.05)
    const displayMin = Math.min(low - padding, minVal - padding * 0.1)
    const displayMax = Math.max(high + padding, maxVal + padding * 0.1)
    const displaySpan = displayMax - displayMin
    return {
      displayMin,
      displayMax,
      normalStartPct: ((low - displayMin) / displaySpan) * 100,
      normalEndPct: ((high - displayMin) / displaySpan) * 100,
    }
  }
  if (high !== undefined) {
    const displayMin = Math.min(0, minVal)
    const displayMax = Math.max(high * 1.3, maxVal * 1.1)
    const displaySpan = displayMax - displayMin || 1
    return {
      displayMin,
      displayMax,
      normalStartPct: 0,
      normalEndPct: ((high - displayMin) / displaySpan) * 100,
    }
  }
  const lo = low as number
  const displayMin = Math.min(lo * 0.7, minVal * 0.9)
  const displayMax = Math.max(lo * 1.5, maxVal * 1.1)
  const displaySpan = displayMax - displayMin || 1
  return {
    displayMin,
    displayMax,
    normalStartPct: ((lo - displayMin) / displaySpan) * 100,
    normalEndPct: 100,
  }
}

const clampPct = (p: number): number => Math.max(0, Math.min(100, p))

/**
 * Horizontal bar visualizing where one or more values fall relative to a
 * reference range. Supports two-sided medical ranges (lab reports),
 * one-sided dietary recommendations (salt cap, fiber floor), and overlay
 * of multiple markers (e.g. 1d/7d/30d/90d averages on the same nutrient).
 */
export function ReferenceRangeBar({
  value,
  flag,
  markers,
  reference_low,
  reference_high,
}: ReferenceRangeBarProps) {
  if (reference_low === undefined && reference_high === undefined) return null

  const resolved: RangeMarker[] =
    markers && markers.length > 0 ? markers : value !== undefined ? [{ flag, value }] : []
  if (resolved.length === 0) return null

  const { displayMin, displayMax, normalStartPct, normalEndPct } = computeDisplayRange(
    reference_low,
    reference_high,
    resolved.map((m) => m.value),
  )
  const displaySpan = displayMax - displayMin || 1

  const title = `Range: ${reference_low ?? '—'}–${reference_high ?? '—'}`

  return (
    <div class={`ref-range-bar${resolved.length > 1 ? ' ref-range-multi' : ''}`} title={title}>
      <div class="ref-range-track">
        {reference_low !== undefined && (
          <div class="ref-range-zone ref-range-low" style={{ left: 0, width: `${normalStartPct}%` }} />
        )}
        {reference_high !== undefined && (
          <div
            class="ref-range-zone ref-range-high"
            style={{ left: `${normalEndPct}%`, width: `${100 - normalEndPct}%` }}
          />
        )}
        <div
          class="ref-range-zone ref-range-normal"
          style={{ left: `${normalStartPct}%`, width: `${normalEndPct - normalStartPct}%` }}
        />
        {resolved.map((m, i) => {
          const pct = clampPct(((m.value - displayMin) / displaySpan) * 100)
          const color = m.flag ? (FLAG_COLORS[m.flag] ?? '#6b7280') : '#6b7280'
          return (
            <div
              key={m.label ?? i}
              class="ref-range-marker"
              style={{ backgroundColor: color, left: `${pct}%` }}
              title={m.label ? `${m.label}: ${m.value}` : `${m.value}`}
            >
              {m.label && <span class="ref-range-marker-label">{m.label}</span>}
            </div>
          )
        })}
      </div>
      <div class="ref-range-labels">
        {reference_low !== undefined ? <span class="ref-range-label-low">{reference_low}</span> : <span />}
        <span class="ref-range-label-spacer" />
        {reference_high !== undefined ? <span class="ref-range-label-high">{reference_high}</span> : <span />}
      </div>
    </div>
  )
}
