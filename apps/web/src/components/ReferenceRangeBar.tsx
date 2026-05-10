import type { ReportFlag } from '@aurboda/api-spec'

import './ReferenceRangeBar.css'

interface ReferenceRangeBarProps {
  value: number
  reference_low?: number
  reference_high?: number
  flag?: ReportFlag
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
 * zones sit on it, given a possibly one-sided reference range.
 *
 * Two-sided: existing 30%-padding-on-each-side display, with warning zones
 * on both ends and normal in the middle. Used by report cards (HRV, body
 * fat etc.) where both ends matter.
 *
 * Upper-only (e.g. salt, saturated_fat, alcohol): anchor at zero, extend
 * 30% beyond the cap; normal zone is everything from 0 up to the cap, the
 * warning zone covers only the over-cap region. Without this we used to
 * synthesize a fake low bound and label "ate 2 g of salt" as too-low.
 *
 * Lower-only (open upper bound, e.g. potassium minimum): warning zone
 * below the floor, normal zone above; extend display until at least the
 * value or 1.5× floor.
 */
const computeDisplayRange = (
  low: number | undefined,
  high: number | undefined,
  value: number,
): DisplayRange => {
  if (low !== undefined && high !== undefined) {
    const span = high - low
    const padding = Math.max(span * 0.3, Math.abs(value) * 0.05)
    const displayMin = low - padding
    const displayMax = high + padding
    const displaySpan = displayMax - displayMin
    return {
      displayMin,
      displayMax,
      normalStartPct: ((low - displayMin) / displaySpan) * 100,
      normalEndPct: ((high - displayMin) / displaySpan) * 100,
    }
  }
  if (high !== undefined) {
    const displayMin = Math.min(0, value)
    const displayMax = Math.max(high * 1.3, value * 1.1)
    const displaySpan = displayMax - displayMin || 1
    return {
      displayMin,
      displayMax,
      // Normal zone runs from displayMin (i.e. 0%) up to where `high` sits.
      normalStartPct: 0,
      normalEndPct: ((high - displayMin) / displaySpan) * 100,
    }
  }
  // low !== undefined && high === undefined. Bind to a local so TS keeps
  // the narrowing through the local arithmetic — without it the inferred
  // type is `number | undefined` again on each reference.
  const lo = low as number
  const displayMin = Math.min(lo * 0.7, value * 0.9)
  const displayMax = Math.max(lo * 1.5, value * 1.1)
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
 * Horizontal bar visualizing where a value falls relative to its reference
 * range. Supports both two-sided medical ranges (lab reports) and one-sided
 * dietary recommendations (salt cap, fiber floor) — see computeDisplayRange.
 */
export function ReferenceRangeBar({ value, reference_low, reference_high, flag }: ReferenceRangeBarProps) {
  if (reference_low === undefined && reference_high === undefined) return null

  const { displayMin, displayMax, normalStartPct, normalEndPct } = computeDisplayRange(
    reference_low,
    reference_high,
    value,
  )
  const displaySpan = displayMax - displayMin || 1
  const valuePct = clampPct(((value - displayMin) / displaySpan) * 100)
  const markerColor = flag ? (FLAG_COLORS[flag] ?? '#6b7280') : '#6b7280'

  return (
    <div
      class="ref-range-bar"
      title={`Value: ${value}, Range: ${reference_low ?? '—'}–${reference_high ?? '—'}`}
    >
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
        <div class="ref-range-marker" style={{ backgroundColor: markerColor, left: `${valuePct}%` }} />
      </div>
      <div class="ref-range-labels">
        {reference_low !== undefined ? <span class="ref-range-label-low">{reference_low}</span> : <span />}
        <span class="ref-range-label-spacer" />
        {reference_high !== undefined ? <span class="ref-range-label-high">{reference_high}</span> : <span />}
      </div>
    </div>
  )
}
